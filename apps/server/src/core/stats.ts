import { FieldValue, type Query } from "firebase-admin/firestore";
import { COL, DOC, eventPath } from "@hackos/shared";
import { db } from "./firebase.js";

// Live dashboard stats (plan D15). The dashboard reads only events/{id}/stats/live.
// Frequent events (check-ins, queued messages) add to an in-memory accumulator
// that flushes every 10 seconds as FieldValue.increment updates. Bulk changes
// (imports, eligibility runs, allotment) schedule a full recompute instead,
// which uses count() aggregations (1 read per 1,000 index entries).

const FLUSH_MS = 10_000;
const RECOMPUTE_DEBOUNCE_MS = 2_000;

const pending = new Map<string, Map<string, number>>();
const recomputeTimers = new Map<string, NodeJS.Timeout>();
let flushTimer: NodeJS.Timeout | undefined;

async function count(q: Query) {
  return (await q.count().get()).data().count;
}

/** Recomputes every counter from scratch. Also run nightly to correct drift. */
async function recompute(eventId: string): Promise<void> {
  const participants = db.collection(eventPath(eventId, "participants"));
  const [total, merged, eligible, flagged, teams, enrolled, checkedIn, submissions, slots, rooms] =
    await Promise.all([
      count(participants),
      count(participants.where("mergedInto", "!=", null)),
      count(participants.where("eligibility.result", "==", "eligible")),
      count(participants.where("eligibility.result", "==", "flagged")),
      count(db.collection(eventPath(eventId, "teams"))),
      count(participants.where("enrollment.status", "==", "enrolled")),
      count(participants.where("checkedInAt", "!=", null)),
      count(db.collection(eventPath(eventId, "submissions"))),
      db.collection(eventPath(eventId, "slots")).get(),
      db.collection(eventPath(eventId, "rooms")).get(),
    ]);

  const arrivedBySlot: Record<string, { expected: number; arrived: number }> = {};
  await Promise.all(
    slots.docs.map(async (s) => {
      const inSlot = participants.where("slotId", "==", s.id);
      const [expected, arrived] = await Promise.all([
        count(inSlot),
        count(inSlot.where("checkedInAt", "!=", null)),
      ]);
      arrivedBySlot[s.id] = { expected, arrived };
    }),
  );

  const roomOccupancy: Record<string, { capacity: number; occupied: number }> = {};
  for (const r of rooms.docs) {
    roomOccupancy[r.id] = { capacity: r.get("capacity") ?? 0, occupied: r.get("occupied") ?? 0 };
  }

  const outbox = db.collection(COL.outbox).where("eventId", "==", eventId);
  const tickets = db.collection(eventPath(eventId, "tickets"));
  const [queued, sent, failed, openTickets] = await Promise.all([
    count(outbox.where("status", "==", "queued")),
    count(outbox.where("status", "==", "sent")),
    count(outbox.where("status", "==", "failed")),
    count(tickets.where("status", "in", ["open", "assigned"])),
  ]);

  // Drop increments that happened before this snapshot; it already includes them.
  pending.delete(eventId);
  await db.doc(DOC.liveStats(eventId)).set({
    registrations: total - merged,
    eligible,
    flagged,
    teams,
    enrolled,
    checkedIn,
    arrivedBySlot,
    roomOccupancy,
    submissions,
    outbox: { queued, sent, failed },
    openTickets,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function flushEvent(eventId: string): Promise<void> {
  const fields = pending.get(eventId);
  if (!fields || fields.size === 0) return;
  pending.delete(eventId);
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [field, n] of fields) update[field] = FieldValue.increment(n);
  try {
    await db.doc(DOC.liveStats(eventId)).update(update);
  } catch (err) {
    if ((err as { code?: number }).code === 5) return recompute(eventId); // NOT_FOUND
    throw err;
  }
}

export const stats = {
  /** Adds n to a counter. `field` is a dotted path, e.g. "checkedIn" or "arrivedBySlot.s1.arrived". */
  inc(eventId: string, field: string, n = 1) {
    let fields = pending.get(eventId);
    if (!fields) pending.set(eventId, (fields = new Map()));
    fields.set(field, (fields.get(field) ?? 0) + n);
  },

  /** Schedules a full recompute (debounced). Use after bulk changes. */
  recomputeSoon(eventId: string) {
    clearTimeout(recomputeTimers.get(eventId));
    recomputeTimers.set(
      eventId,
      setTimeout(() => {
        recomputeTimers.delete(eventId);
        recompute(eventId).catch((e) => console.error("[stats] recompute failed", e));
      }, RECOMPUTE_DEBOUNCE_MS).unref(),
    );
  },

  recompute,

  async flushAll(): Promise<void> {
    await Promise.all([...pending.keys()].map(flushEvent));
  },

  start() {
    flushTimer ??= setInterval(() => {
      stats.flushAll().catch((e) => console.error("[stats] flush failed", e));
    }, FLUSH_MS);
  },

  stop() {
    clearInterval(flushTimer);
    flushTimer = undefined;
  },

  /** Empty stats document for a new event. */
  initial() {
    return {
      registrations: 0,
      eligible: 0,
      flagged: 0,
      teams: 0,
      enrolled: 0,
      checkedIn: 0,
      arrivedBySlot: {},
      roomOccupancy: {},
      submissions: 0,
      outbox: { queued: 0, sent: 0, failed: 0 },
      openTickets: 0,
      updatedAt: FieldValue.serverTimestamp(),
    };
  },
};
