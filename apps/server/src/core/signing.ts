import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonical, type CredentialPayload, type SignedCredential } from "@hackos/shared/crypto";

// Server half of the crypto contract (plan 4.5). Signatures must be raw 64-byte
// P1363 (r||s), which is what WebCrypto verifies; Node's default is DER.

/** Generates the organizer keypair. Run once (scripts/gen-organizer-keys.ts) and keep the private PEM in .env. */
export function generateOrganizerKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicRawB64u: publicKeyRawB64u(publicKey),
  };
}

/** Raw 65-byte uncompressed point, base64url: the format browsers import. */
export function publicKeyRawB64u(publicKey: KeyObject): string {
  // An uncompressed P-256 SPKI DER ends with the 65-byte point.
  return (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-65).toString("base64url");
}

export function signCanonical(privatePem: string, value: unknown): string {
  return sign("sha256", Buffer.from(canonical(value), "utf8"), {
    key: createPrivateKey(privatePem),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

export function signCredential(privatePem: string, payload: CredentialPayload): SignedCredential {
  return { payload, sig: signCanonical(privatePem, payload) };
}
