import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  host: "firestore.googleapis.com",
}, firebaseConfig.firestoreDatabaseId);

// Enable offline persistence to reduce read quota usage
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open, persistence can only be enabled in one tab at a time.
    console.warn('Firestore persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    // The current browser does not support all of the features required to enable persistence
    console.warn('Firestore persistence failed: browser not supported');
  }
});

// Use default storage initialization from app config
export const storage = getStorage(app);
storage.maxUploadRetryTime = 8000; // 8 seconds
storage.maxOperationRetryTime = 8000; // 8 seconds

console.log('Firebase Storage initialized');
