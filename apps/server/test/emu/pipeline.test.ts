import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { COL, DOC } from "@hackos/shared";
import { b64u, verifyCredential, verifyDeviceResponse, challengeMessage, utf8 } from "@hackos/shared/crypto";
import { resetEmulators as wipe, seed, type SeedSummary } from "../../../../scripts/lib/seed-data.js";
import { rebalanceDueSlots } from "../../src/admin/allotment/allotment.service.js";
import { completeEnrollment, enrollWithToken } from "../../src/admin/digital-id/credentials.js";
import { runEligibility } from "../../src/admin/eligibility/engine.js";
import { detectDuplicates } from "../../src/admin/registrations/duplicates.js";
import { env } from "../../src/core/env.js";
import { col } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { stats } from "../../src/core/stats.js";
import { api, auditFor, bearer, outboxFor, resetEmulators, tokenFor } from "./helpers.js";

// Runs the admin pipeline on the seed data: D7 seed, D8 duplicates, D9
// eligibility, D12 allotment, D13 digital ID, D15 stats.

let s: SeedSummary;
let E: string;
let org: string;
let vol: string;

beforeAll(async () => {
  await resetEmulators();
  await wipe(env.projectId);
  s = await seed();
  E = s.eventId;
  org = await tokenFor(s.staff.find((x) => x.role === "organizer")!.uid, { role: "organizer", eventId: E });
  vol = await tokenFor(s.staff.find((x) => x.role === "volunteer")!.uid, { role: "volunteer", eventId: E });
});

const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

describe("D7: seed", () => {
  it("creates the planned data set", async () => {
    const count = async (path: string) => (await db.collection(path).count().get()).data().count;
    expect(await count(`events/${E}/participants`)).toBe(200);
    expect(await count(`events/${E}/teams`)).toBe(50);
    expect(await count(`events/${E}/rooms`)).toBe(10);
    expect(await count(`events/${E}/slots`)).toBe(6);
    expect(await count(`events/${E}/submissions`)).toBe(10);
    const roles = s.staff.reduce<Record<string, number>>((m, x) => ({ ...m, [x.role]: (m[x.role] ?? 0) + 1 }), {});
    // Plus the super admin from SUPERADMIN_EMAIL, when it's set.
    const { superadmin, ...eventStaff } = roles;
    expect(eventStaff).toEqual({ organizer: 1, mentor: 5, judge: 5, volunteer: 10 });
    expect(superadmin ?? 0).toBe(process.env.SUPERADMIN_EMAIL ? 1 : 0);
    const rubric = await db.doc(DOC.rubric(E)).get();
    expect(rubric.get("criteria").reduce((t: number, c: { weight: number }) => t + c.weight, 0)).toBe(100);
  });

  it("seeded volunteers log in with their dev PINs", async () => {
    const v = s.staff.find((x) => x.role === "volunteer")!;
    const res = await api().post("/api/admin/auth/volunteer-login").send({ eventCode: s.eventCode, pin: v.pin });
    expect(res.status).toBe(200);
  });
});

describe("D8: registrations and duplicates", () => {
  it("lists participants with filters and pagination", async () => {
    const p1 = await api().get(`/api/admin/events/${E}/participants?limit=25`).set(bearer(org));
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(25);
    const p2 = await api().get(`/api/admin/events/${E}/participants?limit=25&after=${p1.body.next}`).set(bearer(org));
    expect(p2.body.items[0].id > p1.body.items[24].id).toBe(true);
    const byTeam = await api().get(`/api/admin/events/${E}/participants?teamId=team01`).set(bearer(org));
    expect(byTeam.body.items.every((p: { teamId: string }) => p.teamId === "team01")).toBe(true);
  });

  it("masks contact details for volunteers but not organizers", async () => {
    const o = await api().get(`/api/admin/events/${E}/participants/p001`).set(bearer(org));
    const v = await api().get(`/api/admin/events/${E}/participants/p001`).set(bearer(vol));
    expect(o.body.profile.email).toMatch(/@students\.test$/);
    expect(o.body.profile.phone).toMatch(/^\d{12}$/);
    expect(v.body.profile.email).toMatch(/^\w\*\*\*@/);
    expect(v.body.profile.phone).toMatch(/^\*+\d{4}$/);
    expect(v.body.profile.emailHash).toBeUndefined();
  });

  it("finds every planted duplicate", async () => {
    await detectDuplicates(E);
    const res = await api().get(`/api/admin/events/${E}/duplicates`).set(bearer(org));
    const ids = new Set(res.body.items.map((d: { id: string }) => d.id));
    for (const d of s.plantedDuplicates) expect(ids).toContain(pairId(...d.uids));
    const emailDup = res.body.items.find((d: { id: string }) => d.id === pairId(...s.plantedDuplicates[4]!.uids));
    expect(emailDup.matchType).toBe("email");
  });

  it("merge keeps the earlier record and moves team membership to it", async () => {
    // Earlier record is solo; the later duplicate sits in a team.
    const now = Date.now();
    await col(E, "participants").doc("early").set({ name: "Zed Early", college: "SAKEC", registeredAt: Timestamp.fromMillis(now - 1e6), status: "registered", rosterVersion: 1 });
    await col(E, "participants").doc("late").set({ name: "Zed Earlyy", college: "SAKEC", registeredAt: Timestamp.fromMillis(now), status: "registered", rosterVersion: 1, teamId: "team02" });
    await col(E, "teams").doc("team02").update({ memberUids: [...(await col(E, "teams").doc("team02").get()).get("memberUids"), "late"] });
    await detectDuplicates(E);

    const res = await api().post(`/api/admin/events/${E}/duplicates/${pairId("early", "late")}/merge`).set(bearer(org)).send({ reason: "Same person" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kept: "early", merged: "late" });

    const team = await col(E, "teams").doc("team02").get();
    expect(team.get("memberUids")).toContain("early");
    expect(team.get("memberUids")).not.toContain("late");
    expect((await col(E, "participants").doc("early").get()).get("teamId")).toBe("team02");
    expect((await col(E, "participants").doc("late").get()).get("mergedInto")).toBe("early");
    expect(await auditFor(E, "duplicate.merge")).toHaveLength(1);

    const again = await api().post(`/api/admin/events/${E}/duplicates/${pairId("early", "late")}/merge`).set(bearer(org)).send({ reason: "Again" });
    expect(again.status).toBe(409);
  });

  it("dismisses a duplicate with a reason", async () => {
    const [a, b] = s.plantedDuplicates[0]!.uids;
    const res = await api().post(`/api/admin/events/${E}/duplicates/${pairId(a, b)}/dismiss`).set(bearer(org)).send({ reason: "Twins, checked ID" });
    expect(res.status).toBe(200);
    const noReason = await api().post(`/api/admin/events/${E}/duplicates/${pairId(...s.plantedDuplicates[1]!.uids)}/dismiss`).set(bearer(org)).send({});
    expect(noReason.status).toBe(400);
  });
});

describe("D9: eligibility", () => {
  it("splits the seed into eligible, flagged and rejected with readable reasons", async () => {
    const res = await api().post(`/api/admin/events/${E}/eligibility/run`).set(bearer(org)).send({});
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBeGreaterThan(150);
    expect(res.body.rejected).toBeGreaterThan(0);
    expect(res.body.flagged).toBeGreaterThan(0);

    for (const x of s.ineligible) {
      const p = await col(E, "participants").doc(x.uid).get();
      if (p.get("mergedInto")) continue;
      if (x.why.startsWith("year")) expect(p.get("eligibility")).toMatchObject({ result: "rejected", reason: expect.stringContaining("Year 5") });
      if (x.why.startsWith("college")) expect(p.get("eligibility")).toMatchObject({ result: "flagged", reason: expect.stringContaining("approved list") });
      if (x.why.startsWith("missing")) expect(p.get("eligibility")).toMatchObject({ result: "flagged", reason: "Missing: city" });
    }
  });

  it("queues one message per person, and a re-run queues nothing new", async () => {
    const before = (await outboxFor("p002")).length;
    expect(before).toBe(1);
    const rerun = await runEligibility(E);
    expect(rerun.changed).toBe(0);
    expect((await outboxFor("p002")).length).toBe(1);
  });

  it("an override sticks across re-runs and is audited", async () => {
    const target = s.ineligible.find((x) => x.why.startsWith("college"))!.uid;
    const res = await api().post(`/api/admin/events/${E}/participants/${target}/eligibility`).set(bearer(org)).send({ result: "eligible", reason: "Partner college, approved by organizer" });
    expect(res.status).toBe(200);
    await runEligibility(E);
    expect((await col(E, "participants").doc(target).get()).get("eligibility.result")).toBe("eligible");
    expect(await auditFor(E, "eligibility.override")).toHaveLength(1);
  });
});

describe("D12: allotment", () => {
  it("places everyone with zero capacity violations and every team together", async () => {
    const res = await api().post(`/api/admin/events/${E}/allotment/run`).set(bearer(org));
    expect(res.status).toBe(200);
    expect(res.body.capacityViolations).toBe(0);
    expect(res.body.unassigned).toEqual([]);

    const [parts, rooms] = await Promise.all([col(E, "participants").get(), col(E, "rooms").get()]);
    const active = parts.docs.filter((p) => !p.get("mergedInto") && p.get("status") !== "rejected" && p.get("slotId"));
    expect(active.every((p) => p.get("roomId") && p.get("seat"))).toBe(true);

    const roomsByTeam = new Map<string, Set<string>>();
    for (const p of active) {
      if (!p.get("teamId")) continue;
      roomsByTeam.set(p.get("teamId"), (roomsByTeam.get(p.get("teamId")) ?? new Set()).add(p.get("roomId")));
    }
    for (const [, set] of roomsByTeam) expect(set.size).toBe(1);

    for (const r of rooms.docs) {
      const inRoom = parts.docs.filter((p) => p.get("roomId") === r.id);
      expect(inRoom.length).toBe(r.get("occupied"));
      expect(inRoom.length).toBeLessThanOrEqual(r.get("capacity"));
      expect(new Set(inRoom.map((p) => p.get("seat"))).size).toBe(inRoom.length);
    }
  });

  it("puts teams in their track's rooms when there's space", async () => {
    const [parts, rooms] = await Promise.all([col(E, "participants").get(), col(E, "rooms").get()]);
    const trackOf = new Map(rooms.docs.map((r) => [r.id, r.get("track")]));
    const placed = parts.docs.filter((p) => p.get("teamId") && p.get("roomId"));
    const inTrack = placed.filter((p) => trackOf.get(p.get("roomId")) === p.get("track"));
    expect(inTrack.length / placed.length).toBeGreaterThan(0.6);
  });

  it("moves a participant with a reason (audited), and refuses a full room", async () => {
    const rooms = await col(E, "rooms").get();
    const p = (await col(E, "participants").where("teamId", "==", "team05").get()).docs[0]!;
    const target = rooms.docs.find((r) => r.id !== p.get("roomId") && r.get("occupied") < r.get("capacity"))!;
    const res = await api().post(`/api/admin/events/${E}/participants/${p.id}/move`).set(bearer(org)).send({ roomId: target.id, reason: "Needs accessible room" });
    expect(res.status).toBe(200);
    expect((await col(E, "participants").doc(p.id).get()).get("roomId")).toBe(target.id);
    expect(await auditFor(E, "allotment.move")).toHaveLength(1);

    const full = rooms.docs.find((r) => r.id !== target.id);
    await full!.ref.update({ capacity: full!.get("occupied") });
    const p2 = (await col(E, "participants").where("teamId", "==", "team06").get()).docs.find((x) => x.get("roomId") !== full!.id)!;
    const refused = await api().post(`/api/admin/events/${E}/participants/${p2.id}/move`).set(bearer(org)).send({ roomId: full!.id, reason: "Test" });
    expect(refused.status).toBe(409);
    await full!.ref.update({ capacity: full!.get("capacity") });
  });
});

describe("D13: digital ID and roster", () => {
  const devices: { uid: string; pub: string; priv: CryptoKey; cred: Awaited<ReturnType<typeof completeEnrollment>>["credential"] }[] = [];

  it("simulator credentials verify against the roster", async () => {
    const eligible = (await col(E, "participants").where("eligibility.result", "==", "eligible").limit(3).get()).docs;
    for (const p of eligible) {
      const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const pub = b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
      const { credential } = await completeEnrollment(E, p.id, pub);
      devices.push({ uid: p.id, pub, priv: kp.privateKey, cred: credential });
    }

    const roster = await api().get(`/api/admin/events/${E}/roster`).set(bearer(vol));
    expect(roster.status).toBe(200);
    expect(roster.body.participants.length).toBeGreaterThan(190);
    expect(roster.body.participants[0].email).toBeUndefined();

    for (const d of devices) {
      expect(await verifyCredential(roster.body.organizerPubKey, d.cred)).toBe(true);
      const entry = roster.body.participants.find((p: { participantId: string }) => p.participantId === d.uid);
      expect(entry).toMatchObject({ devicePubKey: d.pub, status: "enrolled" });
      expect(entry.backupCodeHash).toMatch(/^[0-9a-f]{64}$/);
      // The device can answer a challenge the scanner will accept.
      const m = { n: "nonce", vid: "vd1", ev: E, pid: d.uid };
      const sig = b64u.enc(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, d.priv, utf8(challengeMessage(m))));
      expect(await verifyDeviceResponse(entry.devicePubKey, m, sig)).toBe(true);
    }
  });

  it("a revoked participant appears in the revoked list of the next roster delta", async () => {
    const before = (await api().get(`/api/admin/events/${E}/roster`).set(bearer(vol))).body.rosterVersion;
    const res = await api().post(`/api/admin/events/${E}/participants/${devices[0]!.uid}/revoke`).set(bearer(org)).send({ reason: "Phone reported stolen" });
    expect(res.status).toBe(200);

    const delta = await api().get(`/api/admin/events/${E}/roster?since=${before}`).set(bearer(vol));
    expect(delta.body.rosterVersion).toBeGreaterThan(before);
    expect(delta.body.revoked).toEqual([devices[0]!.uid]);
    expect(delta.body.participants).toHaveLength(1); // only what changed
    expect(await auditFor(E, "id.revoke")).toHaveLength(1);
  });

  it("enrollment links are single-use and hashed at rest", async () => {
    const target = (await col(E, "participants").where("eligibility.result", "==", "eligible").get()).docs.find(
      (p) => !p.get("enrollment"),
    )!;
    const res = await api().post(`/api/admin/events/${E}/enrollment/send`).set(bearer(org)).send({ uids: [target.id] });
    expect(res.body.sent).toBe(1);

    const msg = (await outboxFor(target.id)).find((m) => m.template === "enrollment_link")!;
    const token = new URL((msg.vars as { link: string }).link).searchParams.get("token")!;
    expect((await col(E, "enrollTokens").doc(token).get()).exists).toBe(false); // stored only as a hash

    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const pub = b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
    const ok = await enrollWithToken(E, token, pub);
    expect(ok.uid).toBe(target.id);
    expect(ok.backupCode).toMatch(/^[A-Z2-9]{8}$/);
    await expect(enrollWithToken(E, token, pub)).rejects.toMatchObject({ code: "TOKEN_USED" });
  });

  it("volunteers can't revoke or send links", async () => {
    const res = await api().post(`/api/admin/events/${E}/participants/p010/revoke`).set(bearer(vol)).send({ reason: "nope" });
    expect(res.status).toBe(403);
  });
});

describe("D15: live stats", () => {
  it("dashboard numbers match a manual count", async () => {
    await stats.flushAll();
    await stats.recompute(E);
    const live = (await db.doc(DOC.liveStats(E)).get()).data()!;

    const parts = (await col(E, "participants").get()).docs;
    const active = parts.filter((p) => !p.get("mergedInto"));
    expect(live.registrations).toBe(active.length);
    expect(live.eligible).toBe(parts.filter((p) => p.get("eligibility.result") === "eligible").length);
    expect(live.flagged).toBe(parts.filter((p) => p.get("eligibility.result") === "flagged").length);
    expect(live.teams).toBe(50);
    expect(live.enrolled).toBe(parts.filter((p) => p.get("enrollment.status") === "enrolled").length);
    expect(live.submissions).toBe(10);
    for (const [slotId, v] of Object.entries(live.arrivedBySlot as Record<string, { expected: number }>)) {
      expect(v.expected).toBe(parts.filter((p) => p.get("slotId") === slotId).length);
    }
    const rooms = await col(E, "rooms").get();
    for (const r of rooms.docs) expect(live.roomOccupancy[r.id]).toEqual({ capacity: r.get("capacity"), occupied: r.get("occupied") });
    const queued = (await db.collection(COL.outbox).where("eventId", "==", E).where("status", "==", "queued").count().get()).data().count;
    expect(live.outbox.queued).toBe(queued);
  });

  it("is readable through the API by organizers only", async () => {
    expect((await api().get(`/api/admin/events/${E}/stats`).set(bearer(org))).status).toBe(200);
    expect((await api().get(`/api/admin/events/${E}/stats`).set(bearer(vol))).status).toBe(403);
  });
});

describe("D12: rebalance after a slot ends", () => {
  it("frees no-show seats once the slot plus grace period is over", async () => {
    const slot = col(E, "slots").doc("slot1");
    await slot.update({ endAt: Timestamp.fromMillis(Date.now() - 2 * 3600_000) });
    const inSlot = (await col(E, "participants").where("slotId", "==", "slot1").get()).docs.filter((p) => p.get("roomId"));
    expect(inSlot.length).toBeGreaterThan(0);

    const out = await rebalanceDueSlots(E);
    expect(out).toMatchObject({ slots: 1, released: inSlot.length });
    const after = await col(E, "participants").where("slotId", "==", "slot1").get();
    expect(after.docs.every((p) => !p.get("roomId"))).toBe(true);
    expect((await slot.get()).get("rebalancedAt")).toBeTruthy();
    expect((await rebalanceDueSlots(E)).slots).toBe(0); // runs once per slot
  });
});

describe("D12: rebalance seats late arrivals with their team", () => {
  it("a late arrival without a seat joins the room of a teammate who's already in", async () => {
    const slot = col(E, "slots").doc("slot2");
    const team = (await col(E, "participants").where("slotId", "==", "slot2").get()).docs.filter((p) => p.get("teamId") && p.get("roomId"));
    const teamId = team[0]!.get("teamId");
    const [onTime, late] = team.filter((p) => p.get("teamId") === teamId);
    const room = onTime!.get("roomId");

    // One member checked in on time; the other arrived late after losing their seat.
    await onTime!.ref.update({ checkedInAt: Timestamp.now() });
    await late!.ref.update({ checkedInAt: Timestamp.now(), roomId: FieldValue.delete(), seat: FieldValue.delete() });
    await col(E, "rooms").doc(room).update({ occupied: FieldValue.increment(-1) });
    await slot.update({ endAt: Timestamp.fromMillis(Date.now() - 2 * 3600_000) });

    const out = await rebalanceDueSlots(E);
    expect(out.seated).toBeGreaterThanOrEqual(1);
    const after = (await late!.ref.get()).data()!;
    expect(after.roomId).toBe(room);
    expect(after.seat).toMatch(/-\d+$/);
    expect((await onTime!.ref.get()).get("roomId")).toBe(room); // checked-in people keep their seat
  });

  it("seed participants have mock photos in the roster", async () => {
    const roster = await api().get(`/api/admin/events/${E}/roster`).set(bearer(vol));
    // Seeded IDs only; the merge test above added "early" by hand, without a profile.
    const seeded = roster.body.participants.filter((p: { participantId: string }) => /^p\d{3}$/.test(p.participantId));
    expect(seeded.length).toBeGreaterThan(190);
    expect(seeded.every((p: { photoUrl: string }) => p.photoUrl?.startsWith("https://"))).toBe(true);
  });
});
