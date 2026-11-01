import {
  b64u,
  challengeMessage,
  Challenge,
  type SignedCredential,
  utf8,
} from "@hackos/shared/crypto";
import { api } from "./lib/api";

const DB = "hackos-participant";
const STORE = "digital-id";
type SavedId = { key: CryptoKey; credential: SignedCredential; backupCode: string };

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadId(): Promise<SavedId | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enrollId(): Promise<SavedId> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const devicePubKey = b64u.enc(await crypto.subtle.exportKey("raw", pair.publicKey));
  const result = await api<{ credential: SignedCredential; backupCode: string }>("/id/enroll", {
    method: "POST",
    body: { devicePubKey },
  });
  const saved = {
    key: pair.privateKey,
    credential: result.credential,
    backupCode: result.backupCode,
  };
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(saved, "current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return saved;
}

export async function respondToChallenge(raw: string) {
  const challenge = Challenge.parse(JSON.parse(raw));
  const saved = await loadId();
  if (!saved) throw new Error("Enroll this device first");
  if (challenge.ev !== saved.credential.payload.eventId)
    throw new Error("This QR belongs to another event");
  const message = challengeMessage({
    n: challenge.n,
    vid: challenge.vid,
    ev: challenge.ev,
    pid: saved.credential.payload.participantId,
  });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    saved.key,
    utf8(message),
  );
  return JSON.stringify({ t: "resp", cred: saved.credential, sig: b64u.enc(signature) });
}
