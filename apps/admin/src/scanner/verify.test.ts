import { describe, expect, it } from "vitest";
import { b64u, canonical, challengeMessage, type SignedCredential, utf8 } from "@hackos/shared/crypto";
import { verifyResponse, type PendingChallenge, type RosterEntry, type VerifyContext } from "./verify";

// A13: the scanner's 8 checks, with keys made the same way the server (organizer)
// and the participant app (device) make them.

const E = "evt_test";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG = { name: "ECDSA", hash: "SHA-256" } as const;

async function keypair() {
  const kp = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
  return { kp, pub: b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey)) };
}
const sign = async (key: CryptoKey, msg: string) => b64u.enc(await crypto.subtle.sign(SIG, key, utf8(msg)));

async function setup(overrides: { expiresAt?: string; eventId?: string } = {}) {
  const org = await keypair();
  const device = await keypair();
  const payload = {
    v: 1 as const,
    eventId: overrides.eventId ?? E,
    participantId: "p1",
    teamId: "t1",
    devicePubKey: device.pub,
    issuedAt: "2026-11-01T00:00:00Z",
    expiresAt: overrides.expiresAt ?? "2099-01-01T00:00:00Z",
  };
  const cred: SignedCredential = { payload, sig: await sign(org.kp.privateKey, canonical(payload)) };
  const entry: RosterEntry = {
    participantId: "p1", name: "Asha Rao", college: "SAKEC", teamId: "t1", teamName: "Ctrl", roomId: "r1", seat: "A101-3",
    photoUrl: null, devicePubKey: device.pub, status: "enrolled", backupCodeHash: null, checkedInAt: null,
  };
  const now = Date.now();
  const ctx: VerifyContext = {
    eventId: E,
    organizerPubKey: org.pub,
    roster: new Map([["p1", entry]]),
    pending: new Map<string, PendingChallenge>(),
    now,
    firstCheckIn: () => null,
  };
  const challenge = (n: string, ts = now): PendingChallenge => {
    const c = { n, ts, vid: "vd1", ev: E };
    ctx.pending.set(n, c);
    return c;
  };
  /** What the participant app shows after scanning `c`. */
  const respond = async (c: PendingChallenge, key = device.kp.privateKey, credential = cred) =>
    JSON.stringify({ t: "resp", cred: credential, sig: await sign(key, challengeMessage({ n: c.n, vid: c.vid, ev: c.ev, pid: "p1" })) });
  return { org, device, cred, entry, ctx, challenge, respond };
}

describe("scanner checks", () => {
  it("accepts a fresh response from the enrolled phone, and uses the challenge up", async () => {
    const s = await setup();
    const c = s.challenge("n1");
    const v = await verifyResponse(await s.respond(c), s.ctx);
    expect(v).toMatchObject({ result: "valid", entry: { name: "Asha Rao", seat: "A101-3" } });
    expect(s.ctx.pending.has("n1")).toBe(false);
  });

  it("finds the right challenge among several live ones", async () => {
    const s = await setup();
    s.challenge("n1");
    const c2 = s.challenge("n2");
    s.challenge("n3");
    expect((await verifyResponse(await s.respond(c2), s.ctx)).result).toBe("valid");
    expect([...s.ctx.pending.keys()]).toEqual(["n1", "n3"]);
  });

  it("1. BAD_QR for anything that isn't a response", async () => {
    const s = await setup();
    expect(await verifyResponse("hello", s.ctx)).toMatchObject({ reason: "BAD_QR" });
    expect(await verifyResponse('{"t":"chal","n":"x"}', s.ctx)).toMatchObject({ reason: "BAD_QR" });
  });

  it("2. FORGED_ID when the credential wasn't signed by the organizer", async () => {
    const s = await setup();
    const c = s.challenge("n1");
    const forged = { ...s.cred, payload: { ...s.cred.payload, participantId: "p1", teamId: "t9" } };
    expect(await verifyResponse(await s.respond(c, s.device.kp.privateKey, forged), s.ctx)).toMatchObject({ reason: "FORGED_ID" });
  });

  it("3. WRONG_EVENT and EXPIRED", async () => {
    const other = await setup({ eventId: "evt_other" });
    expect(await verifyResponse(await other.respond(other.challenge("n1")), other.ctx)).toMatchObject({ reason: "WRONG_EVENT" });
    const old = await setup({ expiresAt: "2020-01-01T00:00:00Z" });
    expect(await verifyResponse(await old.respond(old.challenge("n1")), old.ctx)).toMatchObject({ reason: "EXPIRED" });
  });

  it("4. NOT_IN_ROSTER and REVOKED", async () => {
    const s = await setup();
    const c = s.challenge("n1");
    const resp = await s.respond(c);
    s.entry.status = "revoked";
    expect(await verifyResponse(resp, s.ctx)).toMatchObject({ reason: "REVOKED" });
    s.ctx.roster.clear();
    expect(await verifyResponse(resp, s.ctx)).toMatchObject({ reason: "NOT_IN_ROSTER" });
  });

  it("5. KEY_MISMATCH when the roster has a different phone (re-issued ID)", async () => {
    const s = await setup();
    s.entry.devicePubKey = (await keypair()).pub;
    expect(await verifyResponse(await s.respond(s.challenge("n1")), s.ctx)).toMatchObject({ reason: "KEY_MISMATCH" });
  });

  it("6. STALE_CHALLENGE for a reused screenshot once its challenge is gone or expired", async () => {
    const s = await setup();
    const c = s.challenge("n1");
    const screenshot = await s.respond(c);
    expect((await verifyResponse(screenshot, s.ctx)).result).toBe("valid");
    expect(await verifyResponse(screenshot, s.ctx)).toMatchObject({ reason: "STALE_CHALLENGE" });

    const late = await setup();
    const old = late.challenge("n1", late.ctx.now - 61_000);
    expect(await verifyResponse(await late.respond(old), late.ctx)).toMatchObject({ reason: "STALE_CHALLENGE" });
  });

  it("7. DEVICE_MISMATCH for a screenshot against a new challenge, or a cloned credential", async () => {
    const s = await setup();
    const screenshot = await s.respond(s.challenge("n1"));
    await verifyResponse(screenshot, s.ctx); // used once, legitimately
    s.challenge("n2"); // the volunteer shows a new code
    expect(await verifyResponse(screenshot, s.ctx)).toMatchObject({ reason: "DEVICE_MISMATCH" });

    const clone = await keypair();
    expect(await verifyResponse(await s.respond(s.challenge("n3"), clone.kp.privateKey), s.ctx)).toMatchObject({ reason: "DEVICE_MISMATCH" });
  });

  it("8. duplicate with the first check-in time", async () => {
    const s = await setup();
    s.ctx.firstCheckIn = () => "2026-11-07T09:00:00.000Z";
    expect(await verifyResponse(await s.respond(s.challenge("n1")), s.ctx)).toMatchObject({ result: "duplicate", firstAt: "2026-11-07T09:00:00.000Z" });
  });
});
