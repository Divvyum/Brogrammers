import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COL, DOC, eventPath } from "@hackos/shared";
import { balanceAssignments } from "../../apps/server/src/admin/judging/assign.js";
import { computeLeaderboard, weightedTotal } from "../../apps/server/src/admin/judging/scoring.js";
import { generateMentorSlots } from "../../apps/server/src/admin/mentors/routes.js";
import { db } from "../../apps/server/src/core/firebase.js";
import { ensureDefaultTemplates } from "../../apps/server/src/core/templates.js";

// Seed data for D16–D26: schedule, problems, mentors' calendars, judging with
// scores (one deliberately harsh judge), food, tasks, tickets, rewards,
// complaints and ratings.

export interface ExtrasInput {
  eventId: string;
  startAt: number; // event start, ms
  tracks: readonly string[];
  teamIds: string[];
  teamTracks: string[];
  mentors: string[];
  judges: string[];
  volunteers: string[];
  participants: string[];
  rnd: () => number;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ts = (ms: number) => Timestamp.fromMillis(ms);

export async function seedExtras(x: ExtrasInput) {
  const { eventId, startAt, rnd } = x;
  const col = (sub: Parameters<typeof eventPath>[1]) => db.collection(eventPath(eventId, sub));
  const w = db.bulkWriter();

  // ---------- schedule (D16) ----------
  const schedule = [
    { title: "Opening ceremony", at: 0, mins: 60, location: "Main hall", audience: { type: "all", ids: [] } },
    { title: "AI track briefing", at: 1.25, mins: 30, location: "A101", audience: { type: "track", ids: ["AI"] } },
    { title: "FinTech mentor hour", at: 3, mins: 60, location: "B101", audience: { type: "track", ids: ["FinTech"] } },
    { title: "Lunch", at: 4, mins: 60, location: "Cafeteria", audience: { type: "all", ids: [] } },
  ];
  for (const s of schedule) {
    w.set(col("schedule").doc(), {
      title: s.title,
      startAt: ts(startAt + s.at * HOUR),
      endAt: ts(startAt + s.at * HOUR + s.mins * 60_000),
      location: s.location,
      audience: s.audience,
    });
  }

  // ---------- problem statements (D17): released one hour after the start ----------
  for (const track of x.tracks) {
    w.set(col("problems").doc(`problem_${track.toLowerCase()}`), {
      track,
      title: `${track}: build something people at this college would use every day`,
      body: `Full ${track} problem statement goes here. Judged on innovation, execution, impact and presentation.`,
      releaseAt: ts(startAt + HOUR),
      released: false,
    });
  }

  // ---------- food (D21) ----------
  const meal = (id: string, name: string, h: number) => ({ id, name, startAt: ts(startAt + h * HOUR), endAt: ts(startAt + (h + 1.5) * HOUR) });
  w.update(db.doc(eventPath(eventId)), {
    meals: [meal("breakfast-1", "Breakfast (day 1)", -1), meal("lunch-1", "Lunch (day 1)", 4), meal("dinner-1", "Dinner (day 1)", 11)],
    counters: ["Counter A", "Counter B"],
  });

  // ---------- volunteer tasks and tickets (D21) ----------
  const tasks = ["Set up registration desk", "Check projector in A101", "Restock water at Counter B", "Guide arrivals at gate 2", "Collect feedback forms"];
  tasks.forEach((title, i) => {
    w.set(col("tasks").doc(), {
      title,
      assignedTo: x.volunteers[i % x.volunteers.length],
      shift: i < 3 ? "Morning" : "Evening",
      dueAt: ts(startAt + (i + 1) * HOUR),
      status: "todo",
    });
  });
  const tickets = ["Wi-Fi not working in B102", "Need an HDMI adapter", "Power socket at seat C101-12 is dead"];
  tickets.forEach((text, i) => {
    w.set(col("tickets").doc(), { createdBy: x.participants[i * 7]!, text, status: "open", createdAt: FieldValue.serverTimestamp() });
  });

  // ---------- mentors (D20): one track each, a 3-hour calendar of 15-minute slots ----------
  const mentorTracks = x.mentors.map((_, i) => x.tracks[i % x.tracks.length]!);
  x.mentors.forEach((uid, i) => w.update(db.collection(COL.users).doc(uid), { mentorTracks: [mentorTracks[i]] }));

  // ---------- judging (D22, D24): two judges per team; the last judge scores 3 points harsher ----------
  const rubric = (await db.doc(DOC.rubric(eventId)).get()).get("criteria") as { id: string; name: string; weight: number; max: number }[];
  const assignments = balanceAssignments(x.teamIds, x.judges, 2);
  const harshJudge = [...x.judges].sort().at(-1)!;
  const quality = new Map(x.teamIds.map((t) => [t, 4 + rnd() * 5]));
  for (const [judgeUid, teamIds] of assignments) {
    w.set(col("judgeAssignments").doc(judgeUid), { teamIds });
    for (const teamId of teamIds) {
      const bias = judgeUid === harshJudge ? -3 : 0;
      const criteria = Object.fromEntries(
        rubric.map((c) => [c.id, Math.max(0, Math.min(c.max, Math.round(quality.get(teamId)! + (rnd() - 0.5) * 2 + bias)))]),
      );
      w.set(col("scores").doc(`${judgeUid}_${teamId}`), {
        judgeUid,
        teamId,
        round: "current",
        criteria,
        total: weightedTotal(rubric, criteria),
        locked: true,
        lockedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // ---------- RewardLink, complaints, ratings (D26) ----------
  const prizes = [
    { prize: "First prize", amount: 50000, type: "cash", sponsor: "Acme Bank" },
    { prize: "Second prize", amount: 30000, type: "cash", sponsor: "Acme Bank" },
    { prize: "Best AI hack", amount: 15000, type: "voucher", sponsor: "CloudCo" },
  ];
  prizes.forEach((p, i) =>
    w.set(col("rewards").doc(`reward_${i + 1}`), { ...p, dueAt: ts(startAt + 2 * DAY + 14 * DAY), status: "announced", history: [] }),
  );
  // Already late (for the overdue job).
  w.set(col("rewards").doc("reward_swag"), {
    prize: "Swag kits for all finalists",
    type: "swag",
    dueAt: ts(Date.now() - DAY),
    status: "processing",
    history: [],
  });
  w.set(col("complaints").doc("complaint_1"), {
    uid: x.participants[3],
    rewardId: "reward_swag",
    text: "We were promised swag kits at the last event and never got them.",
    evidenceUrls: [],
    status: "open",
    deadline: ts(Date.now() + 3 * DAY),
    history: [],
    createdAt: FieldValue.serverTimestamp(),
  });
  // Past its deadline (for the escalation job).
  w.set(col("complaints").doc("complaint_2"), {
    uid: x.participants[11],
    text: "Room B102 had no working sockets for three hours.",
    evidenceUrls: [],
    status: "open",
    deadline: ts(Date.now() - HOUR),
    history: [],
    createdAt: FieldValue.serverTimestamp(),
  });
  const score = () => 3 + Math.floor(rnd() * 3);
  for (const uid of x.participants.slice(0, 20)) {
    w.set(col("ratings").doc(uid), {
      scores: { organization: score(), mentors: score(), judging: score(), comms: score(), infra: score(), rewards: score() },
      text: rnd() > 0.5 ? "Great event, loved the mentors." : undefined,
    });
  }

  await w.close();

  for (const [i, uid] of x.mentors.entries()) {
    await generateMentorSlots(eventId, uid, [{ startAt: new Date(startAt + 2 * HOUR), endAt: new Date(startAt + 5 * HOUR) }], 15, mentorTracks[i]);
  }
  // Two bookings per mentor, from teams in that mentor's track, with notes on the first.
  for (const [i, uid] of x.mentors.entries()) {
    const teams = x.teamIds.filter((_, t) => x.teamTracks[t] === mentorTracks[i]).slice(i * 2, i * 2 + 2);
    for (const [k, teamId] of teams.entries()) {
      await col("mentorSlots").doc(`${uid}_${startAt + 2 * HOUR + k * 15 * 60_000}`).update({
        teamId,
        status: "booked",
        notes: k === 0 ? "Discussed data model; suggested caching the API calls." : undefined,
      });
    }
  }

  await ensureDefaultTemplates();
  await computeLeaderboard(eventId);
  return { harshJudge };
}
