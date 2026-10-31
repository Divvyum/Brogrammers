import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COL } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { enqueueMany } from "../../core/outbox.js";

// Overdue rewards and complaint escalation (plan D26). Both run from cron.

/** Organizers of an event: who gets told about overdue rewards and escalations. */
async function organizerUids(eventId: string) {
  const snap = await db.collection(COL.users).where("eventId", "==", eventId).where("role", "==", "organizer").select().get();
  return snap.docs.map((d) => d.id);
}

/** Flags rewards past their due date that haven't been delivered, and tells the organizers once. */
export async function markOverdueRewards(eventId: string, now = Timestamp.now()) {
  const due = await col(eventId, "rewards").where("dueAt", "<=", now).get();
  const late = due.docs.filter((r) => r.get("status") !== "delivered" && !r.get("overdue"));
  if (!late.length) return 0;

  const organizers = await organizerUids(eventId);
  const batch = db.batch();
  for (const r of late) batch.update(r.ref, { overdue: true, overdueAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await enqueueMany(
    late.flatMap((r) =>
      organizers.map((uid) => ({
        channel: "whatsapp" as const,
        uid,
        template: "reward_overdue",
        vars: { prize: r.get("prize"), dueAt: (r.get("dueAt") as Timestamp).toDate().toISOString() },
        priority: 1 as const,
        dedupeKey: `reward_overdue_${r.id}`,
        eventId,
      })),
    ),
  );
  for (const r of late) {
    await writeAudit({ eventId, actor: "system", action: "reward.overdue", target: r.id, after: { status: r.get("status") } });
  }
  return late.length;
}

/** Complaints still open (or only answered, not resolved) past their deadline are escalated. */
export async function escalateOverdueComplaints(eventId: string, now = Timestamp.now()) {
  const due = await col(eventId, "complaints").where("deadline", "<=", now).get();
  const stale = due.docs.filter((c) => ["open", "responded"].includes(c.get("status")));
  if (!stale.length) return 0;

  const organizers = await organizerUids(eventId);
  for (const c of stale) {
    await c.ref.update({
      status: "escalated",
      escalatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion({ at: now, by: "system", note: "Escalated: no resolution before the deadline" }),
    });
    await writeAudit({ eventId, actor: "system", action: "complaint.escalate", target: c.id, before: { status: c.get("status") } });
  }
  await enqueueMany(
    stale.flatMap((c) =>
      organizers.map((uid) => ({
        channel: "whatsapp" as const,
        uid,
        template: "complaint_escalated",
        vars: { complaintId: c.id },
        priority: 1 as const,
        dedupeKey: `complaint_escalated_${c.id}`,
        eventId,
      })),
    ),
  );
  return stale.length;
}
