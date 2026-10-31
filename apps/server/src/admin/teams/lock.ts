import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../../core/audit.js";
import { col, eventRef, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { enqueueMany, type EnqueueInput } from "../../core/outbox.js";
import { stats } from "../../core/stats.js";
import { runEligibility } from "../eligibility/engine.js";

// Team lock at the deadline (plan D10). Runs from cron every minute; safe to
// run twice because it stops once teamsLockedAt is set.

export async function lockTeamsIfDue(eventId: string, now = Timestamp.now()): Promise<boolean> {
  const event = await getEvent(eventId);
  if (event.teamsLockedAt) return false;
  if (!event.deadlines?.teamLock || event.deadlines.teamLock.toMillis() > now.toMillis()) return false;
  await lockTeams(eventId);
  return true;
}

export async function lockTeams(eventId: string) {
  // Claim the lock first so two runs can't both send messages.
  const claimed = await db.runTransaction(async (tx) => {
    const e = await tx.get(eventRef(eventId));
    if (e.get("teamsLockedAt")) return false;
    tx.update(e.ref, { teamsLockedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  const [teams, requests] = await Promise.all([
    col(eventId, "teams").get(),
    col(eventId, "teamChangeRequests").where("status", "==", "pending").get(),
  ]);
  const memberUids = teams.docs.flatMap((t) => t.get("memberUids") as string[]);
  const participants = memberUids.length
    ? await db.getAll(...memberUids.map((uid) => col(eventId, "participants").doc(uid)))
    : [];

  const writer = db.bulkWriter();
  for (const t of teams.docs) writer.update(t.ref, { status: "locked" });
  for (const r of requests.docs) {
    writer.update(r.ref, { status: "rejected", reason: "Team lock deadline passed" });
  }
  const messages: EnqueueInput[] = [];
  for (const p of participants) {
    if (!p.exists) continue;
    if (p.get("status") === "eligible") writer.update(p.ref, { status: "team_locked" });
    messages.push({
      channel: "whatsapp",
      uid: p.id,
      template: "team_locked",
      vars: { teamId: p.get("teamId") ?? "" },
      dedupeKey: `team_locked_${eventId}`,
      eventId,
    });
  }
  await writer.close();
  await enqueueMany(messages);
  await writeAudit({
    eventId,
    actor: "system",
    action: "teams.lock",
    target: eventId,
    after: { teams: teams.size, rejectedRequests: requests.size },
  });
  // Now that teams are final: flag teams below the minimum and people with no team.
  await runEligibility(eventId);
  stats.recomputeSoon(eventId);
}
