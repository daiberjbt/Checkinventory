import {
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
