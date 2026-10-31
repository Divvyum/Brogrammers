import { parse } from "csv-parse/sync";
import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { COL } from "@hackos/shared";
import { resetEmulators as wipe, seed, type SeedSummary } from "../../../../scripts/lib/seed-data.js";
import { escalateOverdueComplaints, markOverdueRewards } from "../../src/admin/rewards/rewards.js";
import { env } from "../../src/core/env.js";
import { col } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { api, auditFor, bearer, outboxFor, resetEmulators, tokenFor } from "./helpers.js";

// On the seed: D20 mentors, D22 judging setup, D24 scoring and results,
// D25 certificates, D26 rewards/complaints/ratings, D27 exports, D28 analytics.

let s: SeedSummary;
let E: string;
let org: string;
let orgUid: string;

const uidOf = (role: string, i = 0) => s.staff.filter((x) => x.role === role)[i]!.uid;

beforeAll(async () => {
  await resetEmulators();
  await wipe(env.projectId);
  s = await seed();
  E = s.eventId;
  orgUid = uidOf("organizer");
  org = await tokenFor(orgUid, { role: "organizer", eventId: E });
});

describe("D20: mentors", () => {
  it("every seeded mentor has a full slot calendar (3 hours of 15-minute slots)", async () => {
    const list = await api().get(`/api/admin/events/${E}/mentors`).set(bearer(org));
    expect(list.body.items).toHaveLength(5);
    for (const m of list.body.items) {
      expect(m.slots).toBe(12);
      expect(m.tracks).toHaveLength(1);
    }
  });

  it("a mentor sees only their own calendar, in time order, with bookings and notes", async () => {
    const mentor = uidOf("mentor");
    const token = await tokenFor(mentor, { role: "mentor", eventId: E });
    const res = await api().get(`/api/admin/events/${E}/mentor-slots?mentorUid=${uidOf("mentor", 1)}`).set(bearer(token));
    expect(res.body.items).toHaveLength(12);
    expect(res.body.items.every((x: { mentorUid: string }) => x.mentorUid === mentor)).toBe(true);
    const times = res.body.items.map((x: { startAt: string }) => x.startAt);
    expect([...times].sort()).toEqual(times);
    const booked = res.body.items.filter((x: { status: string }) => x.status === "booked");
    expect(booked.length).toBeGreaterThan(0);

    const progress = await api().get(`/api/admin/events/${E}/teams/${booked[0].teamId}/progress`).set(bearer(token));
    expect(progress.body.mentorNotes[0].notes).toMatch(/caching/);
  });

  it("re-sending the same availability creates no duplicate slots, and tracks are validated", async () => {
    const mentor = uidOf("mentor");
    const slots = (await api().get(`/api/admin/events/${E}/mentor-slots?mentorUid=${mentor}`).set(bearer(org))).body.items;
    const res = await api().post(`/api/admin/events/${E}/mentors/${mentor}/availability`).set(bearer(org))
      .send({ windows: [{ startAt: slots[0].startAt, endAt: slots[11].endAt }] });
    expect(res.body.created).toBe(0);
    const bad = await api().put(`/api/admin/events/${E}/mentors/${mentor}/tracks`).set(bearer(org)).send({ tracks: ["Space"] });
    expect(bad.status).toBe(400);
  });
});

describe("D24: scoring and leaderboard", () => {
  it("the seeded scores produce the correct ranking", async () => {
    const lb = (await api().post(`/api/admin/events/${E}/leaderboard/recompute`).set(bearer(org))).body;
    const scores = await col(E, "scores").where("locked", "==", true).get();
    const byTeam = new Map<string, number[]>();
    for (const d of scores.docs) byTeam.set(d.get("teamId"), [...(byTeam.get(d.get("teamId")) ?? []), d.get("total")]);
    const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
    const expected = [...byTeam.entries()].map(([teamId, xs]) => ({ teamId, total: avg(xs) })).sort((a, b) => b.total - a.total);

    expect(lb.teams).toHaveLength(50);
    expect(lb.teams.map((t: { total: number }) => t.total)).toEqual(expected.map((t) => t.total));
    expect(lb.teams[0].rank).toBe(1);
    expect(lb.teams.every((t: { judges: number }) => t.judges === 2)).toBe(true);
    for (let i = 1; i < lb.teams.length; i++) {
      const [a, b] = [lb.teams[i - 1], lb.teams[i]];
      expect(b.rank).toBe(a.total === b.total ? a.rank : i + 1);
    }
  });

  it("flags the harsh judge as an outlier", async () => {
    const res = await api().get(`/api/admin/events/${E}/judging/consistency`).set(bearer(org));
    expect(res.body.outlierJudges.map((j: { judgeUid: string }) => j.judgeUid)).toEqual([s.harshJudge]);
    expect(res.body.consistency).toHaveLength(5);
  });

  it("a judge scores only assigned teams; submitting locks; editing a locked score needs a reason", async () => {
    const judge = uidOf("judge");
    const token = await tokenFor(judge, { role: "judge", eventId: E });
    const assigned = ((await col(E, "judgeAssignments").doc(judge).get()).get("teamIds") as string[]);
    const notMine = (await col(E, "teams").get()).docs.map((t) => t.id).find((t) => !assigned.includes(t))!;
    const criteria = { innovation: 8, execution: 7, impact: 9, presentation: 6 };

    expect((await api().put(`/api/admin/events/${E}/scores/${notMine}`).set(bearer(token)).send({ criteria })).status).toBe(403);
    expect((await api().put(`/api/admin/events/${E}/scores/${assigned[0]}`).set(bearer(token)).send({ criteria: { innovation: 11 } })).status).toBe(400);

    // Seeded scores are already locked.
    const locked = await api().put(`/api/admin/events/${E}/scores/${assigned[0]}`).set(bearer(token)).send({ criteria });
    expect(locked.status).toBe(409);
    const edited = await api().put(`/api/admin/events/${E}/scores/${assigned[0]}`).set(bearer(token)).send({ criteria, reason: "Misread the rubric" });
    expect(edited.status).toBe(200);
    expect(edited.body).toEqual({ total: 76.5, locked: true });
    expect((await auditFor(E, "score.editLocked"))[0]).toMatchObject({ reason: "Misread the rubric", after: { total: 76.5 } });

    // A newly assigned team: draft first, then submit to lock.
    await api().put(`/api/admin/events/${E}/judges/${judge}/assignments`).set(bearer(org)).send({ teamIds: [...assigned, notMine] });
    const draft = await api().put(`/api/admin/events/${E}/scores/${notMine}`).set(bearer(token)).send({ criteria });
    expect(draft.body.locked).toBe(false);
    const submit = await api().put(`/api/admin/events/${E}/scores/${notMine}`).set(bearer(token)).send({ criteria, submit: true });
    expect(submit.body.locked).toBe(true);
    const lb = await api().get(`/api/admin/events/${E}/leaderboard`).set(bearer(org));
    expect(lb.body.teams.find((t: { teamId: string }) => t.teamId === notMine).judges).toBe(3);
  });

  it("the rubric can't change once scores are locked, and weights must total 100", async () => {
    const criteria = [{ id: "a", name: "A", weight: 50, max: 10 }, { id: "b", name: "B", weight: 40, max: 10 }];
    expect((await api().put(`/api/admin/events/${E}/rubric/round2`).set(bearer(org)).send({ criteria })).status).toBe(400);
    criteria[1]!.weight = 50;
    expect((await api().put(`/api/admin/events/${E}/rubric/round2`).set(bearer(org)).send({ criteria })).status).toBe(200);
    expect((await api().put(`/api/admin/events/${E}/rubric/current`).set(bearer(org)).send({ criteria })).status).toBe(409);
  });

  it("publishing results makes the leaderboard visible and tells everyone", async () => {
    await col(E, "participants").doc("p001").update({ checkedInAt: Timestamp.now(), status: "room_assigned" });
    const res = await api().post(`/api/admin/events/${E}/results/publish`).set(bearer(org));
    expect(res.body.notified).toBeGreaterThan(190);
    expect((await db.doc(`events/${E}`).get()).get("leaderboardVisible")).toBe(true);
    expect((await col(E, "participants").doc("p001").get()).get("status")).toBe("results");
    expect((await outboxFor("p002")).map((m) => m.template)).toContain("results_published");
  });
});

describe("D25: certificates", () => {
  it("issues winner certificates; the PDF downloads and the verify link confirms it", async () => {
    const res = await api().post(`/api/admin/events/${E}/certificates/issue`).set(bearer(org)).send({ type: "winner", topTeams: 3 });
    expect(res.status).toBe(200);
    expect(res.body.issued).toBeGreaterThanOrEqual(9); // 3 teams of 3–4 people
    const certId = res.body.certificates[0].certId as string;

    const verify = await api().get(`/api/public/certificates/${certId}`);
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ valid: true, type: "winner", eventName: "HACKOS Demo Hackathon 2026" });
    expect(verify.body.rank).toBeGreaterThanOrEqual(1);

    const pdf = await api().get(`/api/public/certificates/${certId}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
  });

  it("doesn't issue twice, and unknown IDs don't verify", async () => {
    const again = await api().post(`/api/admin/events/${E}/certificates/issue`).set(bearer(org)).send({ type: "winner" });
    expect(again.body.issued).toBe(0);
    expect((await api().get("/api/public/certificates/AAAAAAAAAAAA")).body.valid).toBe(false);
    expect((await api().get("/api/public/certificates/not-an-id")).status).toBe(404);
  });

  it("participation goes to checked-in people only; mentors get theirs", async () => {
    const part = await api().post(`/api/admin/events/${E}/certificates/issue`).set(bearer(org)).send({ type: "participation" });
    expect(part.body.issued).toBe(1); // only p001 checked in
    const mentors = await api().post(`/api/admin/events/${E}/certificates/issue`).set(bearer(org)).send({ type: "mentor" });
    expect(mentors.body.issued).toBe(5);
  });
});

describe("D26: RewardLink, complaints, ratings", () => {
  it("an overdue reward is flagged automatically and the organizer is told once", async () => {
    expect(await markOverdueRewards(E)).toBe(1);
    expect((await col(E, "rewards").doc("reward_swag").get()).get("overdue")).toBe(true);
    expect((await outboxFor(orgUid)).filter((m) => m.template === "reward_overdue")).toHaveLength(1);
    expect(await markOverdueRewards(E)).toBe(0);
  });

  it("a complaint escalates after its deadline; one still in time doesn't", async () => {
    expect(await escalateOverdueComplaints(E)).toBe(1);
    expect((await col(E, "complaints").doc("complaint_2").get()).get("status")).toBe("escalated");
    expect((await col(E, "complaints").doc("complaint_1").get()).get("status")).toBe("open");
    expect((await outboxFor(orgUid)).some((m) => m.template === "complaint_escalated")).toBe(true);
  });

  it("enforces the reward status pipeline and proof of delivery", async () => {
    const r = `/api/admin/events/${E}/rewards/reward_1`;
    expect((await api().post(`${r}/status`).set(bearer(org)).send({ status: "delivered" })).status).toBe(409);
    expect((await api().post(`${r}/status`).set(bearer(org)).send({ status: "verified" })).status).toBe(200);
    expect((await api().post(`${r}/status`).set(bearer(org)).send({ status: "processing" })).status).toBe(200);
    expect((await api().post(`${r}/status`).set(bearer(org)).send({ status: "delivered" })).body.message).toMatch(/proof/);

    expect((await api().post(`${r}/proof`).set(bearer(org)).send({ proofUrl: "https://evil.example/x.png" })).status).toBe(400);
    const sign = await api().post(`/api/admin/events/${E}/uploads/sign`).set(bearer(org)).send({ folder: "reward-proofs" });
    expect(sign.body).toMatchObject({ folder: `hackos/${E}/reward-proofs`, signature: expect.stringMatching(/^[0-9a-f]{40}$/) });
    const proofUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1/proof.png`;
    expect((await api().post(`${r}/proof`).set(bearer(org)).send({ proofUrl })).status).toBe(200);
    expect((await api().post(`${r}/status`).set(bearer(org)).send({ status: "delivered", note: "Bank transfer done" })).status).toBe(200);
    const reward = (await col(E, "rewards").doc("reward_1").get()).data()!;
    expect(reward.history.map((h: { status: string }) => h.status)).toEqual(["verified", "processing", "delivered"]);
  });

  it("organizers answer complaints and ratings", async () => {
    const c = await api().post(`/api/admin/events/${E}/complaints/complaint_1/respond`).set(bearer(org)).send({ note: "Kits ship Monday." });
    expect(c.body.status).toBe("responded");
    expect((await outboxFor(s.staff.length ? (await col(E, "complaints").doc("complaint_1").get()).get("uid") : "")).some((m) => m.template === "complaint_response")).toBe(true);

    const ratings = await api().get(`/api/admin/events/${E}/ratings`).set(bearer(org));
    expect(ratings.body.count).toBe(20);
    expect(ratings.body.averages.mentors).toBeGreaterThanOrEqual(3);
    const uid = ratings.body.items[0].uid;
    expect((await api().post(`/api/admin/events/${E}/ratings/${uid}/response`).set(bearer(org)).send({ response: "Thank you!" })).status).toBe(200);
  });
});

describe("D27: exports", () => {
  const kinds = ["attendance", "teams", "eligibility", "checkins", "scores", "leaderboard", "rewards", "audit"];

  it.each(kinds)("%s.csv is Excel-friendly CSV that parses back", async (kind) => {
    const res = await api().get(`/api/admin/events/${E}/exports/${kind}.csv`).set(bearer(org));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`${kind}-.*\\.csv`));
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads UTF-8
    expect(res.text).toContain("\r\n");
    const rows = parse(res.text, { bom: true, columns: true }) as Record<string, string>[];
    if (kind === "checkins") expect(rows.length).toBe(0);
    else expect(rows.length).toBeGreaterThan(0);
    if (kind === "attendance") expect(rows).toHaveLength(200);
    if (kind === "leaderboard") expect(rows[0]).toMatchObject({ rank: "1" });
  });

  it("the PDF summary downloads, and volunteers can't export", async () => {
    const pdf = await api().get(`/api/admin/events/${E}/exports/summary.pdf`).set(bearer(org));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const vol = await tokenFor(uidOf("volunteer"), { role: "volunteer", eventId: E });
    expect((await api().get(`/api/admin/events/${E}/exports/attendance.csv`).set(bearer(vol))).status).toBe(403);
    expect((await api().get(`/api/admin/events/${E}/exports/secrets.csv`).set(bearer(org))).status).toBe(400);
  });
});

describe("D28: analytics", () => {
  it("returns every metric for the seed data", async () => {
    const res = await api().get(`/api/admin/events/${E}/analytics`).set(bearer(org));
    expect(res.status).toBe(200);
    const a = res.body;
    expect(a.funnel[0]).toEqual({ stage: "registered", count: 200 });
    expect(a.funnel.map((f: { count: number }) => f.count)).toEqual([...a.funnel.map((f: { count: number }) => f.count)].sort((x: number, y: number) => y - x));
    expect(a.attendanceBySlot).toHaveLength(6);
    expect(a.noShowRate).toBeGreaterThan(0.9); // only one person checked in
    expect(a.whatsappDeliveryRate).toBe(0); // nothing sent until the worker exists
    expect(a.averageJudgeSpread).toBeGreaterThan(0);
    expect(a.ratings.count).toBe(20);
    expect(Object.keys(a.ratings.averages)).toEqual(["organization", "mentors", "judging", "comms", "infra", "rewards"]);
  });
});

describe("D22: automatic judge assignment", () => {
  it("produces balanced lists", async () => {
    const res = await api().post(`/api/admin/events/${E}/judges/auto-assign`).set(bearer(org)).send({ judgesPerTeam: 2 });
    expect(res.status).toBe(200);
    const loads = Object.values(res.body.loads) as number[];
    expect(loads.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    const judges = await api().get(`/api/admin/events/${E}/judges`).set(bearer(org));
    expect(judges.body.items.every((j: { teamIds: string[] }) => j.teamIds.length === 20)).toBe(true);
    expect(await db.collection(COL.users).where("role", "==", "judge").count().get().then((c) => c.data().count)).toBe(5);
  });
});
