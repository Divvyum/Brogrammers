import { getMessaging } from "firebase-admin/messaging";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { COL } from "@hackos/shared";
import { decrypt } from "../core/crypto.js";
import { app, db } from "../core/firebase.js";
import { render } from "../core/templates.js";
import { env } from "../core/env.js";
import type { WhatsAppTransport } from "./client.js";

const STALE_MS = 2 * 60_000;
export const retryDelay = (attempts: number) => Math.min(15 * 60_000, 1_000 * 2 ** attempts);
export const throttleDelay = () => 1_000 + Math.floor(Math.random() * 1_001);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function claimMessage(doc: DocumentSnapshot, workerId = env.waWorkerId) {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref); if (!fresh.exists || fresh.get("status") !== "queued") return false;
    const retryAt = fresh.get("retryAt") as Timestamp | undefined; if (retryAt && retryAt.toMillis() > Date.now()) return false;
    tx.update(doc.ref, { status: "sending", lockedBy: workerId, lockedAt: FieldValue.serverTimestamp() }); return true;
  });
}

async function deliver(doc: DocumentSnapshot, wa: WhatsAppTransport) {
  const msg = doc.data()!; const uid = msg.to.uid as string;
  const [user, template] = await Promise.all([db.collection(COL.users).doc(uid).get(), db.collection(COL.templates).doc(msg.template).get()]);
  const text = render(template.get("body") ?? msg.vars.reply ?? msg.template, msg.vars ?? {});
  if (msg.channel === "whatsapp") { if (!user.get("phoneEnc")) throw new Error("Participant has no phone"); await wa.sendText(decrypt(user.get("phoneEnc")), text); }
  else if (msg.channel === "email") { const transport = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } }); await transport.sendMail({ from: process.env.GMAIL_USER, to: decrypt(user.get("emailEnc")), subject: msg.template, text }); }
  else { const tokens = (user.get("fcmTokens") as string[]) ?? []; if (!tokens.length) throw new Error("Participant has no push token"); await getMessaging(app).sendEachForMulticast({ tokens, notification: { title: "HACKOS", body: text } }); }
}

export async function recoverStaleLocks(now = Date.now()) {
  const stale = await db.collection(COL.outbox).where("status", "==", "sending").where("lockedAt", "<", Timestamp.fromMillis(now - STALE_MS)).limit(100).get();
  const writer = db.bulkWriter(); stale.docs.forEach((d) => writer.update(d.ref, { status: "queued", lockedBy: FieldValue.delete(), lockedAt: FieldValue.delete() })); await writer.close(); return stale.size;
}

export async function drainOnce(wa: WhatsAppTransport, limit = 20) {
  await recoverStaleLocks();
  const queued = await db.collection(COL.outbox).where("status", "==", "queued").orderBy("priority").orderBy("createdAt").limit(limit).get();
  let sent = 0;
  for (const doc of queued.docs) {
    if (!await claimMessage(doc)) continue;
    const attempts = Number(doc.get("attempts") ?? 0) + 1;
    try { await deliver(doc, wa); await doc.ref.update({ status: "sent", attempts, sentAt: FieldValue.serverTimestamp(), lockedBy: FieldValue.delete(), lockedAt: FieldValue.delete() }); sent++; await db.collection("waStatus").doc("current").set({ sentToday: FieldValue.increment(1), queued: FieldValue.increment(-1) }, { merge: true }); }
    catch (err) { const failed = attempts >= 5; await doc.ref.update({ status: failed ? "failed" : "queued", attempts, lastError: err instanceof Error ? err.message : String(err), retryAt: failed ? FieldValue.delete() : Timestamp.fromMillis(Date.now() + retryDelay(attempts)), lockedBy: FieldValue.delete(), lockedAt: FieldValue.delete() }); if (failed) await db.collection("waStatus").doc("current").set({ failedToday: FieldValue.increment(1), queued: FieldValue.increment(-1) }, { merge: true }); }
    if (doc.get("priority") !== 0) await sleep(throttleDelay());
  }
  return sent;
}

export function startOutboxWorker(wa: WhatsAppTransport) {
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await drainOnce(wa); } catch (e) { console.error("[outbox] drain failed", e); } finally { busy = false; } };
  const timer = setInterval(() => void run(), 3_000); void run();
  return () => clearInterval(timer);
}
