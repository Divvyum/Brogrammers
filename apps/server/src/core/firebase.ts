import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "./env.js";

// With FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST set, the Admin SDK
// talks to the local emulators and needs no credentials. Otherwise it uses the
// service account file named in GOOGLE_APPLICATION_CREDENTIALS, loaded with
// cert() so custom login tokens are signed locally with its private key
// (applicationDefault() would call the IAM signBlob API instead).
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
export const app = initializeApp(
  env.usingEmulators
    ? { projectId: env.projectId }
    : { projectId: env.projectId, credential: keyFile ? cert(keyFile) : applicationDefault() },
);

export const auth = getAuth(app);
export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
