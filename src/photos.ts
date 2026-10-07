import {
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Inventory, Photo } from './types';

/**
 * Cada foto vive en su propio documento:  inventories/{id}/photos/{photoId}
 * (así no se supera el límite de 1 MB por documento y se pueden tener cientos de fotos).
 * El documento del inventario solo guarda texto + contadores.
 */
export interface PhotoDoc {
  id: string;
  dataUrl: string;
  timestamp: number;
  spaceId?: string;
  annexId?: string;
  createdBy: string;
}
export type PhotoTarget = { spaceId: string } | { annexId: string };

const photosCol = (inventoryId: string) => collection(db, 'inventories', inventoryId, 'photos');

/**
 * Firestore con caché offline NO resuelve la promesa de una escritura hasta que
 * el servidor la confirma (sin internet, nunca). La escritura local ya quedó hecha,
 * así que esperamos poco y seguimos; los errores tardíos solo se registran.
 */
export function queued<T>(p: Promise<T>, ms = 1500): Promise<T | undefined> {
  p.catch((e) => console.error('Firestore write failed', e));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export function persistPhoto(inventoryId: string, photo: Photo, target: PhotoTarget, userId: string) {
  return setDoc(doc(photosCol(inventoryId), photo.id), {
    dataUrl: photo.dataUrl,
    timestamp: photo.timestamp,
    createdBy: userId,
    ...target,
  });
}

export const removePhotoDoc = (inventoryId: string, photoId: string) =>
  deleteDoc(doc(photosCol(inventoryId), photoId));

/** Firestore no borra subcolecciones solo: hay que borrar las fotos antes del inventario. */
export async function deleteAllPhotos(inventoryId: string) {
  const snap = await getDocs(photosCol(inventoryId));
  const refs = snap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await queued(batch.commit(), 4000);
  }
}

const toDoc = (d: any): PhotoDoc => ({ id: d.id, ...(d.data() as Omit<PhotoDoc, 'id'>) });

export async function fetchPhotos(inventoryId: string): Promise<PhotoDoc[]> {
  const snap = await getDocs(photosCol(inventoryId));
  return snap.docs.map(toDoc);
}

/** Escucha las fotos de un inventario. Solo notifica cuando algo cambió de verdad. */
export function subscribePhotos(
  inventoryId: string,
  cb: (docs: PhotoDoc[], fromCache: boolean) => void,
  onError: (e: unknown) => void
) {
  let first = true;
  let lastFromCache: boolean | null = null;
  return onSnapshot(
    photosCol(inventoryId),
    { includeMetadataChanges: true },
    (snap) => {
      const changed = first || snap.docChanges().length > 0 || snap.metadata.fromCache !== lastFromCache;
      first = false;
      lastFromCache = snap.metadata.fromCache;
      if (changed) cb(snap.docs.map(toDoc), snap.metadata.fromCache);
    },
    onError
  );
}

const toPhoto = (d: PhotoDoc): Photo => ({ id: d.id, dataUrl: d.dataUrl, timestamp: d.timestamp });
const byTime = (a: Photo, b: Photo) => a.timestamp - b.timestamp;

/**
 * Reparte las fotos de la subcolección dentro de espacios/anexos.
 * - Conserva las fotos en memoria que aún no se han guardado (p. ej. fotos antiguas
 *   que venían dentro del documento y todavía no se migran).
 * - Quita las que ya estaban guardadas y ya no existen (borradas desde otro equipo).
 */
export function applyPhotoSnapshot(inv: Inventory, docs: PhotoDoc[], persisted: Set<string>): Inventory {
  docs.forEach((d) => persisted.add(d.id));
  const place = (existing: Photo[] | undefined, match: (d: PhotoDoc) => boolean): Photo[] => {
    const fromDocs = docs.filter(match).map(toPhoto);
    const inDocs = new Set(fromDocs.map((p) => p.id));
    const keep = (existing || []).filter((p) => !inDocs.has(p.id) && !persisted.has(p.id));
    return [...fromDocs, ...keep].sort(byTime);
  };
  return {
    ...inv,
    spaces: inv.spaces.map((s) => ({ ...s, photos: place(s.photos, (d) => d.spaceId === s.id) })),
    ...(inv.annexes
      ? { annexes: inv.annexes.map((a) => ({ ...a, photos: place(a.photos, (d) => d.annexId === a.id) })) }
      : {}),
  };
}

/** Versión liviana para guardar en el documento del inventario (sin imágenes). */
export function stripPhotos(
  inv: Inventory,
  opts: { photoCount: number; keepEmbedded?: Set<string> }
): Inventory {
  const keep = opts.keepEmbedded ?? new Set<string>();
  const out: Inventory = {
    ...inv,
    photoCount: opts.photoCount,
    spaces: inv.spaces.map((s) => ({ ...s, photos: (s.photos || []).filter((p) => keep.has(p.id)) })),
  };
  if (inv.annexes) {
    out.annexes = inv.annexes.map((a) => ({
      ...a,
      photoCount: Math.max(a.photos?.length ?? 0, a.photoCount ?? 0),
      photos: (a.photos || []).filter((p) => keep.has(p.id)),
    }));
  } else {
    delete out.annexes; // Firestore rechaza valores undefined
  }
  return out;
}
