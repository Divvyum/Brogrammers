import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { HttpError } from "./http.js";

// Food pass (plan D21, M15): a short-lived signed token the participant app
// shows as a QR. The counter scan is online, so a server HMAC is enough here
// (the offline check-in uses device signatures instead).

export const FOOD_PASS_TTL_MS = 15 * 60_000;

const key = () => createHmac("sha256", env.hashKey).update("food-pass-v1").digest();
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

/** Manthan's participant app endpoint calls this to show the QR. */
export function issueFoodPass(eventId: string, uid: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: eventId, u: uid, x: now + FOOD_PASS_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyFoodPass(token: string, eventId: string, now = Date.now()): { uid: string } {
  const [payload, sig] = token.split(".");
  const bad = (msg: string) => new HttpError(400, "BAD_FOOD_PASS", msg);
  if (!payload || !sig) throw bad("Not a food pass");
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw bad("Food pass signature is invalid");

  let data: { e: string; u: string; x: number };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw bad("Not a food pass");
  }
  if (data.e !== eventId) throw bad("Food pass is for a different event");
  if (data.x < now) throw bad("Food pass expired, ask the participant to refresh it");
  return { uid: data.u };
}
