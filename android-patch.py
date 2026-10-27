#!/usr/bin/env python3
"""
android-patch.py  -  Adapta la app web exportada de AI Studio para correr como app Android (Capacitor).

- NO toca tu lógica: agrega un modulo nativo (src/native.ts) y redirige unos pocos puntos
  que no funcionan dentro del WebView de Android (guardar/compartir archivos, dictado, URLs del servidor, etc.).
- Es idempotente: si ya se aplico, no hace nada. Si AI Studio cambia el codigo y un parche ya no
  encaja, falla con un mensaje claro (no deja la app a medio parchear en silencio).
- Se ejecuta solo desde el workflow de GitHub Actions: no hay que correrlo a mano.
"""
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path('.')
MARK = '/* android-patched */'
errors = []


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')


def write(p, s):
    pathlib.Path(p).write_text(s, encoding='utf-8')


def patch_file(path, edits, regex_edits=()):
    """edits: lista de (viejo, nuevo, veces_esperadas). veces_esperadas puede ser un entero o un conjunto, p. ej. {0, 1} = opcional."""
    s = read(path)
    if MARK in s:
        print(f'= {path}: ya estaba parchado')
        return
    for old, new, expected in edits:
        allowed = {expected} if isinstance(expected, int) else set(expected)
        n = s.count(old)
        if n not in allowed:
            errors.append(f'{path}: se esperaban {sorted(allowed)} coincidencia(s) y hay {n} para:\n    {old[:110]!r}')
            continue
        if n == 0:
            print(f'  (opcional, no aplica en {path}): {old[:60]!r}')
            continue
        s = s.replace(old, new)
    for fn in regex_edits:
        try:
            s = fn(s)
        except AssertionError as e:
            errors.append(f'{path}: {e}')
    if not errors:
        write(path, MARK + '\n' + s)
        print(f'+ {path}: parchado')


# ---------------------------------------------------------------- modo --android (despues de "cap add android")
SIGNING_GRADLE = """    signingConfigs {
        debug {
            // Llave fija: asi cada APK nuevo se instala ENCIMA del anterior sin desinstalar (no se pierden datos locales)
            storeFile file('checkinventory-debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
            storeType 'PKCS12'
        }
    }
"""


STAT_ICON_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M19.35,10.04C18.67,6.59 15.64,4 12,4 9.11,4 6.6,5.64 5.35,8.04 2.34,8.36 0,10.91 0,14c0,3.31 2.69,6 6,6h13c2.76,0 5,-2.24 5,-5 0,-2.64 -2.05,-4.78 -4.65,-4.96zM14,13v4h-4v-4H7l5,-5 5,5h-3z" />
</vector>
"""


def android_post():
    import shutil
    failed = []
    # 1) Permisos de camara y microfono
    mp = pathlib.Path('android/app/src/main/AndroidManifest.xml')
    m = mp.read_text(encoding='utf-8')
    add = ''
    for perm in ['ACCESS_NETWORK_STATE', 'CAMERA', 'RECORD_AUDIO']:
        if f'android.permission.{perm}"' not in m:
            add += f'    <uses-permission android:name="android.permission.{perm}" />\n'
    if 'android.hardware.camera"' not in m:
        add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
    if add:
        mp.write_text(m.replace('</manifest>', add + '</manifest>'), encoding='utf-8')
        print('+ AndroidManifest.xml: permisos agregados')
    else:
        print('= AndroidManifest.xml: permisos ya estaban')

    # 2) Firma fija (si existe checkinventory-debug.keystore en la raiz del repositorio)
    ks = pathlib.Path('checkinventory-debug.keystore')
    gradle = pathlib.Path('android/app/build.gradle')
    if ks.exists():
        shutil.copy(ks, 'android/app/checkinventory-debug.keystore')
        g = gradle.read_text(encoding='utf-8')
        if 'checkinventory-debug.keystore' in g:
            print('= build.gradle: firma fija ya estaba')
        elif g.count('    buildTypes {') != 1:
            failed.append('android/app/build.gradle: no se encontro el bloque buildTypes para insertar la firma fija')
        else:
            gradle.write_text(g.replace('    buildTypes {', SIGNING_GRADLE + '    buildTypes {', 1), encoding='utf-8')
            print('+ build.gradle: firma fija configurada')
    else:
        print('  (aviso) falta checkinventory-debug.keystore en la raiz del repositorio: el APK se firmara con una llave temporal')
        print('          distinta en cada compilacion y habra que desinstalar la version anterior para instalarlo.')
    # 2b) Icono de la notificacion de recordatorio (blanco sobre transparente, como exige Android)
    icon_dir = pathlib.Path('android/app/src/main/res/drawable')
    icon_dir.mkdir(parents=True, exist_ok=True)
    icon_file = icon_dir / 'ic_stat_checkinventory.xml'
    if not icon_file.exists():
        icon_file.write_text(STAT_ICON_XML, encoding='utf-8')
        print('+ icono de notificacion creado')
    else:
        print('= icono de notificacion ya estaba')

    # 3) Numero de version creciente (numero de ejecucion de GitHub): Android lo acepta como actualizacion
    run = os.environ.get('GITHUB_RUN_NUMBER', '').strip()
    if run.isdigit():
        g = gradle.read_text(encoding='utf-8')
        g2 = re.sub(r'versionCode\s+\d+', f'versionCode {run}', g, count=1)
        g2 = re.sub(r'versionName\s+"[^"]*"', f'versionName "1.0.{run}"', g2, count=1)
        if g2 != g:
            gradle.write_text(g2, encoding='utf-8')
            print(f'+ build.gradle: versionCode {run}')
    if failed:
        print('\n*** ERROR ***')
        for f in failed:
            print(' -', f)
        sys.exit(1)
    print('\nOK: proyecto Android preparado')


if '--android' in sys.argv:
    android_post()
    sys.exit(0)


# ---------------------------------------------------------------- archivos nuevos
NATIVE_TS = r"""import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type JSZip from 'jszip';
import firebaseConfig from '../firebase-applet-config.json';
import { streamZipBase64 } from './zipStream';
import { startPhotoReminders } from './reminders';

export const isNative = Capacitor.isNativePlatform();

/**
 * URL del servidor desplegado (Cloud Run) que atiende /api/* (correos, firma remota, etc.).
 * En la app Android no existe servidor local: se define con el secret VITE_API_URL.
 */
export const API_BASE: string = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** Origen "web" para enlaces (correos, firma remota, enlace de fotos). En Android window.location.origin es https://localhost. */
export const webOrigin = (): string =>
  isNative ? (API_BASE || `https://${firebaseConfig.authDomain}`) : window.location.origin;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_');
const isCancel = (e: any) => /cancel/i.test(String(e?.message ?? e));

async function writeCacheFile(blob: Blob, fileName: string): Promise<string> {
  const written = await Filesystem.writeFile({
    path: safeName(fileName),
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  return written.uri;
}

/** Android: guarda el archivo y abre "Compartir / Guardar". */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const uri = await writeCacheFile(blob, fileName);
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Guardar o compartir' });
  } catch (e) {
    if (!isCancel(e)) throw e;
  }
}

/** jsPDF: en web descarga normal; en Android abre "Compartir / Guardar". */
export async function savePdf(doc: any, fileName: string): Promise<void> {
  if (!isNative) {
    doc.save(fileName);
    return;
  }
  await saveFile(doc.output('blob') as Blob, fileName);
}

/** Descarga una imagen/archivo. En Android usa HTTP nativo (evita bloqueos CORS del WebView). */
export async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    if (isNative && /^https?:/i.test(url)) {
      const res = await CapacitorHttp.get({ url, responseType: 'blob' });
      if (res.status < 200 || res.status >= 300) return null;
      const bin = atob(res.data as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const type = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || 'image/jpeg';
      return new Blob([bytes], { type });
    }
    const r = await fetch(url);
    return r.ok ? await r.blob() : null;
  } catch (e) {
    console.warn('fetchBlob fallo', e);
    return null;
  }
}

/** ZIP grande: en Android se escribe por partes en disco (cientos de fotos no caben en memoria de una vez). */
export async function saveZip(zip: JSZip, fileName: string): Promise<void> {
  if (!isNative) {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const path = safeName(fileName);
  try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* no existia */ }
  await streamZipBase64(zip, (bytes) => blobToBase64(new Blob([bytes])), async (data, i) => {
    if (i === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Guardar o compartir' });
  } catch (e) {
    if (!isCancel(e)) throw e;
  }
}

/** Dictado por voz nativo (el del navegador no funciona dentro del WebView de Android). */
export async function nativeListen(lang = 'es-ES'): Promise<string> {
  const { available } = await SpeechRecognition.available();
  if (!available) throw new Error('unavailable');
  const perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw new Error('not-allowed');
  const result = await SpeechRecognition.start({ language: lang, maxResults: 1, popup: false, partialResults: false });
  return result.matches?.[0] ?? '';
}

// ----------------------------------------------------------------------------
// Ajustes globales solo para Android
// ----------------------------------------------------------------------------
if (isNative) {
  // 1) Las llamadas relativas fetch('/api/...') apuntan al servidor desplegado
  if (API_BASE) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input.startsWith('/api/')) input = API_BASE + input;
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }

  // 1b) Los servidores gratuitos (Render) se duermen tras 15 min sin uso y tardan ~1 min en despertar:
  //     se les avisa al abrir la app y al volver a ella, para que ya esten listos cuando se necesiten.
  if (API_BASE) {
    const wake = () => { fetch(`${API_BASE}/api/health`, { cache: 'no-store' }).catch(() => {}); };
    let lastWake = Date.now();
    wake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastWake > 10 * 60 * 1000) {
        lastWake = Date.now();
        wake();
      }
    });
  }

  // 1c) Recordatorio local cuando quedan fotos sin subir (no necesita internet ni servidor)
  try {
    void startPhotoReminders();
  } catch (e) {
    console.warn('Recordatorios no disponibles', e);
  }

  // 2) navigator.share / canShare no existen en el WebView: se reemplazan por el menu nativo de Android
  const nav = navigator as any;
  nav.canShare = () => true;
  nav.share = async (data: { title?: string; text?: string; url?: string; files?: File[] }) => {
    try {
      if (data.files && data.files.length) {
        const uris: string[] = [];
        for (const f of data.files) uris.push(await writeCacheFile(f, f.name));
        await Share.share({ title: data.title, text: data.text, files: uris, dialogTitle: data.title || 'Compartir' });
      } else {
        await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title || 'Compartir' });
      }
    } catch (e: any) {
      if (isCancel(e)) {
        const err: any = new Error('Share canceled');
        err.name = 'AbortError';
        throw err;
      }
      throw e;
    }
  };
}
"""

ZIPSTREAM_TS = r"""import type JSZip from 'jszip';

/**
 * Genera el ZIP por partes y entrega cada parte ya en base64.
 * Cada parte (salvo la ultima) es multiplo de 3 bytes para que la union de los base64
 * sea identica al base64 del archivo completo. Con pausa/reanudacion no se acumulan cientos de MB en memoria.
 */
export function streamZipBase64(
  zip: JSZip,
  toBase64: (bytes: Uint8Array) => Promise<string>,
  onChunk: (base64: string, index: number) => Promise<void>,
  flushBytes = 3 * 1024 * 1024
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let buffer = new Uint8Array(0);
    let index = 0;
    let inflight = 0;
    let ended = false;
    let failed = false;
    let chain: Promise<void> = Promise.resolve();

    const helper = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'STORE' });

    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      reject(e);
    };

    const send = (bytes: Uint8Array) => {
      const i = index++;
      inflight++;
      if (inflight >= 2) helper.pause();
      chain = chain
        .then(async () => onChunk(await toBase64(bytes), i))
        .then(() => {
          inflight--;
          if (!ended && inflight < 2) helper.resume();
        })
        .catch(fail);
    };

    helper
      .on('data', (chunk: Uint8Array) => {
        const merged = new Uint8Array(buffer.length + chunk.length);
        merged.set(buffer, 0);
        merged.set(chunk, buffer.length);
        buffer = merged;
        if (buffer.length >= flushBytes) {
          const n = Math.floor(buffer.length / 3) * 3;
          send(buffer.slice(0, n));
          buffer = buffer.slice(n);
        }
      })
      .on('error', fail)
      .on('end', () => {
        ended = true;
        if (buffer.length) send(buffer);
        chain.then(() => { if (!failed) resolve(); });
      })
      .resume();
  });
}
"""

REMINDERS_TS = r"""import { App } from '@capacitor/app';
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
"""

OFFLINE_WRITES_TS = r"""import {
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
} from 'firebase/firestore';

/**
 * Con la cache offline de Firestore, la promesa de una escritura NO se resuelve hasta que el
 * servidor la confirma (sin internet, nunca). La escritura local ya quedo hecha y se subira sola,
 * asi que se espera poco y se continua. Los errores rapidos (permisos, datos invalidos) se propagan;
 * los tardios solo se registran en consola.
 */
export function queuedWrite<T>(p: Promise<T>, ms = 1200): Promise<T | undefined> {
  p.catch((e) => console.error('Firestore write failed', e));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export const setDoc = ((...args: any[]) => queuedWrite((_setDoc as any)(...args))) as unknown as typeof _setDoc;
export const updateDoc = ((...args: any[]) => queuedWrite((_updateDoc as any)(...args))) as unknown as typeof _updateDoc;
export const deleteDoc = ((...args: any[]) => queuedWrite((_deleteDoc as any)(...args))) as unknown as typeof _deleteDoc;
"""

CAP_CONFIG = """import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '__APP_ID__',
  appName: '__APP_NAME__',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // La web NO se dibuja debajo de la barra de estado ni de la barra de navegacion
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'contain' },
    LocalNotifications: { smallIcon: 'ic_stat_checkinventory', iconColor: '#F59E0B' },
  },
};

export default config;
"""

for path, content in [('src/native.ts', NATIVE_TS), ('src/zipStream.ts', ZIPSTREAM_TS), ('src/reminders.ts', REMINDERS_TS),
                      ('src/offlineWrites.ts', OFFLINE_WRITES_TS)]:
    write(path, content)
    print(f'+ {path}: escrito')


def ensure_notification_plugins():
    """El workflow solo instala los plugins basicos; los de recordatorios los instala este script."""
    wanted = [('@capacitor/app', '8.1.2'), ('@capacitor/local-notifications', '8.3.1')]
    missing = [f'{pkg}@{ver}' for pkg, ver in wanted if not pathlib.Path('node_modules', *pkg.split('/')).exists()]
    if not missing:
        print('= plugins de notificaciones: ya instalados')
        return
    print('+ instalando', ' '.join(missing))
    try:
        r = subprocess.run(['npm', 'install', '--legacy-peer-deps', '--no-audit', '--no-fund', *missing])
    except FileNotFoundError:
        errors.append('npm no esta disponible para instalar ' + ' '.join(missing))
        return
    if r.returncode != 0:
        errors.append('no se pudieron instalar los plugins de notificaciones: ' + ' '.join(missing))


ensure_notification_plugins()

# capacitor.config.ts: se reescribe siempre, pero conservando el appId y el nombre que ya hubiera
app_id, app_name = 'com.checkinventory.app', 'CheckInventory'
if ROOT.joinpath('capacitor.config.ts').exists():
    old_cfg_text = read('capacitor.config.ts')
    m_id = re.search(r"appId:\s*['\"]([^'\"]+)['\"]", old_cfg_text)
    m_nm = re.search(r"appName:\s*['\"]([^'\"]+)['\"]", old_cfg_text)
    app_id = m_id.group(1) if m_id else app_id
    app_name = m_nm.group(1) if m_nm else app_name
write('capacitor.config.ts', CAP_CONFIG.replace('__APP_ID__', app_id).replace('__APP_NAME__', app_name))
print(f'+ capacitor.config.ts: escrito (appId {app_id})')

# index.html: la web no debe extenderse bajo las barras del sistema
html = read('index.html')
if re.search(r'viewport-fit\s*=\s*cover', html):
    write('index.html', re.sub(r'viewport-fit\s*=\s*cover', 'viewport-fit=contain', html))
    print('+ index.html: viewport-fit=contain')
elif 'viewport-fit=contain' in html:
    print('= index.html: ya estaba en viewport-fit=contain')
else:
    print('  (aviso) index.html no declara viewport-fit; no se modifica')

# ---------------------------------------------------------------- src/main.tsx
patch_file('src/main.tsx', [
    ("import { registerSW } from 'virtual:pwa-register';",
     "import { registerSW } from 'virtual:pwa-register';\nimport { isNative } from './native';", 1),
    ("registerSW({ immediate: true });",
     "if (!isNative) registerSW({ immediate: true }); // en la app Android no se usa service worker", 1),
])

# ---------------------------------------------------------------- src/components/Auth.tsx
s = read('src/components/Auth.tsx')
if MARK not in s:
    n = s.count('url: window.location.origin,')
    if n < 1:
        errors.append('src/components/Auth.tsx: no se encontro window.location.origin')
    else:
        s = s.replace('url: window.location.origin,', 'url: webOrigin(),')
        # import tras la ultima linea import
        lines = s.split('\n')
        last_import = max(i for i, l in enumerate(lines) if l.startswith('import '))
        lines.insert(last_import + 1, "import { webOrigin } from '../native';")
        write('src/components/Auth.tsx', MARK + '\n' + '\n'.join(lines))
        print('+ src/components/Auth.tsx: parchado')
else:
    print('= src/components/Auth.tsx: ya estaba parchado')

# ---------------------------------------------------------------- src/App.tsx
SPEECH_BLOCK = """  const startListening = (spaceIndex: number, itemIndex: number, itemId: string, isGeneralObservation: boolean = false) => {
    if (isNative) {
      setIsListening(itemId);
      nativeListen('es-ES')
        .then((transcript) => {
          if (transcript && currentInventory) {
            const updated = [...currentInventory.spaces];
            if (isGeneralObservation) {
              const currentObs = updated[spaceIndex].generalObservations || '';
              updated[spaceIndex].generalObservations = currentObs ? `${currentObs} ${transcript}` : transcript;
            } else {
              const currentDetails = updated[spaceIndex].items[itemIndex].details;
              updated[spaceIndex].items[itemIndex].details = currentDetails ? `${currentDetails} ${transcript}` : transcript;
            }
            setCurrentInventory({ ...currentInventory, spaces: updated });
            showNotify('Texto dictado añadido');
          }
        })
        .catch((e: any) => {
          showNotify(e?.message === 'not-allowed' ? 'Permiso de micrófono denegado' : 'Dictado por voz no disponible', 'error');
        })
        .finally(() => setIsListening(null));
      return;
    }
"""


def zip_context(s):
    """Muestra el codigo que rodea a generateAsync / saveAs para poder ajustar el script sin el ZIP."""
    lines = s.split('\n')
    hits = [i for i, l in enumerate(lines) if 'generateAsync' in l or re.search(r'\bsaveAs\(', l)]
    chunks, seen = [], set()
    for i in hits[:6]:
        a, b = max(0, i - 3), min(len(lines), i + 6)
        if (a, b) in seen:
            continue
        seen.add((a, b))
        chunks.append('\n'.join(f'      {n + 1}: {lines[n][:150]}' for n in range(a, b)))
    return '\n      ...\n'.join(chunks) if chunks else '      (no se encontro generateAsync ni saveAs en App.tsx)'


def zip_regex(s):
    """Sustituye 'generar el ZIP y guardarlo con saveAs' por saveZip(zip, nombre), tolerando cambios de variables y opciones."""
    patterns = [
        # const x = await zip.generateAsync({...}[, callback]); saveAs(x, nombre);
        r"const\s+(?P<b>\w+)\s*=\s*await\s+(?P<z>\w+)\.generateAsync\(.{0,500}?\)\s*;\s*(?:await\s+)?saveAs\(\s*(?P=b)\s*,\s*(?P<n>[^;]*?)\)\s*;",
        # saveAs(await zip.generateAsync({...}), nombre);
        r"(?:await\s+)?saveAs\(\s*await\s+(?P<z>\w+)\.generateAsync\(.{0,500}?\)\s*,\s*(?P<n>[^;]*?)\)\s*;",
    ]
    for pat in patterns:
        rx = re.compile(pat, re.S)
        new_s, n = rx.subn(lambda m: f"await saveZip({m.group('z')}, {m.group('n').strip()});", s)
        if n:
            print(f'  (ZIP: {n} coincidencia(s) adaptada(s))')
            return new_s
    raise AssertionError(
        'no se encontro como App.tsx genera y guarda el ZIP de fotos (generateAsync + saveAs). '
        'Codigo actual alrededor:\n' + zip_context(s)
    )

def app_regex(s):
    # Redirige setDoc / updateDoc / deleteDoc a las versiones "offline" (no se quedan esperando sin internet)
    m = re.search(r"import \{[^}]*\} from 'firebase/firestore';", s)
    assert m, 'no se encontro el import de firebase/firestore'
    block = m.group(0)
    new_block = re.sub(r"\n\s*(updateDoc|deleteDoc|setDoc),[ ]*", "", block)
    assert not re.search(r"\b(updateDoc|deleteDoc|setDoc)\b", new_block), 'no se pudieron quitar setDoc/updateDoc/deleteDoc del import'
    new_block += "\nimport { setDoc, updateDoc, deleteDoc, queuedWrite } from './offlineWrites';"
    return s.replace(block, new_block, 1)

patch_file('src/App.tsx', [
    # imports nativos
    ("import { saveAs } from 'file-saver';",
     "import { saveAs } from 'file-saver';\nimport { isNative, nativeListen, saveZip, savePdf, fetchBlob, webOrigin } from './native';", 1),
    # escrituras por lote
    ("await batch.commit();", "await queuedWrite(batch.commit());", 1),
    # fotos del ZIP: descarga nativa (sin CORS)
    ("""        const response = await fetch(targetUrl);
        if (response.ok) {
          const blob = await response.blob();
          return { type: 'blob', blob };
        }""",
     """        const blob = await fetchBlob(targetUrl);
        if (blob) {
          return { type: 'blob', blob };
        }""", 1),
    # ZIP por partes: ver zip_regex (tolera cambios de variables y opciones)
    # dictado por voz
    ("  const startListening = (spaceIndex: number, itemIndex: number, itemId: string, isGeneralObservation: boolean = false) => {\n",
     SPEECH_BLOCK, 1),
    # PDF
    ("    doc.save(`Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}_${inventory.date}${suffix}.pdf`);",
     "    savePdf(doc, `Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}_${inventory.date}${suffix}.pdf`);", 1),
    ("        doc.save(fileName);", "        savePdf(doc, fileName);", 2),
    # foto en pantalla completa: compartir
    ("""                          const response = await fetch(fullscreenPhoto.url);
                          const blob = await response.blob();""",
     """                          const blob = await fetchBlob(fullscreenPhoto.url);
                          if (!blob) throw new Error('No se pudo descargar la foto');""", 1),
    # respaldo: el encabezado fijo respeta la barra de estado (si viewport-fit ya lo resuelve, el margen es 0)
    ('<div className="sticky top-0 z-50">',
     '<div className="sticky top-0 z-50 bg-white" style={{ paddingTop: \'env(safe-area-inset-top, 0px)\' }}>', {0, 1}),
    # enlaces / origen del servidor
    ("origin: window.location.origin\n", "origin: webOrigin()\n", 1),
    ("`${window.location.origin}/?downloadPhotos=", "`${webOrigin()}/?downloadPhotos=", 1),
    ("url: window.location.origin,", "url: webOrigin(),", 1),
], regex_edits=[zip_regex, app_regex])

# ---------------------------------------------------------------- resultado
if errors:
    print('\n*** NO SE PUDO ADAPTAR LA APP ***')
    print('AI Studio cambio partes del codigo que este script necesita. Envia este mensaje para actualizar el script:\n')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('\nOK: app adaptada para Android')
