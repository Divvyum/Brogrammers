import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { lockTeamsIfDue } from "../../src/admin/teams/lock.js";
import { col, eventRef } from "../../src/core/events.js";
import { api, auditFor, bearer, eventBody, outboxFor, resetEmulators, tokenFor } from "./helpers.js";

// D10: teams, admin side.

let E: string;
let org: string;

const participant = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  registeredAt: Timestamp.now(),
  status: "eligible",
  eligibility: { result: "eligible", reason: "ok" },
  rosterVersion: 1,
  ...extra,
});

beforeAll(async () => {
  await resetEmulators();
  const su = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  E = (await api().post("/api/admin/events").set(bearer(su)).send(eventBody({ teamMax: 3 }))).body.id;
  org = await tokenFor("org1", { role: "organizer", eventId: E });

  await col(E, "teams").doc("t1").set({ name: "One", inviteCode: "AAA", leaderUid: "a", memberUids: ["a", "b"], track: "AI", status: "forming" });
  // A one-person team: below teamMin (2), which only matters once teams lock.
  await col(E, "teams").doc("t2").set({ name: "Solo", inviteCode: "BBB", leaderUid: "f", memberUids: ["f"], status: "forming" });
  for (const [uid, teamId] of [["a", "t1"], ["b", "t1"], ["c", null], ["d", null], ["e", null], ["f", "t2"]] as const) {
    await col(E, "participants").doc(uid).set(participant(uid.toUpperCase(), teamId ? { teamId } : {}));
  }
  await col(E, "teamChangeRequests").doc("r1").set({ type: "join", uid: "c", teamId: "t1", status: "pending" });
  await col(E, "teamChangeRequests").doc("r2").set({ type: "join", uid: "d", teamId: "t1", status: "pending" });
});

describe("D10: teams", () => {
  it("lists teams and shows team detail with members", async () => {
    const list = await api().get(`/api/admin/events/${E}/teams`).set(bearer(org));
    expect(list.body.items).toHaveLength(2);
    const detail = await api().get(`/api/admin/events/${E}/teams/t1`).set(bearer(org));
    expect(detail.body.members.map((m: { id: string }) => m.id)).toEqual(["a", "b"]);
  });

  it("approves a join request", async () => {
    const res = await api().post(`/api/admin/events/${E}/team-requests/r1/decision`).set(bearer(org)).send({ decision: "approved" });
    expect(res.status).toBe(200);
    expect((await col(E, "teams").doc("t1").get()).get("memberUids")).toEqual(["a", "b", "c"]);
    expect((await col(E, "participants").doc("c").get()).get("teamId")).toBe("t1");
  });

  it("refuses to approve a join into a full team", async () => {
    const res = await api().post(`/api/admin/events/${E}/team-requests/r2/decision`).set(bearer(org)).send({ decision: "approved" });
    expect(res.status).toBe(409);
    expect((await col(E, "teamChangeRequests").doc("r2").get()).get("status")).toBe("pending");
  });

  it("does nothing before the deadline", async () => {
    expect(await lockTeamsIfDue(E)).toBe(false);
    expect((await col(E, "teams").doc("t1").get()).get("status")).toBe("forming");
  });

  it("locks automatically at the deadline: teams locked, pending requests blocked, members told", async () => {
    await eventRef(E).update({ "deadlines.teamLock": Timestamp.fromMillis(Date.now() - 60_000) });
    expect(await lockTeamsIfDue(E)).toBe(true);

    expect((await col(E, "teams").doc("t1").get()).get("status")).toBe("locked");
    expect((await col(E, "teamChangeRequests").doc("r2").get()).data()).toMatchObject({
      status: "rejected",
      reason: "Team lock deadline passed",
    });
    for (const uid of ["a", "b", "c"]) {
      expect((await col(E, "participants").doc(uid).get()).get("status")).toBe("team_locked");
      expect((await outboxFor(uid)).map((m) => m.template)).toContain("team_locked");
    }
    expect(await auditFor(E, "teams.lock")).toHaveLength(1);
    expect(await lockTeamsIfDue(E)).toBe(false); // runs once
  });

  it("after the lock, flags teams below the minimum and people without a team", async () => {
    expect((await col(E, "participants").doc("f").get()).data()).toMatchObject({
      status: "flagged",
      eligibility: { result: "flagged", reason: "Team has 1 member (min 2)" },
    });
    expect((await col(E, "participants").doc("d").get()).data()).toMatchObject({
      status: "flagged",
      eligibility: { result: "flagged", reason: "Not in a team after the team lock" },
    });
    // Full teams are untouched.
    expect((await col(E, "participants").doc("a").get()).get("status")).toBe("team_locked");
  });

  it("blocks approving requests after the lock", async () => {
    await col(E, "teamChangeRequests").doc("r3").set({ type: "join", uid: "e", teamId: "t1", status: "pending" });
    const res = await api().post(`/api/admin/events/${E}/team-requests/r3/decision`).set(bearer(org)).send({ decision: "approved" });
    expect(res.status).toBe(409);
  });

  it("organizers can still force-remove and force-add with a reason", async () => {
    const rm = await api().delete(`/api/admin/events/${E}/teams/t1/members/c`).set(bearer(org)).send({ reason: "Left the event" });
    expect(rm.status).toBe(200);
    const add = await api().post(`/api/admin/events/${E}/teams/t1/members`).set(bearer(org)).send({ uid: "e", reason: "Replacement" });
    expect(add.status).toBe(200);
    expect((await col(E, "teams").doc("t1").get()).get("memberUids")).toEqual(["a", "b", "e"]);
    expect(await auditFor(E, "team.forceRemove")).toHaveLength(1);
    expect(await auditFor(E, "team.forceAdd")).toHaveLength(1);

    const noReason = await api().post(`/api/admin/events/${E}/teams/t1/members`).set(bearer(org)).send({ uid: "d" });
    expect(noReason.status).toBe(400);
  });
});
