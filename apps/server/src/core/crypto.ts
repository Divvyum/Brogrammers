import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "./env.js";

// Phone numbers and emails are stored encrypted (AES-256-GCM) next to a keyed
// hash used for lookups and duplicate checks (plan D3).

function encKey(): Buffer {
  const key = Buffer.from(env.dataEncKey, "base64");
  if (key.length !== 32) throw new Error("DATA_ENC_KEY must be 32 bytes, base64");
  return key;
}

/** Returns `iv.ciphertext.tag`, each base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, ct, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, ct, tag] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !ct || !tag) throw new Error("Malformed encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Keeps digits only and assumes India (+91) for 10-digit numbers. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

/** Keyed SHA-256 for lookups. Same input always gives the same hash. */
export function lookupHash(value: string): string {
  return createHmac("sha256", env.hashKey).update(value).digest("hex");
}

export const hashEmail = (email: string) => lookupHash(normalizeEmail(email));
export const hashPhone = (phone: string) => lookupHash(normalizePhone(phone));

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** High-entropy URL-safe token (enrollment links). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hides most of a phone number or email for volunteers (plan D29). */
export function mask(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***${value.slice(at)}`;
  return value.length > 4 ? `${"*".repeat(value.length - 4)}${value.slice(-4)}` : "****";
}
