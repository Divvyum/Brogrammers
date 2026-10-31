import { canonical } from "./canonical.js";
import { b64u, toHex, utf8 } from "./encoding.js";
import { CHAIN_GENESIS, type ChainEntryBody, type SignedCredential } from "./types.js";

// WebCrypto only (crypto.subtle), so this runs unchanged in browsers and in Node.

const ECDSA_KEY = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIG = { name: "ECDSA", hash: "SHA-256" } as const;

/** Verifies a raw 64-byte P1363 signature over the UTF-8 bytes of `message`. */
export async function verifySig(pubKeyB64u: string, message: string, sigB64u: string) {
  try {
    const key = await crypto.subtle.importKey("raw", b64u.dec(pubKeyB64u), ECDSA_KEY, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(ECDSA_SIG, key, b64u.dec(sigB64u), utf8(message));
  } catch {
    // Malformed key or signature bytes count as a failed verification.
    return false;
  }
}

/** Check 2: the credential was signed by the organizer. */
export function verifyCredential(organizerPubKey: string, cred: SignedCredential) {
  return verifySig(organizerPubKey, canonical(cred.payload), cred.sig);
}

/** What the participant device signs: binds the nonce to this volunteer, event and participant. */
export function challengeMessage(m: { n: string; vid: string; ev: string; pid: string }) {
  return canonical({ n: m.n, vid: m.vid, ev: m.ev, pid: m.pid });
}

/** Check 7: the response was signed by the device the credential was issued to. */
export function verifyDeviceResponse(
  devicePubKey: string,
  m: { n: string; vid: string; ev: string; pid: string },
  sig: string,
) {
  return verifySig(devicePubKey, challengeMessage(m), sig);
}

export async function sha256Hex(s: string) {
  return toHex(await crypto.subtle.digest("SHA-256", utf8(s)));
}

/**
 * Hash of a participant's backup code, as stored in the roster. The scanner hashes
 * what the volunteer types and compares, so this works offline.
 */
export function backupCodeHash(eventId: string, code: string) {
  return sha256Hex(`backup:${eventId}:${code.trim().toUpperCase()}`);
}

export function computeEntryHash(body: ChainEntryBody) {
  return sha256Hex(canonical(body));
}

/**
 * Verifies one device's check-in log, in order. Returns the index of the first
 * entry whose hash or prevHash link is wrong, or -1 if the whole chain is intact.
 */
export async function verifyChain(entries: (ChainEntryBody & { entryHash: string })[]) {
  let prev = CHAIN_GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const { entryHash, ...body } = entries[i]!;
    if (body.prevHash !== prev || (await computeEntryHash(body)) !== entryHash) return i;
    prev = entryHash;
  }
  return -1;
}
