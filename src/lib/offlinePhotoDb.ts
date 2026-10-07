import { OfflinePhotoRecord } from '../types';

const DB_NAME = 'CheckInventoryLocalDB';
const DB_VERSION = 1;
const STORE_NAME = 'photo_sync_queue';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openPhotoDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB no está disponible en este entorno.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_adminUid', 'adminUid', { unique: false });
        store.createIndex('by_inventoryId', 'inventoryId', { unique: false });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Error al abrir CheckInventoryLocalDB'));
    };

    request.onblocked = () => {
      console.warn('[IndexedDB] Apertura bloqueada por otra pestaña con versión antigua');
    };
  });

  return dbPromise;
}

export async function savePendingPhoto(record: OfflinePhotoRecord): Promise<void> {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = (e) => {
        const error = (e.target as IDBRequest).error;
        if (error && (error.name === 'QuotaExceededError' || error.name === 'QuotaExceeded')) {
          console.error('[IndexedDB] Almacenamiento local agotado (QuotaExceededError)', error);
        }
        reject(error || new Error('Error al guardar foto en IndexedDB'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function getPendingPhoto(id: string): Promise<OfflinePhotoRecord | null> {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Error al leer foto ${id}`));
    } catch (err) {
      reject(err);
    }
  });
}

export async function getPendingPhotosByAdminUid(adminUid: string): Promise<OfflinePhotoRecord[]> {
  if (!adminUid) return [];
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_adminUid');
      const request = index.getAll(IDBKeyRange.only(adminUid));

      request.onsuccess = () => {
        const records: OfflinePhotoRecord[] = request.result || [];
        // Filtrar registros no eliminados y ordenar por fecha de creación ascendente
        const validRecords = records
          .filter(r => !r.isDeleted && r.status !== 'synced')
          .sort((a, b) => a.createdAt - b.createdAt);
        resolve(validRecords);
      };
      request.onerror = () => reject(request.error || new Error('Error al listar fotos por adminUid'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function getPendingPhotosByInventory(inventoryId: string): Promise<OfflinePhotoRecord[]> {
  if (!inventoryId) return [];
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_inventoryId');
      const request = index.getAll(IDBKeyRange.only(inventoryId));

      request.onsuccess = () => {
        const records: OfflinePhotoRecord[] = request.result || [];
        resolve(records.filter(r => !r.isDeleted));
      };
      request.onerror = () => reject(request.error || new Error('Error al listar fotos por inventoryId'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function updatePhotoRecord(record: OfflinePhotoRecord): Promise<void> {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Error al actualizar foto ${record.id}`));
    } catch (err) {
      reject(err);
    }
  });
}

export async function markPhotoDeleted(id: string): Promise<void> {
  const record = await getPendingPhoto(id);
  if (!record) return;

  if (record.status === 'uploading') {
    // Si está subiendo actualmente, marcar como eliminada (tombstone) para que el Sync Engine no la inyecte en Firestore
    record.isDeleted = true;
    await updatePhotoRecord(record);
  } else {
    // Si no está subiendo, eliminarla inmediatamente de IndexedDB
    await deletePhotoRecord(id);
  }
}

export async function deletePhotoRecord(id: string): Promise<void> {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Error al eliminar foto ${id}`));
    } catch (err) {
      reject(err);
    }
  });
}

export async function deletePhotosByInventory(inventoryId: string): Promise<void> {
  const records = await getPendingPhotosByInventory(inventoryId);
  for (const rec of records) {
    await deletePhotoRecord(rec.id);
  }
}

/**
 * Detecta registros que quedaron en estado 'uploading' por más de maxAgeMs (ej. cierre de pestaña)
 * y los restablece a 'pending' preservando el checkpoint si ya subieron a Storage.
 */
export async function resetStaleUploadingRecords(adminUid: string, maxAgeMs = 45000): Promise<number> {
  if (!adminUid) return 0;
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_adminUid');
      const request = index.getAll(IDBKeyRange.only(adminUid));

      request.onsuccess = async () => {
        const records: OfflinePhotoRecord[] = request.result || [];
        const now = Date.now();
        let resetCount = 0;

        for (const record of records) {
          if (record.status === 'uploading') {
            const age = now - (record.lastAttemptAt || record.createdAt);
            if (age > maxAgeMs) {
              record.status = 'pending';
              record.lastAttemptAt = now;
              store.put(record);
              resetCount++;
            }
          }
        }
        resolve(resetCount);
      };
      request.onerror = () => reject(request.error || new Error('Error al resetear registros stale'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function getPhotoBlob(id: string): Promise<Blob | null> {
  const record = await getPendingPhoto(id);
  return record?.blob || null;
}

/**
 * Consulta la estimación de almacenamiento de la API de Storage del navegador
 */
export async function getStorageEstimate(): Promise<{ usage?: number; quota?: number; isLowSpace: boolean }> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      // Menos de 20 MB disponibles = espacio bajo
      const isLowSpace = quota > 0 && quota - usage < 20 * 1024 * 1024;
      return { usage, quota, isLowSpace };
    }
  } catch (e) {
    console.warn('[StorageEstimate] No disponible', e);
  }
  return { isLowSpace: false };
}
