import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS !== "false";

export const app = initializeApp({
  // Firebase's client SDK requires a non-empty API key even when connected to
  // the local Auth emulator. Production still uses the configured Vite values.
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (useEmulators ? "demo-key" : ""),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (useEmulators ? "localhost" : ""),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? "brogramming-ae10d" : ""),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
});

export const auth = getAuth(app);
// Offline persistence: reads come from the local cache and writes queue until online.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
