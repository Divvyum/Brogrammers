import { FieldValue } from "firebase-admin/firestore";
import { COL, type Channel, type Priority } from "@hackos/shared";
import { db } from "./firebase.js";
import { stats } from "./stats.js";

export interface EnqueueInput {
  channel: Channel;
  uid: string;
  template: string;
  vars?: Record<string, string>;
  priority?: Priority;
  /** What caused the message plus a reference, e.g. "eligibility_evt1". Makes the ID deterministic. */
  dedupeKey: string;
  /** Event to count the message under on the dashboard. */
  eventId?: string;
}

/** Deterministic: `${dedupeKey}_${uid}`, so a retry never queues the same message twice (plan 4.4). */
export function outboxId(dedupeKey: string, uid: string): string {
  return `${dedupeKey}_${uid}`.replace(/\//g, "-");
}

function outboxDoc(m: EnqueueInput) {
  return {
    eventId: m.eventId,
    channel: m.channel,
    to: { uid: m.uid },
    template: m.template,
    vars: m.vars ?? {},
    priority: m.priority ?? 1,
    status: "queued",
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** Queues one message. Returns false if it was already queued. */
export async function enqueue(m: EnqueueInput): Promise<boolean> {
  try {
    await db.collection(COL.outbox).doc(outboxId(m.dedupeKey, m.uid)).create(outboxDoc(m));
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
  if (m.eventId) stats.inc(m.eventId, "outbox.queued");
  return true;
}

/**
 * Queues many messages (fan-out). Uses BulkWriter, which batches writes and
 * retries; messages that already exist are skipped. Returns how many were new.
 */
export async function enqueueMany(messages: EnqueueInput[]): Promise<number> {
  if (messages.length === 0) return 0;
  const writer = db.bulkWriter();
  let created = 0;
  writer.onWriteError((e) => {
    if (e.code === 6) return false; // already queued: skip, don't retry
    return e.failedAttempts < 3;
  });
  for (const m of messages) {
    writer
      .create(db.collection(COL.outbox).doc(outboxId(m.dedupeKey, m.uid)), outboxDoc(m))
      .then(() => {
        created++;
        if (m.eventId) stats.inc(m.eventId, "outbox.queued");
      })
      .catch(() => {});
  }
  await writer.close();
  return created;
}
