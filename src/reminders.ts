import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';

// Recordatorio local: avisa cuando quedan fotos sin subir a la nube.
// Las fotos solo se suben con la app abierta. Si el usuario la cierra con fotos pendientes,
// Android muestra un aviso mas tarde. Se cancela solo al volver a abrir la app.

const DB_NAME = 'CheckInventoryLocalDB';
const STORE_NAME = 'photo_sync_queue';
const PENDING_STATUSES = ['pending', 'uploading', 'failed'];
const CHANNEL_ID = 'sync_reminders';
const REMINDER_IDS = [91001, 91002, 91003];
const DELAYS_HOURS = [2, 24, 72];
const ASKED_KEY = 'ci_notif_permission_asked';

export interface ReminderItem {
  id: number;
  at: Date;
  title: string;
  body: string;
}

/** Evita avisos de madrugada: entre las 21:00 y las 07:00 se mueve a las 08:00. */
export function adjustForQuietHours(date: Date): Date {
  const d = new Date(date.getTime());
  const h = d.getHours();
  if (h >= 21) {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  } else if (h < 7) {
    d.setHours(8, 0, 0, 0);
  }
  return d;
}

export function buildReminders(count: number, now: Date): ReminderItem[] {
  const one = count === 1;
  const fotos = one ? '1 foto' : `${count} fotos`;
  const bodies = [
    `Tienes ${fotos} sin subir a la nube. Abre CheckInventory con internet para sincronizar${one ? 'la' : 'las'}.`,
    `${one ? 'Sigue' : 'Siguen'} ${fotos} sin subir. Abre la app con internet para que no queden solo en tu teléfono.`,
    `Aún hay ${fotos} sin subir. Si desinstalas la app o borras sus datos se perderán: ábrela con internet.`,
  ];
  return DELAYS_HOURS.map((hours, i) => ({
    id: REMINDER_IDS[i],
    at: adjustForQuietHours(new Date(now.getTime() + hours * 3600 * 1000)),
    title: 'CheckInventory',
    body: bodies[i],
  }));
}

/**
 * Cuenta las fotos que siguen solo en el teléfono. No abre la base de datos si no existe
 * (abrirla sin la tabla la dejaria rota para la app).
 */
export async function countPendingPhotos(idb?: IDBFactory): Promise<number> {
  const factory = idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  if (!factory) return 0;
  try {
    const anyFactory = factory as any;
    if (typeof anyFactory.databases === 'function') {
      const dbs = await anyFactory.databases();
      if (!dbs.some((d: any) => d.name === DB_NAME)) return 0;
    }
  } catch {
    /* seguimos con la apertura protegida */
  }
  return new Promise<number>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME);
    } catch {
      resolve(0);
      return;
    }
    // Si la base no existia, se cancela su creacion para no dejarla sin la tabla de la app
    req.onupgradeneeded = () => {
      try {
        req.transaction?.abort();
      } catch {
        /* nada */
      }
    };
    req.onerror = () => resolve(0);
    req.onblocked = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      let total = 0;
      try {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction(STORE_NAME, 'readonly');
        const cursorReq = tx.objectStore(STORE_NAME).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const v: any = cursor.value;
          if (v && PENDING_STATUSES.includes(v.status) && !v.isDeleted) total++;
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(total);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(total);
        };
      } catch {
        try {
          db.close();
        } catch {
          /* nada */
        }
        resolve(0);
      }
    };
  });
}

export interface ReminderDeps {
  countPending(): Promise<number>;
  schedule(items: ReminderItem[]): Promise<void>;
  cancel(ids: number[]): Promise<void>;
  permission(): Promise<string>;
  requestPermission(): Promise<string>;
  hasAsked(): boolean;
  markAsked(): void;
  now(): Date;
}

/** Logica pura (sin Capacitor) para poder probarla: cuando programar y cuando cancelar. */
export function createReminderController(d: ReminderDeps) {
  let lastCount = 0;
  let scheduledCount = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const refresh = async () => {
    lastCount = await d.countPending();
    return lastCount;
  };

  const maybeAskPermission = async (count: number) => {
    if (count <= 0 || d.hasAsked()) return;
    const state = await d.permission();
    if (state === 'prompt' || state === 'prompt-with-rationale') {
      d.markAsked();
      await d.requestPermission();
    }
  };

  return {
    /** La app vuelve al primer plano: ya no hace falta recordar nada. */
    onForeground: () =>
      enqueue(async () => {
        await d.cancel(REMINDER_IDS);
        scheduledCount = 0;
        await maybeAskPermission(await refresh());
      }),
    /** Cada minuto con la app abierta: mantiene el conteo al dia y pide permiso la primera vez. */
    tick: () =>
      enqueue(async () => {
        await maybeAskPermission(await refresh());
      }),
    /** La app pasa a segundo plano o se cierra: si hay fotos pendientes, programa los avisos. */
    onBackground: () =>
      enqueue(async () => {
        if ((await d.permission()) !== 'granted') return;
        // Se programa de inmediato con el ultimo conteo (el sistema puede congelar la app enseguida)...
        if (lastCount > 0) {
          await d.schedule(buildReminders(lastCount, d.now()));
          scheduledCount = lastCount;
        }
        // ...y se corrige con el conteo real
        const n = await refresh();
        if (n === 0) {
          await d.cancel(REMINDER_IDS);
          scheduledCount = 0;
        } else if (n !== scheduledCount) {
          await d.schedule(buildReminders(n, d.now()));
          scheduledCount = n;
        }
      }),
  };
}

export async function startPhotoReminders(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Recordatorios de sincronización',
      description: 'Avisos cuando hay fotos sin subir a la nube',
      importance: 3,
      visibility: 1,
    });
  } catch {
    /* el canal es opcional */
  }

  const controller = createReminderController({
    countPending: () => countPendingPhotos(),
    schedule: async (items) => {
      await LocalNotifications.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
      await LocalNotifications.schedule({
        notifications: items.map((i) => ({
          id: i.id,
          title: i.title,
          body: i.body,
          channelId: CHANNEL_ID,
          schedule: { at: i.at, allowWhileIdle: true },
          // Alarma inexacta: evita que Android abra la pantalla "Alarmas y recordatorios"
          isExactNotification: false,
          extra: { type: 'photo-sync-reminder' },
        })),
      });
    },
    cancel: (ids) => LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }),
    permission: async () => (await LocalNotifications.checkPermissions()).display,
    requestPermission: async () => (await LocalNotifications.requestPermissions()).display,
    hasAsked: () => {
      try {
        return localStorage.getItem(ASKED_KEY) === '1';
      } catch {
        return false;
      }
    },
    markAsked: () => {
      try {
        localStorage.setItem(ASKED_KEY, '1');
      } catch {
        /* nada */
      }
    },
    now: () => new Date(),
  });

  const safe = (p: Promise<unknown>) => p.catch((e) => console.warn('Recordatorio de fotos:', e));
  await App.addListener('appStateChange', ({ isActive }) => {
    safe(isActive ? controller.onForeground() : controller.onBackground());
  });
  safe(controller.onForeground());
  setInterval(() => {
    if (document.visibilityState === 'visible') safe(controller.tick());
  }, 60_000);
}
