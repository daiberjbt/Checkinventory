import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { OfflinePhotoRecord, Inventory, InventorySpace, Annex, Photo } from '../types';
import {
  getPendingPhotosByAdminUid,
  getPendingPhoto,
  updatePhotoRecord,
  deletePhotoRecord,
  resetStaleUploadingRecords
} from './offlinePhotoDb';

type SyncListener = (event: {
  type: 'photo_synced' | 'photo_failed' | 'sync_started' | 'sync_finished';
  photoId?: string;
  inventoryId?: string;
  url?: string;
  error?: string;
}) => void;

export class PhotoSyncEngine {
  private static instance: PhotoSyncEngine;
  private isRunning = false;
  private activeSyncPromise: Promise<void> | null = null;
  private currentAdminUid: string | null = null;
  private currentUserUid: string | null = null;
  private intervalId: any = null;
  private listeners: Set<SyncListener> = new Set();
  private abortController: AbortController | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private persistedInventoryIds: Set<string> = new Set();

  private constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('checkinventory_photo_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'TRIGGER_SYNC' && this.currentAdminUid) {
            this.processQueue();
          }
        };
      } catch (e) {
        console.warn('[SyncEngine] BroadcastChannel no soportado o deshabilitado', e);
      }
    }
  }

  public static getInstance(): PhotoSyncEngine {
    if (!PhotoSyncEngine.instance) {
      PhotoSyncEngine.instance = new PhotoSyncEngine();
    }
    return PhotoSyncEngine.instance;
  }

  public markInventoryPersisted(inventoryId: string): void {
    if (inventoryId) {
      this.persistedInventoryIds.add(inventoryId);
    }
  }

  public setPersistedInventories(inventoryIds: string[]): void {
    if (Array.isArray(inventoryIds)) {
      for (const id of inventoryIds) {
        if (id) this.persistedInventoryIds.add(id);
      }
    }
  }

  public isInventoryPersisted(inventoryId: string): boolean {
    return this.persistedInventoryIds.has(inventoryId);
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: Parameters<SyncListener>[0]): void {
    this.listeners.forEach(fn => {
      try {
        fn(event);
      } catch (e) {
        console.error('[SyncEngine] Error en listener', e);
      }
    });
  }

  /**
   * Inicia el motor de sincronización para el tenant actual autenticado
   */
  public start(adminUid: string, userUid: string): void {
    if (!adminUid) {
      console.warn('[SyncEngine] No se puede iniciar sin un adminUid válido');
      return;
    }

    if (this.currentAdminUid === adminUid && this.currentUserUid === userUid && this.intervalId) {
      // Ya está corriendo para este mismo tenant
      return;
    }

    this.stop(); // Detener cualquier sesión previa

    this.currentAdminUid = adminUid;
    this.currentUserUid = userUid;
    this.abortController = new AbortController();

    console.log(`[SyncEngine] Iniciando para tenant adminUid=${adminUid}`);

    // Listeners del sistema
    window.addEventListener('online', this.handleOnlineEvent);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handlePageShow);

    // Heartbeat cada 60s
    this.intervalId = setInterval(() => {
      if (navigator.onLine && this.currentAdminUid) {
        this.processQueue();
      }
    }, 60000);

    // Ejecutar primera verificación inmediatamente si estamos online
    if (navigator.onLine) {
      setTimeout(() => this.processQueue(), 500);
    }
  }

  /**
   * Detiene el motor de sincronización (ej. logout)
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    window.removeEventListener('online', this.handleOnlineEvent);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pageshow', this.handlePageShow);

    this.currentAdminUid = null;
    this.currentUserUid = null;
    this.isRunning = false;
    console.log('[SyncEngine] Detenido');
  }

  public async triggerSync(): Promise<void> {
    try {
      if (navigator.onLine && this.currentAdminUid) {
        if (this.broadcastChannel) {
          try {
            this.broadcastChannel.postMessage({ type: 'TRIGGER_SYNC' });
          } catch (e) {
            // Ignorar errores de broadcast
          }
        }
        await this.processQueue();
      }
    } catch (err) {
      console.warn('[SyncEngine] Error interno controlado en triggerSync:', err);
    }
  }

  public trigger(): void {
    this.triggerSync();
  }

  private handleOnlineEvent = (): void => {
    console.log('[SyncEngine] Conexión restaurada (online)');
    this.trigger();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      console.log('[SyncEngine] Pestaña visible (visibilitychange)');
      this.trigger();
    }
  };

  private handlePageShow = (): void => {
    console.log('[SyncEngine] Retorno de suspensión (pageshow)');
    this.trigger();
  };

  /**
   * Procesa la cola de fotografías pendientes garantizando aislamiento de tenant,
   * promesas compartidas para evitar concurrencia y locks en navegador
   */
  public async processQueue(): Promise<void> {
    if (this.isRunning) return;
    if (this.activeSyncPromise) return this.activeSyncPromise;
    if (!this.currentAdminUid) return;
    if (!navigator.onLine) return;

    // Verificar que Auth esté activo
    if (!auth.currentUser) {
      console.log('[SyncEngine] Usuario no autenticado en Auth, posponiendo');
      return;
    }

    this.activeSyncPromise = (async () => {
      try {
        // Mecanismo de coordinación con Web Locks si está disponible
        if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
          try {
            await navigator.locks.request(
              `checkinventory_photo_sync_${this.currentAdminUid}`,
              { ifAvailable: true },
              async (lock) => {
                if (!lock) {
                  // Otra pestaña ya está ejecutando la sincronización para este tenant
                  return;
                }
                await this.executeQueueProcessing();
              }
            );
            return;
          } catch (lockErr) {
            console.warn('[SyncEngine] WebLock falló, procediendo en modo standalone', lockErr);
          }
        }

        // Fallback standalone sin Web Locks
        await this.executeQueueProcessing();
      } finally {
        this.activeSyncPromise = null;
      }
    })();

    return this.activeSyncPromise;
  }

  private async executeQueueProcessing(): Promise<void> {
    const adminUid = this.currentAdminUid;
    if (!adminUid || this.isRunning) return;

    this.isRunning = true;
    this.notify({ type: 'sync_started' });

    try {
      // 1. Recuperar registros 'uploading' que quedaron abandonados (> 45s)
      await resetStaleUploadingRecords(adminUid, 45000);

      // 2. Obtener lista de fotografías pendientes para este tenant
      const pendingRecords = await getPendingPhotosByAdminUid(adminUid);
      if (pendingRecords.length === 0) {
        return;
      }

      console.log(`[SyncEngine] Procesando ${pendingRecords.length} fotos pendientes para tenant ${adminUid}`);

      // Procesamiento estrictamente secuencial para evitar colisiones entre fotos del mismo documento
      for (const record of pendingRecords) {
        // Verificar si la sesión cambió o se canceló
        if (this.currentAdminUid !== adminUid || !auth.currentUser) {
          console.log('[SyncEngine] Cambio de tenant o logout durante el procesamiento, abortando');
          break;
        }

        await this.syncSinglePhoto(record, adminUid);
      }
    } catch (err: any) {
      console.error('[SyncEngine] Error general al procesar la cola de fotos', err);
    } finally {
      this.isRunning = false;
      this.notify({ type: 'sync_finished' });
    }
  }

  /**
   * Sincronización idempotente de una única fotografía (2-Pass Checkpoint)
   */
  private async syncSinglePhoto(record: OfflinePhotoRecord, expectedAdminUid: string): Promise<void> {
    // Aislamiento Multi-Tenant Estricto
    if (record.adminUid !== expectedAdminUid) {
      console.warn(`[SyncEngine] Registro ${record.id} no pertenece al tenant activo ${expectedAdminUid}, omitiendo`);
      return;
    }

    // Re-leer el registro fresco de IndexedDB para descartar tombstones (eliminadas en UI)
    const freshRecord = await getPendingPhoto(record.id);
    if (!freshRecord || freshRecord.isDeleted) {
      console.log(`[SyncEngine] Foto ${record.id} fue eliminada o cancelada por el usuario`);
      if (freshRecord?.storageUploaded && freshRecord.storagePath) {
        try {
          const storageRef = ref(storage, freshRecord.storagePath);
          await deleteObject(storageRef);
        } catch (e) {
          // Ignorar si el objeto no existía en Storage
        }
      }
      await deletePhotoRecord(record.id);
      return;
    }

    // Comprobación de conectividad: si no hay red, la foto permanece en 'pending' esperando conexión
    if (!navigator.onLine) {
      return;
    }

    // VERIFICACIÓN PREVIA DE PERSISTENCIA (Inventario y Espacio en Firestore):
    // Una fotografía no debe sincronizarse hacia Firestore si el inventario o el espacio
    // todavía solo existen en el estado local de React.
    const inventoryRef = doc(db, 'inventories', freshRecord.inventoryId);
    let remoteInvData: Inventory | null = null;
    let isPersisted = this.isInventoryPersisted(freshRecord.inventoryId);

    try {
      const checkSnap = await getDoc(inventoryRef);
      if (checkSnap.exists()) {
        isPersisted = true;
        this.markInventoryPersisted(freshRecord.inventoryId);
        remoteInvData = checkSnap.data() as Inventory;
      } else {
        isPersisted = false;
      }
    } catch (checkErr: any) {
      // Si recibimos error de lectura (ej. permisos en reglas por documento no creado aún), el inventario no está listo
      isPersisted = false;
    }

    // Condición 1: Si el inventario aún no existe en Firestore
    // Esto es un estado NORMAL de borrador local. NO es error de runtime, NO console.error, NO incrementar retryCount.
    if (!isPersisted || !remoteInvData) {
      console.log(`[SyncEngine] Inventario ${freshRecord.inventoryId} no existe aún en Firestore. Manteniendo foto ${freshRecord.id} en IndexedDB con status 'pending'.`);
      if (freshRecord.status !== 'pending') {
        freshRecord.status = 'pending';
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
      }
      return;
    }

    // Condición 2: Si el inventario existe pero el espacio destino (spaceId) no existe aún en Firestore
    // (por ejemplo, el usuario creó un nuevo espacio mediante addSpace() y todavía no ha guardado el inventario)
    if (!freshRecord.isAnnex && freshRecord.spaceId) {
      const spaces = Array.isArray(remoteInvData.spaces) ? remoteInvData.spaces : [];
      const spaceExists = spaces.some(s => s.id === freshRecord.spaceId);
      if (!spaceExists) {
        console.log(`[SyncEngine] Espacio ${freshRecord.spaceId} no existe aún en Firestore para el inventario ${freshRecord.inventoryId}. Manteniendo foto ${freshRecord.id} en IndexedDB con status 'pending' (esperando guardar inventario).`);
        if (freshRecord.status !== 'pending') {
          freshRecord.status = 'pending';
          freshRecord.lastAttemptAt = Date.now();
          await updatePhotoRecord(freshRecord);
        }
        return; // Retorno limpio: NO console.error, NO incremento de retryCount, NO photo_failed
      }
    }

    // Una vez confirmado que el inventario y el espacio existen en Firestore, procedemos a sincronizar
    freshRecord.status = 'uploading';
    freshRecord.lastAttemptAt = Date.now();
    await updatePhotoRecord(freshRecord);

    let downloadUrl = freshRecord.downloadUrl || '';

    try {
      // FASE 1: Subida Segura del Binario a Firebase Storage (Idempotente)
      if (!freshRecord.storageUploaded || !downloadUrl) {
        const storagePath = freshRecord.storagePath;
        const storageRef = ref(storage, storagePath);

        // Subir Blob binario puro
        const uploadResult = await uploadBytes(storageRef, freshRecord.blob, {
          contentType: freshRecord.contentType || 'image/jpeg',
          customMetadata: {
            photoId: freshRecord.id,
            inventoryId: freshRecord.inventoryId,
            adminUid: freshRecord.adminUid
          }
        });

        downloadUrl = await getDownloadURL(uploadResult.ref);

        // CHECKPOINT: Guardar en IndexedDB que Storage ya tiene el archivo
        freshRecord.storageUploaded = true;
        freshRecord.downloadUrl = downloadUrl;
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
      }

      // Re-verificar si fue eliminada mientras subía a Storage (Condición de carrera)
      const checkDeleted = await getPendingPhoto(freshRecord.id);
      if (!checkDeleted || checkDeleted.isDeleted) {
        console.log(`[SyncEngine] Foto ${freshRecord.id} eliminada durante subida. Limpiando Storage.`);
        try {
          const storageRef = ref(storage, freshRecord.storagePath);
          await deleteObject(storageRef);
        } catch (e) {
          // Ignorar
        }
        await deletePhotoRecord(freshRecord.id);
        return;
      }

      // FASE 2: Actualización de Metadatos en Firestore mediante Transacción Concurrente Segura
      let wasPersisted = false;
      let docNotExists = false;
      let spaceNotExists = false;
      let photoWasDeleted = false;

      await runTransaction(db, async (transaction) => {
        const invSnap = await transaction.get(inventoryRef);

        if (!invSnap.exists()) {
          docNotExists = true;
          return;
        }

        const invData = invSnap.data() as Inventory;

        if (freshRecord.isAnnex) {
          const annexes = Array.isArray(invData.annexes) ? [...invData.annexes] : [];
          let annexUpdated = false;
          for (let aIdx = 0; aIdx < annexes.length; aIdx++) {
            const targetAnnex = { ...annexes[aIdx] };
            const photos = Array.isArray(targetAnnex.photos) ? [...targetAnnex.photos] : [];
            const pIdx = photos.findIndex(p => p.id === freshRecord.id || (p as any).localBlobId === freshRecord.id);
            if (pIdx !== -1) {
              const existingPhoto = photos[pIdx];
              photos[pIdx] = {
                ...existingPhoto,
                id: freshRecord.id,
                url: downloadUrl,
                dataUrl: '', // NUNCA Base64
                syncStatus: 'synced',
                storagePath: freshRecord.storagePath,
                timestamp: existingPhoto.timestamp || freshRecord.createdAt
              };
              targetAnnex.photos = photos;
              annexes[aIdx] = targetAnnex;
              annexUpdated = true;
              break;
            }
          }
          if (annexUpdated) {
            transaction.update(inventoryRef, { annexes, updatedAt: Date.now() });
            wasPersisted = true;
          }
        } else {
          const spaces = Array.isArray(invData.spaces) ? [...invData.spaces] : [];
          const spaceIdx = spaces.findIndex(s => s.id === freshRecord.spaceId);

          if (spaceIdx === -1) {
            spaceNotExists = true;
            return;
          }

          const targetSpace = { ...spaces[spaceIdx] };
          // Preservar estrictamente todas las fotografías existentes
          const photos = Array.isArray(targetSpace.photos) ? [...targetSpace.photos] : [];
          const pIdx = photos.findIndex(p => p.id === freshRecord.id || (p as any).localBlobId === freshRecord.id);

          if (pIdx !== -1) {
            // Actualizar la foto existente sin duplicar ni alterar las demás
            const existingPhoto = photos[pIdx];
            photos[pIdx] = {
              ...existingPhoto,
              id: freshRecord.id,
              url: downloadUrl,
              dataUrl: '', // NUNCA Base64
              syncStatus: 'synced',
              storagePath: freshRecord.storagePath,
              timestamp: existingPhoto.timestamp || freshRecord.createdAt
            };
          } else {
            // Antes de hacer photos.push(), confirmar que no haya sido eliminada en UI
            const liveRecord = await getPendingPhoto(freshRecord.id);
            if (!liveRecord || liveRecord.isDeleted) {
              photoWasDeleted = true;
              return; // NO insertar en Firestore
            }

            photos.push({
              id: freshRecord.id,
              url: downloadUrl,
              dataUrl: '',
              timestamp: freshRecord.createdAt,
              syncStatus: 'synced',
              storagePath: freshRecord.storagePath,
              caption: freshRecord.caption || ''
            });
          }
          targetSpace.photos = photos;
          spaces[spaceIdx] = targetSpace;
          transaction.update(inventoryRef, { spaces, updatedAt: Date.now() });
          wasPersisted = true;
        }
      });

      // Si la foto no existe en Firestore y fue eliminada por el usuario en UI, limpiar Storage y BD local
      if (photoWasDeleted) {
        console.log(`[SyncEngine] Foto ${freshRecord.id} no existe en Firestore y fue eliminada por el usuario. Limpiando Storage.`);
        try {
          const storageRef = ref(storage, freshRecord.storagePath);
          await deleteObject(storageRef);
        } catch (e) {
          // Ignorar si ya fue eliminada de Storage
        }
        await deletePhotoRecord(freshRecord.id);
        return;
      }

      // Si el inventario o espacio no estaban disponibles durante la transacción:
      if (docNotExists || spaceNotExists || !wasPersisted) {
        console.log(`[SyncEngine] Documento o espacio para foto ${freshRecord.id} no listo aún en Firestore. Restableciendo status a 'pending' (esperando guardar inventario).`);
        freshRecord.status = 'pending';
        freshRecord.downloadUrl = downloadUrl;
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
        return; // Retorno limpio sin incrementar retryCount
      }

      // FASE 3: Confirmación Final y Liberación del Blob de IndexedDB
      // SOLO eliminamos el Blob de IndexedDB tras confirmar que la transacción en Firestore fue exitosa
      await deletePhotoRecord(freshRecord.id);

      console.log(`[SyncEngine] Foto ${freshRecord.id} sincronizada con éxito en Storage y Firestore.`);
      this.notify({
        type: 'photo_synced',
        photoId: freshRecord.id,
        inventoryId: freshRecord.inventoryId,
        url: downloadUrl
      });
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      // Si recibimos permission-denied al acceder a un inventario no persistido o en transición:
      if (err?.code === 'permission-denied' || errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('permissions')) {
        console.warn(`[SyncEngine] Documento ${freshRecord.inventoryId} no accesible aún en Firestore (posible borrador sin persistir). Manteniendo foto ${freshRecord.id} en IndexedDB en status 'pending'.`);
        freshRecord.status = 'pending';
        freshRecord.downloadUrl = downloadUrl;
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
        return;
      }

      // Solo ante errores genuinos e inesperados se marca como failed
      console.error(`[SyncEngine] Error al sincronizar foto ${freshRecord.id}:`, err);
      freshRecord.status = 'failed';
      freshRecord.retryCount = (freshRecord.retryCount || 0) + 1;
      freshRecord.lastError = err?.message || String(err);
      freshRecord.lastAttemptAt = Date.now();
      await updatePhotoRecord(freshRecord);

      this.notify({
        type: 'photo_failed',
        photoId: freshRecord.id,
        inventoryId: freshRecord.inventoryId,
        error: freshRecord.lastError
      });
    }
  }
}

export const photoSyncEngine = PhotoSyncEngine.getInstance();
