import { randomInt, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { auth, db } from "../core/firebase.js";
import { encrypt, hashPhone, normalizePhone, sha256Hex } from "../core/crypto.js";
import { HttpError } from "../core/http.js";
import { enqueue } from "../core/outbox.js";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OtpRequest = z.object({ phone: z.string().min(10), eventId: z.string().min(1) });
export const OtpVerify = OtpRequest.extend({ code: z.string().regex(/^\d{6}$/) });

const otpRef = (phoneHash: string) => db.collection("otpChallenges").doc(phoneHash);
export const otpDigest = (phoneHash: string, code: string) => sha256Hex(`${phoneHash}:${code}`);
export function otpMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requestOtp(phone: string, eventId: string) {
  const normalized = normalizePhone(phone);
  const phoneHash = hashPhone(normalized);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const existing = await db.collection("uniqueKeys").doc(`phone_${phoneHash}`).get();
  const uid = existing.get("uid") as string | undefined;
  const targetUid = uid ?? `pending_${phoneHash.slice(0, 24)}`;
  const phoneEnc = encrypt(normalized);
  await Promise.all([
    otpRef(phoneHash).set({
      phoneHash, phoneEnc, eventId, uid: targetUid,
      digest: otpDigest(phoneHash, code), attempts: 0,
      expiresAt: Timestamp.fromMillis(Date.now() + OTP_TTL_MS), createdAt: FieldValue.serverTimestamp(),
    }),
    // The outbox addresses recipients by uid. A short-lived pending profile lets
    // first-time users receive their OTP before Firebase Auth has issued a uid.
    uid ? Promise.resolve() : db.collection("users").doc(targetUid).set({ phoneHash, phoneEnc, eventId, role: "pending", expiresAt: Timestamp.fromMillis(Date.now() + OTP_TTL_MS) }),
  ]);
  // DEV_OTP is deliberately emulator-only; production always sends via outbox.
  if (process.env.DEV_OTP === "true" && process.env.FIRESTORE_EMULATOR_HOST) return { sent: true, devCode: code };
  await enqueue({ channel: "whatsapp", uid: targetUid, template: "otp", vars: { code }, dedupeKey: `otp_${phoneHash}_${Date.now()}`, eventId });
  return { sent: true };
}

export async function verifyOtp(phone: string, eventId: string, code: string) {
  const normalized = normalizePhone(phone);
  const phoneHash = hashPhone(normalized);
  const ref = otpRef(phoneHash);
  const challenge = await ref.get();
  if (!challenge.exists || challenge.get("eventId") !== eventId) throw new HttpError(401, "BAD_OTP", "Invalid OTP");
  if ((challenge.get("expiresAt") as Timestamp).toMillis() < Date.now()) throw new HttpError(401, "OTP_EXPIRED", "OTP expired");
  const attempts = Number(challenge.get("attempts") ?? 0);
  if (attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, "OTP_LOCKED", "Too many OTP attempts");
  if (!otpMatches(challenge.get("digest"), otpDigest(phoneHash, code))) {
    await ref.update({ attempts: FieldValue.increment(1) });
    throw new HttpError(401, "BAD_OTP", "Invalid OTP");
  }
  let uid = challenge.get("uid") as string;
  if (uid.startsWith("pending_")) {
    const user = await auth.createUser({ phoneNumber: `+${normalized}` }).catch(async () => {
      const found = await auth.getUserByPhoneNumber(`+${normalized}`);
      return found;
    });
    uid = user.uid;
  }
  await Promise.all([
    auth.setCustomUserClaims(uid, { role: "participant", eventId }),
    db.collection("users").doc(uid).set({ role: "participant", eventId, phoneHash, phoneEnc: encrypt(normalized), createdAt: FieldValue.serverTimestamp() }, { merge: true }),
    db.collection("uniqueKeys").doc(`phone_${phoneHash}`).set({ uid, createdAt: FieldValue.serverTimestamp() }, { merge: true }),
    ref.delete(),
    challenge.get("uid") !== uid ? db.collection("users").doc(challenge.get("uid")).delete() : Promise.resolve(),
  ]);
  return { token: await auth.createCustomToken(uid, { role: "participant", eventId }), uid };
}
