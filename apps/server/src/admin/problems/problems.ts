import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../../core/audit.js";
import { audienceTopics, resolveAudience } from "../../core/audience.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { enqueueMany } from "../../core/outbox.js";
import { pushToTopics } from "../../core/push.js";

// Problem statements (plan D17). Participants can read a problem only once
// `released` is true (Firestore rules); this job flips it at releaseAt.

/** Releases one problem: marks it released and tells its track. Safe to call twice. */
export async function releaseProblem(eventId: string, problemId: string, actor = "system") {
  const ref = col(eventId, "problems").doc(problemId);
  const released = await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists || p.get("released")) return null;
    tx.update(ref, { released: true, releasedAt: FieldValue.serverTimestamp() });
    return p.data()!;
  });
  if (!released) return false;

  const audience = { type: "track" as const, ids: [released.track as string] };
  const uids = await resolveAudience(eventId, audience);
  await enqueueMany(
    uids.map((uid) => ({
      channel: "whatsapp" as const,
      uid,
      template: "problem_released",
      vars: { track: released.track, title: released.title },
      dedupeKey: `problem_${problemId}`,
      eventId,
    })),
  );
  await pushToTopics(audienceTopics(audience), { title: `${released.track} problem is live`, body: released.title });
  await writeAudit({ eventId, actor, action: "problem.release", target: problemId, after: { notified: uids.length } });
  return true;
}

/** Cron (every minute): releases every problem whose time has come. */
export async function releaseDueProblems(eventId: string, now = Timestamp.now()) {
  const due = await col(eventId, "problems").where("released", "==", false).where("releaseAt", "<=", now).get();
  let count = 0;
  for (const p of due.docs) if (await releaseProblem(eventId, p.id)) count++;
  return count;
}
