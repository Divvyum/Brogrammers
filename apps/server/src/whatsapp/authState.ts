import { proto, BufferJSON, initAuthCreds, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import { FieldValue } from "firebase-admin/firestore";
import { decrypt, encrypt } from "../core/crypto.js";
import { db } from "../core/firebase.js";

const root = db.collection("waSession");
const encode = (value: unknown) => encrypt(JSON.stringify(value, BufferJSON.replacer));
const decode = <T>(value?: string): T | undefined => value ? JSON.parse(decrypt(value), BufferJSON.reviver) as T : undefined;
const safeId = (s: string) => Buffer.from(s).toString("base64url");

/** Firestore auth state. Key mutations are coalesced into one BulkWriter flush. */
export async function useFirestoreAuthState(flushMs = 250): Promise<{ state: AuthenticationState; saveCreds(): Promise<void>; flush(): Promise<void> }> {
  const credsSnap = await root.doc("creds").get();
  const creds = decode<AuthenticationState["creds"]>(credsSnap.get("data")) ?? initAuthCreds();
  const pending = new Map<string, unknown>();
  let timer: NodeJS.Timeout | undefined;

  const flush = async () => {
    if (timer) clearTimeout(timer); timer = undefined;
    const batch = [...pending]; pending.clear();
    if (!batch.length) return;
    const writer = db.bulkWriter();
    for (const [key, value] of batch) {
      const ref = root.doc(`key_${safeId(key)}`);
      if (value == null) writer.delete(ref); else writer.set(ref, { key, data: encode(value), updatedAt: FieldValue.serverTimestamp() });
    }
    await writer.close();
  };
  const schedule = () => { if (!timer) timer = setTimeout(() => void flush().catch(console.error), flushMs); };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const refs = ids.map((id) => root.doc(`key_${safeId(`${type}:${id}`)}`));
        const snaps = refs.length ? await db.getAll(...refs) : [];
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        snaps.forEach((snap, i) => {
          let value = decode<SignalDataTypeMap[T]>(snap.get("data"));
          if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as unknown as Record<string, unknown>) as unknown as SignalDataTypeMap[T];
          if (value) result[ids[i]!] = value;
        });
        return result;
      },
      set: async (updates) => {
        for (const [type, values] of Object.entries(updates)) for (const [id, value] of Object.entries(values ?? {})) pending.set(`${type}:${id}`, value);
        schedule();
      },
    },
  };
  const saveCreds = async () => { await root.doc("creds").set({ data: encode(creds), updatedAt: FieldValue.serverTimestamp() }); };
  return { state, saveCreds, flush };
}
