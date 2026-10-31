import { describe, expect, it } from "vitest";
import {
  b64u,
  CHAIN_GENESIS,
  canonical,
  challengeMessage,
  computeEntryHash,
  utf8,
  verifyChain,
  verifyCredential,
  verifyDeviceResponse,
  type ChainEntryBody,
  type CredentialPayload,
} from "@hackos/shared/crypto";
import { generateOrganizerKeys, signCredential } from "../src/core/signing.js";

// The server signs with node:crypto; the verifier side uses only WebCrypto
// (crypto.subtle), the same code path the browsers run.

async function makeDevice() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const pub = b64u.enc(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return { keyPair, pub };
}

function payloadFor(devicePubKey: string): CredentialPayload {
  return {
    v: 1,
    eventId: "evt_test",
    participantId: "p_1",
    teamId: "t_1",
    devicePubKey,
    issuedAt: "2026-11-01T09:00:00Z",
    expiresAt: "2026-11-04T23:59:59Z",
  };
}

/** Flips one byte of a base64url string's decoded bytes. */
function flipByte(s: string, at = 0) {
  const bytes = b64u.dec(s);
  bytes[at] = bytes[at]! ^ 0x01;
  return b64u.enc(bytes);
}

describe("server-signed credential, WebCrypto verifier", () => {
  it("verifies, with a raw 65-byte key and a raw 64-byte signature", async () => {
    const org = generateOrganizerKeys();
    const device = await makeDevice();
    const cred = signCredential(org.privatePem, payloadFor(device.pub));

    expect(b64u.dec(org.publicRawB64u)).toHaveLength(65);
    expect(b64u.dec(cred.sig)).toHaveLength(64);
    expect(await verifyCredential(org.publicRawB64u, cred)).toBe(true);
  });

  it("fails when one byte of the payload changes", async () => {
    const org = generateOrganizerKeys();
    const device = await makeDevice();
    const cred = signCredential(org.privatePem, payloadFor(device.pub));

    const tampered = { ...cred, payload: { ...cred.payload, participantId: "p_2" } };
    expect(await verifyCredential(org.publicRawB64u, tampered)).toBe(false);
  });

  it("fails when one byte of the signature changes", async () => {
    const org = generateOrganizerKeys();
    const device = await makeDevice();
    const cred = signCredential(org.privatePem, payloadFor(device.pub));

    expect(await verifyCredential(org.publicRawB64u, { ...cred, sig: flipByte(cred.sig) })).toBe(false);
    expect(await verifyCredential(org.publicRawB64u, { ...cred, sig: flipByte(cred.sig, 63) })).toBe(
      false,
    );
  });

  it("fails against a different organizer key", async () => {
    const org = generateOrganizerKeys();
    const other = generateOrganizerKeys();
    const device = await makeDevice();
    const cred = signCredential(org.privatePem, payloadFor(device.pub));

    expect(await verifyCredential(other.publicRawB64u, cred)).toBe(false);
  });

  it("does not depend on key order in the payload", async () => {
    const org = generateOrganizerKeys();
    const device = await makeDevice();
    const p = payloadFor(device.pub);
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as CredentialPayload;
    const cred = signCredential(org.privatePem, reordered);

    expect(await verifyCredential(org.publicRawB64u, { ...cred, payload: p })).toBe(true);
  });
});

describe("device challenge response", () => {
  const m = { n: "nonce123", vid: "vd_1", ev: "evt_test", pid: "p_1" };

  async function respond(device: Awaited<ReturnType<typeof makeDevice>>, msg = m) {
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      device.keyPair.privateKey,
      utf8(challengeMessage(msg)),
    );
    return b64u.enc(sig);
  }

  it("verifies a response from the enrolled device", async () => {
    const device = await makeDevice();
    expect(await verifyDeviceResponse(device.pub, m, await respond(device))).toBe(true);
  });

  it("rejects a response to a different challenge (replayed screenshot)", async () => {
    const device = await makeDevice();
    const sig = await respond(device);
    expect(await verifyDeviceResponse(device.pub, { ...m, n: "other" }, sig)).toBe(false);
  });

  it("rejects a response signed by another device (cloned ID)", async () => {
    const enrolled = await makeDevice();
    const clone = await makeDevice();
    expect(await verifyDeviceResponse(enrolled.pub, m, await respond(clone))).toBe(false);
  });

  it("returns false instead of throwing on garbage input", async () => {
    expect(await verifyDeviceResponse("not-a-key", m, "not-a-sig")).toBe(false);
  });
});

describe("check-in hash chain", () => {
  async function buildChain(n: number) {
    const entries: (ChainEntryBody & { entryHash: string })[] = [];
    let prevHash = CHAIN_GENESIS;
    for (let i = 0; i < n; i++) {
      const body: ChainEntryBody = {
        id: `uuid-${i}`,
        eventId: "evt_test",
        participantId: `p_${i}`,
        deviceId: "vd_1",
        volunteerUid: "vol_1",
        ts: new Date(Date.UTC(2026, 10, 2, 9, i)).toISOString(),
        method: "qr",
        result: "valid",
        prevHash,
      };
      const entryHash = await computeEntryHash(body);
      entries.push({ ...body, entryHash });
      prevHash = entryHash;
    }
    return entries;
  }

  it("accepts an untouched chain", async () => {
    expect(await verifyChain(await buildChain(5))).toBe(-1);
  });

  it("finds an edited entry", async () => {
    const chain = await buildChain(5);
    chain[2] = { ...chain[2]!, participantId: "p_someone_else" };
    expect(await verifyChain(chain)).toBe(2);
  });

  it("finds a deleted entry", async () => {
    const chain = await buildChain(5);
    chain.splice(1, 1);
    expect(await verifyChain(chain)).toBe(1);
  });
});

describe("canonical JSON", () => {
  it("sorts keys at every level and has no spaces", () => {
    expect(canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("drops undefined keys like JSON.stringify", () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
  });
});
