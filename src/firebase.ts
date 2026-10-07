import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Caché persistente en el dispositivo: la app lee y escribe sin internet
// y Firestore sincroniza solo cuando vuelve la conexión.
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager(undefined),
      cacheSizeBytes: CACHE_SIZE_UNLIMITED, // con cientos de fotos por inventario no se debe purgar la caché
    }),
  },
  firebaseConfig.firestoreDatabaseId
);
