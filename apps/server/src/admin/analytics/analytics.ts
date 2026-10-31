import { COL, PARTICIPANT_STATUSES } from "@hackos/shared";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";

// Analytics (plan D28). Counting uses count() aggregations wherever possible.

const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export async function analytics(eventId: string) {
  const participants = col(eventId, "participants");

  // Funnel: how many people reached each stage. A person at a later stage has
  // passed every earlier one, so each stage counts everyone at it or beyond.
  const flow = ["registered", "eligible", "team_locked", "travel_booked", "enrolled", "checked_in", "room_assigned", "submitted", "results", "reward_received"];
  const statusSnap = await participants.select("status", "eligibility", "mergedInto", "checkedInAt", "enrollment").get();
  const active = statusSnap.docs.filter((p) => !p.get("mergedInto"));
  const idx = (s: string) => flow.indexOf(s);
  // Each person's furthest stage: their status, or further if a flag shows it
  // (an enrolled ID, a check-in). Counting "at or beyond" keeps the funnel decreasing.
  const furthest = active.map((p) => {
    let f = Math.max(0, idx(p.get("status")));
    if (p.get("eligibility.result") === "eligible") f = Math.max(f, idx("eligible"));
    if (p.get("enrollment.status") === "enrolled") f = Math.max(f, idx("enrolled"));
    if (p.get("checkedInAt")) f = Math.max(f, idx("checked_in"));
    return f;
  });
  const funnel = flow.map((stage, i) => ({ stage, count: furthest.filter((f) => f >= i).length }));

  // Attendance per arrival slot.
  const slots = await col(eventId, "slots").orderBy("startAt").get();
  const attendanceBySlot = await Promise.all(
    slots.docs.map(async (s) => {
      const inSlot = participants.where("slotId", "==", s.id);
      const [expected, arrived] = await Promise.all([count(inSlot), count(inSlot.where("checkedInAt", "!=", null))]);
      return { slotId: s.id, startAt: s.get("startAt"), expected, arrived, rate: expected ? round(arrived / expected) : 0 };
    }),
  );
  const expected = attendanceBySlot.reduce((t, s) => t + s.expected, 0);
  const arrived = attendanceBySlot.reduce((t, s) => t + s.arrived, 0);

  // WhatsApp delivery rate: sent out of everything that finished (sent or failed).
  const outbox = db.collection(COL.outbox).where("eventId", "==", eventId);
  const [sent, failed] = await Promise.all([count(outbox.where("status", "==", "sent")), count(outbox.where("status", "==", "failed"))]);

  // Judge spread: for each team, the standard deviation of its judges' totals; then the average.
  const scores = await col(eventId, "scores").where("locked", "==", true).select("teamId", "total").get();
  const byTeam = new Map<string, number[]>();
  for (const s of scores.docs) byTeam.set(s.get("teamId"), [...(byTeam.get(s.get("teamId")) ?? []), s.get("total")]);
  const spreads = [...byTeam.values()]
    .filter((xs) => xs.length > 1)
    .map((xs) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length);
    });

  const ratings = await col(eventId, "ratings").get();
  const categories = ["organization", "mentors", "judging", "comms", "infra", "rewards"];
  const averages = Object.fromEntries(
    categories.map((c) => {
      const xs = ratings.docs.map((r) => r.get(`scores.${c}`)).filter((x): x is number => typeof x === "number");
      return [c, xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null];
    }),
  );

  return {
    funnel,
    statusCounts: Object.fromEntries(PARTICIPANT_STATUSES.map((s) => [s, active.filter((p) => p.get("status") === s).length])),
    attendanceBySlot,
    attendanceRate: expected ? round(arrived / expected) : 0,
    noShowRate: expected ? round((expected - arrived) / expected) : 0,
    whatsappDeliveryRate: sent + failed ? round(sent / (sent + failed)) : 0,
    whatsapp: { sent, failed },
    averageJudgeSpread: spreads.length ? round(spreads.reduce((a, b) => a + b, 0) / spreads.length, 2) : null,
    teamsWithMultipleJudges: spreads.length,
    ratings: { count: ratings.size, averages },
  };
}
