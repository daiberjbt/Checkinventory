import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import type { Inventory, InventorySpace, Annex, Photo, OfflinePhotoRecord, InventoryPhotoDoc } from './types';

export const photosCollection = (inventoryId: string) =>
  collection(db, 'inventories', inventoryId, 'photos');

/**
 * Consulta todas las fotografías sincronizadas en la subcolección del inventario.
 */
export async function fetchPhotos(inventoryId: string): Promise<InventoryPhotoDoc[]> {
  if (!inventoryId) return [];
  const snap = await getDocs(photosCollection(inventoryId));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<InventoryPhotoDoc, 'id'>) }));
}

/**
 * Escucha en tiempo real la subcolección de fotos de un inventario abierto.
 */
export function subscribePhotos(
  inventoryId: string,
  onUpdate: (photos: InventoryPhotoDoc[]) => void,
  onError?: (error: any) => void
): () => void {
  if (!inventoryId) return () => {};
  return onSnapshot(
    photosCollection(inventoryId),
    (snap) => {
      const photos = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<InventoryPhotoDoc, 'id'>)
      }));
      onUpdate(photos);
    },
    (err) => {
      console.warn(`[Photos] Error en onSnapshot de fotos para ${inventoryId}:`, err);
      if (onError) onError(err);
    }
  );
}

/**
 * Elimina todas las fotos de la subcolección en lotes de 400 documentos antes de borrar el inventario.
 */
export async function deleteAllPhotos(inventoryId: string): Promise<void> {
  if (!inventoryId) return;
  const snap = await getDocs(photosCollection(inventoryId));
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = refs.slice(i, i + 400);
    chunk.forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

/**
 * COMPATIBILIDAD: Combina fotos antiguas embebidas en el documento + fotos sincronizadas
 * de la subcolección + fotos locales pendientes de IndexedDB sin duplicados por ID.
 * Si el ID existe en la subcolección, gana la foto sincronizada.
 */
export function getPhotosOf(
  container: InventorySpace | Annex,
  subcollectionPhotos: InventoryPhotoDoc[] = [],
  pendingLocalPhotos: OfflinePhotoRecord[] = []
): Photo[] {
  if (!container) return [];

  const isAnnex = 'text' in container;
  const containerId = container.id;

  // 1. Fotos antiguas embebidas en el documento
  const rawLegacyPhotos: Photo[] = Array.isArray(container.photos) ? container.photos : [];

  // 2. Fotos de la subcolección para este espacio o anexo
  const matchedSubDocs = subcollectionPhotos.filter(doc => {
    if (isAnnex) {
      return doc.annexId === containerId;
    }
    return doc.spaceId === containerId;
  });

  // 3. Fotos locales pendientes en IndexedDB
  const matchedPendingRecords = pendingLocalPhotos.filter(rec => {
    if (rec.isDeleted) return false;
    if (isAnnex) {
      return rec.annexId === containerId || (rec.isAnnex && rec.spaceId === containerId);
    }
    return !rec.isAnnex && rec.spaceId === containerId;
  });

  const photoMap = new Map<string, Photo>();

  // Primer paso: Fotos antiguas
  for (const legacy of rawLegacyPhotos) {
    if (!legacy || !legacy.id) continue;
    photoMap.set(legacy.id, {
      ...legacy,
      syncStatus: legacy.syncStatus || 'synced'
    });
  }

  // Segundo paso: Fotos locales pendientes (reemplazan o agregan)
  for (const pending of matchedPendingRecords) {
    const pendingPhoto: Photo = {
      id: pending.id,
      url: pending.downloadUrl || '',
      thumbUrl: pending.thumbUrl || '',
      storagePath: pending.storagePath,
      localBlobId: pending.id,
      syncStatus: pending.status === 'synced' ? 'synced' : (pending.status || 'pending'),
      caption: pending.caption || '',
      timestamp: pending.createdAt
    };
    photoMap.set(pending.id, pendingPhoto);
  }

  // Tercer paso: Subcolección (GANA SIEMPRE la foto sincronizada en caso de coincidencia)
  for (const doc of matchedSubDocs) {
    photoMap.set(doc.id, {
      id: doc.id,
      url: doc.url,
      thumbUrl: doc.thumbUrl,
      storagePath: doc.storagePath,
      syncStatus: 'synced',
      caption: doc.caption || '',
      timestamp: doc.timestamp
    });
  }

  return Array.from(photoMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Sanitiza y prepara el documento de inventario para guardarlo en Firestore sin re-incrustar fotos.
 * Conserva ÚNICAMENTE las fotos históricas que ya venían embebidas originalmente en el documento.
 * NUNCA incluye fotos provenientes de la subcolección ni marcadores locales (localBlobId, syncStatus pending/uploading).
 */
export function stripPhotosForSave(
  inventory: Inventory,
  originalInventory?: Inventory | null,
  totalPhotoCount?: number
): { spaces: InventorySpace[]; annexes?: Annex[]; photoCount: number } {
  // Construir mapa de IDs de fotos que ya estaban originalmente embebidas en el documento remoto
  const legacyPhotoIds = new Set<string>();
  if (originalInventory) {
    if (Array.isArray(originalInventory.spaces)) {
      originalInventory.spaces.forEach(s => {
        if (Array.isArray(s.photos)) {
          s.photos.forEach(p => {
            if (p && p.id && !p.localBlobId && (p.url || p.dataUrl)) {
              legacyPhotoIds.add(p.id);
            }
          });
        }
      });
    }
    if (Array.isArray(originalInventory.annexes)) {
      originalInventory.annexes.forEach(a => {
        if (Array.isArray(a.photos)) {
          a.photos.forEach(p => {
            if (p && p.id && !p.localBlobId && (p.url || p.dataUrl)) {
              legacyPhotoIds.add(p.id);
            }
          });
        }
      });
    }
  }

  // Limpiar spaces
  const cleanSpaces: InventorySpace[] = (inventory.spaces || []).map(space => {
    const rawPhotos = Array.isArray(space.photos) ? space.photos : [];
    const keptPhotos = rawPhotos.filter(p => {
      if (!p || !p.id) return false;
      // NUNCA guardar fotos locales o pendientes en el documento
      if (p.localBlobId) return false;
      if (p.syncStatus && p.syncStatus !== 'synced') return false;
      // Si tenemos registro del documento original, solo conservar si ya estaba embebida
      if (originalInventory) {
        return legacyPhotoIds.has(p.id);
      }
      // Si no tenemos documento original (ej. primer guardado), no embebemos fotos
      return false;
    });

    return {
      ...space,
      photos: keptPhotos
    };
  });

  // Limpiar annexes
  let cleanAnnexes: Annex[] | undefined = undefined;
  if (Array.isArray(inventory.annexes)) {
    cleanAnnexes = inventory.annexes.map(annex => {
      const rawPhotos = Array.isArray(annex.photos) ? annex.photos : [];
      const keptPhotos = rawPhotos.filter(p => {
        if (!p || !p.id) return false;
        if (p.localBlobId) return false;
        if (p.syncStatus && p.syncStatus !== 'synced') return false;
        if (originalInventory) {
          return legacyPhotoIds.has(p.id);
        }
        return false;
      });

      return {
        ...annex,
        photos: keptPhotos,
        photoCount: typeof annex.photoCount === 'number' ? annex.photoCount : rawPhotos.length
      };
    });
  }

  const computedPhotoCount = typeof totalPhotoCount === 'number'
    ? totalPhotoCount
    : (typeof inventory.photoCount === 'number' ? inventory.photoCount : 0);

  return {
    spaces: cleanSpaces,
    ...(cleanAnnexes ? { annexes: cleanAnnexes } : {}),
    photoCount: computedPhotoCount
  };
}

/**
 * Genera una miniatura JPEG de ~320 px (calidad 0.7) en canvas a partir de un Blob de imagen.
 */
export async function createThumbnailBlob(blob: Blob, maxDim = 320, quality = 0.7): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window no disponible para canvas'));
    }

    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(width, 1);
        canvas.height = Math.max(height, 1);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('No se pudo obtener el contexto 2D del canvas'));
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (thumbBlob) => {
            if (thumbBlob) {
              resolve(thumbBlob);
            } else {
              reject(new Error('toBlob retornó null'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('Error al cargar imagen en objeto Image para miniatura'));
    };

    img.src = url;
  });
}
