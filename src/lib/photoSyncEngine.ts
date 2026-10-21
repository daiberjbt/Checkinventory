import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { OfflinePhotoRecord, InventoryPhotoDoc } from '../types';
import {
  getPendingPhotosByAdminUid,
  getPendingPhoto,
  updatePhotoRecord,
  deletePhotoRecord,
  resetStaleUploadingRecords
} from './offlinePhotoDb';
import { createThumbnailBlob } from '../photos';

type SyncListener = (event: {
  type: 'photo_synced' | 'photo_failed' | 'sync_started' | 'sync_finished';
  photoId?: string;
  inventoryId?: string;
  url?: string;
  thumbUrl?: string;
  error?: string;
}) => void;

function getBackoffDelayMs(retryCount: number): number {
  if (retryCount <= 1) return 1 * 60 * 1000;      // 1 min
  if (retryCount === 2) return 2 * 60 * 1000;      // 2 min
  if (retryCount === 3) return 5 * 60 * 1000;      // 5 min
  return 15 * 60 * 1000;                          // 15 min
}

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
        console.warn('[SyncEngine] BroadcastChannel no disponible', e);
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

  public start(adminUid: string, userUid: string): void {
    if (!adminUid) {
      console.warn('[SyncEngine] No se puede iniciar sin adminUid válido');
      return;
    }

    if (this.currentAdminUid === adminUid && this.currentUserUid === userUid && this.intervalId) {
      return;
    }

    this.stop();

    this.currentAdminUid = adminUid;
    this.currentUserUid = userUid;
    this.abortController = new AbortController();

    window.addEventListener('online', this.handleOnlineEvent);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handlePageShow);

    // Heartbeat cada 45 segundos
    this.intervalId = setInterval(() => {
      if (navigator.onLine && this.currentAdminUid) {
        this.processQueue();
      }
    }, 45000);

    if (navigator.onLine) {
      setTimeout(() => this.processQueue(), 500);
    }
  }

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
  }

  public async triggerSync(): Promise<void> {
    try {
      if (navigator.onLine && this.currentAdminUid) {
        if (this.broadcastChannel) {
          try {
            this.broadcastChannel.postMessage({ type: 'TRIGGER_SYNC' });
          } catch (e) {
            // Ignorar
          }
        }
        await this.processQueue();
      }
    } catch (err) {
      console.warn('[SyncEngine] Error en triggerSync:', err);
    }
  }

  public trigger(): void {
    this.triggerSync();
  }

  private handleOnlineEvent = (): void => {
    this.trigger();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.trigger();
    }
  };

  private handlePageShow = (): void => {
    this.trigger();
  };

  /**
   * Procesa la cola de fotografías pendientes garantizando aislamiento de tenant,
   * promesas compartidas, Web Locks y concurrencia de hasta 3 fotos en paralelo.
   */
  public async processQueue(): Promise<void> {
    if (this.isRunning) return;
    if (this.activeSyncPromise) return this.activeSyncPromise;
    if (!this.currentAdminUid) return;
    if (!navigator.onLine) return;
    if (!auth.currentUser) return;

    this.activeSyncPromise = (async () => {
      try {
        if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
          try {
            await navigator.locks.request(
              `checkinventory_photo_sync_${this.currentAdminUid}`,
              { ifAvailable: true },
              async (lock) => {
                if (!lock) return;
                await this.executeQueueProcessing();
              }
            );
            return;
          } catch (lockErr) {
            console.warn('[SyncEngine] WebLock falló, procediendo en standalone:', lockErr);
          }
        }

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
      // 1. Recuperar registros 'uploading' abandonados (> 45s)
      await resetStaleUploadingRecords(adminUid, 45000);

      // 2. Obtener lista de fotografías pendientes para este tenant
      const pendingRecords = await getPendingPhotosByAdminUid(adminUid);
      if (pendingRecords.length === 0) {
        return;
      }

      const now = Date.now();
      // Filtrar fotos elegibles según backoff si están en failed
      const eligibleRecords = pendingRecords.filter(rec => {
        if (rec.status === 'failed') {
          const delay = getBackoffDelayMs(rec.retryCount || 1);
          const elapsed = now - (rec.lastAttemptAt || 0);
          return elapsed >= delay;
        }
        return true;
      });

      if (eligibleRecords.length === 0) {
        return;
      }

      console.log(`[SyncEngine] Procesando ${eligibleRecords.length} fotos elegibles con concurrencia máxima 3`);

      // Procesar en cola con concurrencia de 3 fotos simultáneas
      const CONCURRENCY = 3;
      let currentIndex = 0;

      const runWorker = async () => {
        while (currentIndex < eligibleRecords.length) {
          if (this.currentAdminUid !== adminUid || !auth.currentUser) {
            break;
          }

          const recordToProcess = eligibleRecords[currentIndex];
          currentIndex++;

          try {
            await this.syncSinglePhoto(recordToProcess, adminUid);
          } catch (singleErr) {
            console.error(`[SyncEngine] Error no capturado en syncSinglePhoto (${recordToProcess.id}):`, singleErr);
          }
        }
      };

      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, eligibleRecords.length);
      for (let i = 0; i < workerCount; i++) {
        workers.push(runWorker());
      }

      await Promise.allSettled(workers);
    } catch (err: any) {
      console.error('[SyncEngine] Error general al procesar cola de fotos:', err);
    } finally {
      this.isRunning = false;
      this.notify({ type: 'sync_finished' });
    }
  }

  /**
   * Sincronización idempotente de una única fotografía:
   * 1. Comprueba inventario padre en Firestore.
   * 2. Sube a Storage (imagen + miniatura _thumb en ruta autorizada).
   * 3. Escribe en subcolección inventories/{invId}/photos/{photoId} con setDoc.
   * 4. Elimina el registro local de IndexedDB tras confirmación exitosa.
   */
  private async syncSinglePhoto(record: OfflinePhotoRecord, expectedAdminUid: string): Promise<void> {
    if (record.adminUid !== expectedAdminUid) return;

    // Leer registro fresco
    const freshRecord = await getPendingPhoto(record.id);
    if (!freshRecord || freshRecord.isDeleted) {
      if (freshRecord?.storageUploaded && freshRecord.storagePath) {
        try {
          await deleteObject(ref(storage, freshRecord.storagePath));
          const thumbPath = this.getThumbStoragePath(freshRecord.storagePath);
          await deleteObject(ref(storage, thumbPath));
        } catch (e) {
          // Ignorar si no existían
        }
      }
      await deletePhotoRecord(record.id);
      return;
    }

    if (!navigator.onLine) return;

    // Verificación de existencia del inventario padre en Firestore
    const inventoryRef = doc(db, 'inventories', freshRecord.inventoryId);
    let inventoryExists = this.isInventoryPersisted(freshRecord.inventoryId);

    if (!inventoryExists) {
      try {
        const snap = await getDoc(inventoryRef);
        if (snap.exists()) {
          inventoryExists = true;
          this.markInventoryPersisted(freshRecord.inventoryId);
        }
      } catch (checkErr) {
        inventoryExists = false;
      }
    }

    // Si el inventario aún no existe en Firestore, mantener en 'pending' sin error ni retryCount
    if (!inventoryExists) {
      if (freshRecord.status !== 'pending') {
        freshRecord.status = 'pending';
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
      }
      return;
    }

    freshRecord.status = 'uploading';
    freshRecord.lastAttemptAt = Date.now();
    await updatePhotoRecord(freshRecord);

    const userUid = freshRecord.uploadedBy || freshRecord.userUid || auth.currentUser?.uid || 'user';
    const photoId = freshRecord.id;

    // RUTA AUTORIZADA EN storage.rules:
    // tenants/{adminUid}/photos/{userId}/{photoId}.jpg
    // tenants/{adminUid}/photos/{userId}/{photoId}_thumb.jpg
    const expectedStoragePath = `tenants/${expectedAdminUid}/photos/${userUid}/${photoId}.jpg`;
    const storagePath = freshRecord.storagePath && freshRecord.storagePath.startsWith('tenants/')
      ? freshRecord.storagePath
      : expectedStoragePath;

    const thumbStoragePath = this.getThumbStoragePath(storagePath);

    let downloadUrl = freshRecord.downloadUrl || '';
    let thumbUrl = freshRecord.thumbUrl || '';

    try {
      // FASE 1: Subida Segura a Firebase Storage (Idempotente)
      if (!freshRecord.storageUploaded || !downloadUrl) {
        const storageRef = ref(storage, storagePath);

        let uploadSucceeded = false;
        let lastUploadErr: any = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0 && auth.currentUser) {
              try {
                await auth.currentUser.getIdToken(true);
              } catch (tErr) {
                console.warn('[SyncEngine] Error al refrescar token:', tErr);
              }
            }

            const uploadResult = await uploadBytes(storageRef, freshRecord.blob, {
              contentType: freshRecord.contentType || 'image/jpeg',
              customMetadata: {
                photoId: freshRecord.id,
                inventoryId: freshRecord.inventoryId,
                adminUid: expectedAdminUid
              }
            });

            downloadUrl = await getDownloadURL(uploadResult.ref);
            uploadSucceeded = true;
            break;
          } catch (sErr: any) {
            lastUploadErr = sErr;
            const sCode = String(sErr?.code || '');
            if (sCode === 'storage/unauthorized' && attempt === 0 && auth.currentUser) {
              console.warn('[SyncEngine] storage/unauthorized detectado. Refrescando token y reintentando...');
              continue;
            }
            break;
          }
        }

        if (!uploadSucceeded) {
          throw lastUploadErr;
        }

        // Subida de miniatura _thumb
        if (!thumbUrl) {
          try {
            let thumbBlob = freshRecord.thumbBlob;
            if (!thumbBlob) {
              // Generar dinámicamente si no existía en el registro local
              thumbBlob = await createThumbnailBlob(freshRecord.blob, 320, 0.7);
            }

            if (thumbBlob) {
              const thumbRef = ref(storage, thumbStoragePath);
              const thumbUpload = await uploadBytes(thumbRef, thumbBlob, {
                contentType: 'image/jpeg',
                customMetadata: {
                  photoId: `${freshRecord.id}_thumb`,
                  inventoryId: freshRecord.inventoryId,
                  adminUid: expectedAdminUid
                }
              });
              thumbUrl = await getDownloadURL(thumbUpload.ref);
            }
          } catch (thumbErr) {
            console.warn('[SyncEngine] No se pudo generar o subir miniatura, continuando sin thumbUrl:', thumbErr);
            // NUNCA bloquear la subida por falta de miniatura
            thumbUrl = '';
          }
        }

        // Guardar Checkpoint de Storage en IndexedDB
        freshRecord.storageUploaded = true;
        freshRecord.storagePath = storagePath;
        freshRecord.downloadUrl = downloadUrl;
        freshRecord.thumbUrl = thumbUrl;
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);
      }

      // Re-verificar si fue eliminada por el usuario mientras subía
      const checkDeleted = await getPendingPhoto(freshRecord.id);
      if (!checkDeleted || checkDeleted.isDeleted) {
        try {
          await deleteObject(ref(storage, storagePath));
          if (thumbUrl) {
            await deleteObject(ref(storage, thumbStoragePath));
          }
        } catch (e) {
          // Ignorar
        }
        await deletePhotoRecord(freshRecord.id);
        return;
      }

      // FASE 2: Escritura directa en subcolección Firestore inventories/{id}/photos/{photoId}
      // NUNCA toca el documento principal de inventario.
      // Regla de validación: (('spaceId' in d) != ('annexId' in d))
      const isAnnex = Boolean(freshRecord.isAnnex || freshRecord.annexId);
      const targetSpaceOrAnnexId = freshRecord.annexId || freshRecord.spaceId || '';

      const photoDocRef = doc(db, 'inventories', freshRecord.inventoryId, 'photos', freshRecord.id);

      // IMPORTANTE: El timestamp es SIEMPRE la fecha de captura original (createdAt), NUNCA Date.now()
      const photoDocData: Record<string, any> = {
        id: freshRecord.id,
        storagePath,
        url: downloadUrl,
        timestamp: freshRecord.createdAt,
        createdBy: freshRecord.uploadedBy || freshRecord.userUid || auth.currentUser?.uid || 'user'
      };

      if (isAnnex) {
        photoDocData.annexId = targetSpaceOrAnnexId;
      } else {
        photoDocData.spaceId = targetSpaceOrAnnexId;
      }

      if (thumbUrl) {
        photoDocData.thumbUrl = thumbUrl;
      }
      if (freshRecord.caption) {
        photoDocData.caption = freshRecord.caption;
      }

      // setDoc idempotente
      await setDoc(photoDocRef, photoDocData);

      // FASE 3: Confirmación y liberación de Blob local en IndexedDB
      await deletePhotoRecord(freshRecord.id);

      console.log(`[SyncEngine] Foto ${freshRecord.id} subida con éxito a subcolección.`);
      this.notify({
        type: 'photo_synced',
        photoId: freshRecord.id,
        inventoryId: freshRecord.inventoryId,
        url: downloadUrl,
        thumbUrl
      });
    } catch (err: any) {
      const errCode = String(err?.code || '');
      const errMsg = String(err?.message || err);

      if (errCode.startsWith('storage/')) {
        let readableError = 'Error al subir imagen a Storage';
        if (errCode === 'storage/unauthorized') {
          readableError = 'Sin autorización para escribir en Storage (verifique sesión)';
        } else if (errCode === 'storage/quota-exceeded') {
          readableError = 'Cuota de almacenamiento superada en Storage';
        } else if (errCode === 'storage/retry-limit-exceeded') {
          readableError = 'Límite de intentos de conexión con Storage agotado';
        }

        console.error(`[SyncEngine] Error de Storage en foto ${freshRecord.id} (${errCode}):`, readableError);
        freshRecord.status = 'failed';
        freshRecord.retryCount = (freshRecord.retryCount || 0) + 1;
        freshRecord.lastError = readableError;
        freshRecord.lastAttemptAt = Date.now();
        await updatePhotoRecord(freshRecord);

        this.notify({
          type: 'photo_failed',
          photoId: freshRecord.id,
          inventoryId: freshRecord.inventoryId,
          error: readableError
        });
        return;
      }

      // Si es error de Firestore
      let readableError = 'Error al registrar foto en base de datos';
      if (errCode === 'permission-denied' || errMsg.toLowerCase().includes('permission-denied')) {
        readableError = 'Permiso denegado en Firestore para registrar la foto';
      }

      console.error(`[SyncEngine] Error de Firestore en foto ${freshRecord.id}:`, err);
      freshRecord.status = 'failed';
      freshRecord.retryCount = (freshRecord.retryCount || 0) + 1;
      freshRecord.lastError = `${readableError}: ${errMsg}`;
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

  private getThumbStoragePath(originalPath: string): string {
    if (originalPath.endsWith('.jpg')) {
      return originalPath.replace(/\.jpg$/, '_thumb.jpg');
    }
    if (originalPath.endsWith('.jpeg')) {
      return originalPath.replace(/\.jpeg$/, '_thumb.jpeg');
    }
    return `${originalPath}_thumb`;
  }
}

export const photoSyncEngine = PhotoSyncEngine.getInstance();
