import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { COL } from "@hackos/shared";
import { accept, decline, expireInvites, INVITE_TTL_MS } from "../../src/admin/replacement/replacement.service.js";
import { expireWaitlistOffers, respondToOffer } from "../../src/admin/replacement/waitlist.js";
import { col } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { api, auditFor, bearer, eventBody, outboxFor, resetEmulators, tokenFor } from "./helpers.js";

// D11: the full replacement chain — invite, expire, next candidate, decline,
// waitlist fallback, accept, admin approve.

let E: string;
let org: string;
let repId: string;

async function person(uid: string, skills: string[], p: Record<string, unknown>) {
  await db.collection(COL.users).doc(uid).set({ name: uid, role: "participant", skills });
  await col(E, "participants").doc(uid).set({
    name: uid,
    registeredAt: Timestamp.fromMillis(Date.now() - Number(uid.replace(/\D/g, "") || 0) * 1000),
    status: "eligible",
    eligibility: { result: "eligible", reason: "ok" },
    rosterVersion: 1,
    ...p,
  });
}

const rep = async () => (await col(E, "replacements").doc(repId).get()).data()!;

beforeAll(async () => {
  await resetEmulators();
  const su = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  E = (await api().post("/api/admin/events").set(bearer(su)).send(eventBody())).body.id;
  org = await tokenFor("org1", { role: "organizer", eventId: E });

  // Team: two frontend people and a backend person who will withdraw.
  await col(E, "teams").doc("t1").set({ name: "T", inviteCode: "X", leaderUid: "m1", memberUids: ["m1", "m2", "m3"], track: "AI", status: "locked" });
  await person("m1", ["react", "ui"], { teamId: "t1", track: "AI" });
  await person("m2", ["react", "design"], { teamId: "t1", track: "AI" });
  await person("m3", ["node", "python"], { teamId: "t1", track: "AI" });

  const open = (skills: string[]) => ({ on: true, skills, availability: "Full event" });
  await person("s1", ["node", "python", "ml"], { track: "AI", openToReplacement: open(["node", "python", "ml"]) }); // best fit
  await person("s2", ["react"], { track: "Open", openToReplacement: open(["react"]) }); // overlaps the team
  await person("s3", ["go"], { track: "AI", openToReplacement: open(["go"]), eligibility: { result: "flagged", reason: "x" } }); // not eligible
  await person("s4", ["go"], { track: "AI", teamId: "other", openToReplacement: open(["go"]) }); // already in a team
  await person("w1", ["devops"], {});
  await col(E, "waitlist").doc("w1").set({ position: 1, eligible: true, status: "waiting", registeredAt: Timestamp.now() });
});

describe("D11: replacement chain", () => {
  it("withdrawal invites the best-fitting eligible solo participant", async () => {
    const res = await api().post(`/api/admin/events/${E}/teams/t1/withdraw`).set(bearer(org)).send({ uid: "m3", reason: "Fell ill" });
    expect(res.status).toBe(201);
    repId = res.body.id;
    expect(res.body.candidates).toEqual(["s1", "s2"]);
    expect(await rep()).toMatchObject({ status: "invited", currentCandidate: "s1" });
    expect((await col(E, "teams").doc("t1").get()).get("memberUids")).toEqual(["m1", "m2"]);
    expect((await outboxFor("s1")).map((m) => m.template)).toEqual(["replacement_invite"]);
  });

  it("an expired invitation moves to the next candidate", async () => {
    const moved = await expireInvites(E, Timestamp.fromMillis(Date.now() + INVITE_TTL_MS + 60_000));
    expect(moved).toBe(1);
    expect(await rep()).toMatchObject({ status: "invited", currentCandidate: "s2", passed: ["s1"] });
  });

  it("only the current candidate can respond", async () => {
    await expect(accept(E, repId, "s1")).rejects.toMatchObject({ status: 403 });
  });

  it("a decline with no candidates left falls back to the waitlist", async () => {
    await decline(E, repId, "s2");
    expect(await rep()).toMatchObject({ status: "waitlist", currentCandidate: "w1", passed: ["s1", "s2"] });
    expect((await col(E, "waitlist").doc("w1").get()).get("status")).toBe("offered");
    expect((await outboxFor("w1")).map((m) => m.template)).toEqual(["waitlist_offer"]);
  });

  it("accept, then admin approve, puts the person in the team (even though it's locked)", async () => {
    await accept(E, repId, "w1");
    expect(await rep()).toMatchObject({ status: "accepted", acceptedUid: "w1" });
    expect((await outboxFor("m1")).map((m) => m.template)).toContain("replacement_accepted");

    const res = await api().post(`/api/admin/events/${E}/replacements/${repId}/approve`).set(bearer(org)).send({});
    expect(res.status).toBe(200);
    expect((await col(E, "teams").doc("t1").get()).get("memberUids")).toEqual(["m1", "m2", "w1"]);
    expect((await col(E, "participants").doc("w1").get()).get("teamId")).toBe("t1");
    expect(await rep()).toMatchObject({ status: "approved" });
    expect((await col(E, "waitlist").doc("w1").get()).get("status")).toBe("accepted");
  });

  it("every step is audited", async () => {
    for (const action of ["team.withdraw", "replacement.invited", "replacement.expired", "replacement.declined", "replacement.waitlist", "replacement.accept", "replacement.approve"]) {
      expect(await auditFor(E, action), action).not.toHaveLength(0);
    }
  });

  it("with no candidates and no waitlist, the replacement fails cleanly", async () => {
    await col(E, "teams").doc("t2").set({ name: "T2", inviteCode: "Y", leaderUid: "m1", memberUids: ["x1", "x2"], status: "forming" });
    await person("x1", [], { teamId: "t2" });
    await person("x2", [], { teamId: "t2" });
    // Nobody solo and eligible is left, and the only waitlist entry was used.
    await col(E, "participants").doc("s1").update({ teamId: "t9" });
    await col(E, "participants").doc("s2").update({ teamId: "t9" });
    const res = await api().post(`/api/admin/events/${E}/teams/t2/withdraw`).set(bearer(org)).send({ uid: "x2", reason: "Quit" });
    expect(res.status).toBe(201);
    expect((await col(E, "replacements").doc(res.body.id).get()).get("status")).toBe("failed");
  });
});

describe("D11: waitlist", () => {
  it("adds solo participants, skipping anyone in a team, and orders eligible people first", async () => {
    await person("q1", [], { eligibility: { result: "flagged", reason: "x" } });
    await person("q2", [], {});
    const res = await api().post(`/api/admin/events/${E}/waitlist`).set(bearer(org)).send({ uids: ["q1", "q2", "m1", "w1"] });
    expect(res.status).toBe(200);
    expect(res.body.added).toEqual(["q1", "q2"]);
    expect(res.body.skipped.map((x: { uid: string }) => x.uid)).toEqual(["m1", "w1"]);

    const list = await api().get(`/api/admin/events/${E}/waitlist`).set(bearer(org));
    const waiting = list.body.items.filter((w: { status: string }) => w.status === "waiting");
    expect(waiting.map((w: { id: string }) => w.id)).toEqual(["q2", "q1"]); // eligible first
  });

  it("the replacement chain's offer is tagged so only that chain expires it", async () => {
    expect((await col(E, "waitlist").doc("w1").get()).get("replacementId")).toBe(repId);
  });

  it("a hand-made offer can be accepted", async () => {
    const res = await api().post(`/api/admin/events/${E}/waitlist/q2/offer`).set(bearer(org));
    expect(res.status).toBe(200);
    const w = (await col(E, "waitlist").doc("q2").get()).data()!;
    expect(w.status).toBe("offered");
    expect(w.offerExpiresAt.toMillis()).toBeGreaterThan(Date.now());
    await respondToOffer(E, "q2", true);
    expect((await col(E, "waitlist").doc("q2").get()).get("status")).toBe("accepted");
    await expect(respondToOffer(E, "q2", true)).rejects.toMatchObject({ status: 409 });
  });

  it("an unanswered offer expires", async () => {
    await api().post(`/api/admin/events/${E}/waitlist/q1/offer`).set(bearer(org));
    expect(await expireWaitlistOffers(E)).toBe(0); // not yet
    expect(await expireWaitlistOffers(E, Timestamp.fromMillis(Date.now() + INVITE_TTL_MS + 60_000))).toBe(1);
    expect((await col(E, "waitlist").doc("q1").get()).get("status")).toBe("expired");
    await expect(respondToOffer(E, "q1", true)).rejects.toMatchObject({ status: 409 });
    expect(await auditFor(E, "waitlist.expire")).toHaveLength(1);
  });
});
