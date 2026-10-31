import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { COL, type EligibilityResult } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { enqueue, enqueueMany, type EnqueueInput } from "../../core/outbox.js";
import { stats } from "../../core/stats.js";

// Eligibility engine (plan D9).

/** Statuses the engine may change. Later statuses (travel_booked onwards) are left alone. */
const EARLY_STATUSES = new Set(["registered", "eligible", "flagged", "rejected"]);
/** Also re-checked: after the lock, a team below the minimum gets flagged. */
const CHECKED_STATUSES = new Set([...EARLY_STATUSES, "team_locked"]);

/** The status a verdict leads to. A team_locked person stays locked unless they now fail. */
function nextStatus(current: string, v: Verdict): string {
  if (EARLY_STATUSES.has(current)) return v.result;
  return v.result === "eligible" ? current : v.result;
}

export interface Verdict {
  result: EligibilityResult;
  reason: string;
}

export interface TeamLimits {
  teamMin: number;
  teamMax: number;
  /** After the team lock, small teams and people without a team are flagged too. */
  locked: boolean;
}

/**
 * Rules, strictest first: a wrong year rejects; missing fields, a college not on
 * the list or a team outside the size limits flag the person for manual review.
 */
export function evaluate(
  rules: DocumentData,
  limits: TeamLimits,
  user: DocumentData,
  participant: DocumentData,
  teamSize: number,
): Verdict {
  const { teamMin, teamMax, locked } = limits;
  const allowedYears = rules.allowedYears as number[] | undefined;
  if (allowedYears?.length && user.year != null && !allowedYears.includes(user.year)) {
    return { result: "rejected", reason: `Year ${user.year} is not allowed (allowed: ${allowedYears.join(", ")})` };
  }

  const required = new Set<string>(rules.requiredFields ?? []);
  if (allowedYears?.length) required.add("year");
  const missing = [...required].filter((f) => {
    const v = user[f] ?? participant[f];
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length) return { result: "flagged", reason: `Missing: ${missing.join(", ")}` };

  const colleges = (rules.allowedColleges as string[] | undefined)?.map((c) => c.toLowerCase().trim());
  if (colleges?.length && !colleges.includes(String(user.college ?? "").toLowerCase().trim())) {
    return { result: "flagged", reason: `College "${user.college}" is not on the approved list` };
  }

  if (teamSize > teamMax) {
    return { result: "flagged", reason: `Team has ${teamSize} members (max ${teamMax})` };
  }
  if (locked && !participant.teamId) {
    return { result: "flagged", reason: "Not in a team after the team lock" };
  }
  if (locked && teamSize < teamMin) {
    return { result: "flagged", reason: `Team has ${teamSize} member${teamSize === 1 ? "" : "s"} (min ${teamMin})` };
  }
  return { result: "eligible", reason: "All checks passed" };
}

function message(eventId: string, uid: string, v: Verdict): EnqueueInput {
  return {
    channel: "whatsapp",
    uid,
    template: `eligibility_${v.result}`,
    vars: { reason: v.reason },
    // Includes the result, so a changed result sends a new message but a re-run doesn't.
    dedupeKey: `eligibility_${v.result}_${eventId}`,
    eventId,
  };
}

/** Runs the rules for everyone (or one person). Manual overrides are kept. */
export async function runEligibility(eventId: string, onlyUid?: string) {
  const event = await getEvent(eventId);
  const participants = onlyUid
    ? [await col(eventId, "participants").doc(onlyUid).get()]
    : (await col(eventId, "participants").get()).docs;
  if (onlyUid && !participants[0]?.exists) throw notFound("Participant");

  const todo = participants.filter(
    (p) => !p.get("mergedInto") && !p.get("eligibility.override") && CHECKED_STATUSES.has(p.get("status")),
  );
  const users = todo.length ? await db.getAll(...todo.map((p) => db.collection(COL.users).doc(p.id))) : [];
  const teamIds = [...new Set(todo.map((p) => p.get("teamId")).filter(Boolean))] as string[];
  const teams = new Map<string, DocumentSnapshot>();
  if (teamIds.length) {
    for (const t of await db.getAll(...teamIds.map((id) => col(eventId, "teams").doc(id)))) teams.set(t.id, t);
  }

  const summary = { eligible: 0, flagged: 0, rejected: 0, changed: 0, skipped: participants.length - todo.length };
  const writer = db.bulkWriter();
  const messages: EnqueueInput[] = [];
  todo.forEach((p, i) => {
    const team = teams.get(p.get("teamId"));
    const teamSize = (team?.get("memberUids") as string[] | undefined)?.length ?? 1;
    const limits = { teamMin: event.teamMin, teamMax: event.teamMax, locked: Boolean(event.teamsLockedAt) };
    const v = evaluate(event.eligibilityRules ?? {}, limits, users[i]?.data() ?? {}, p.data()!, teamSize);
    summary[v.result]++;
    const prev = p.get("eligibility");
    if (prev?.result === v.result && prev?.reason === v.reason) return;
    summary.changed++;
    writer.update(p.ref, { eligibility: v, status: nextStatus(p.get("status"), v) });
    messages.push(message(eventId, p.id, v));
  });
  await writer.close();
  await enqueueMany(messages);
  stats.recomputeSoon(eventId);
  return summary;
}

export async function overrideEligibility(
  eventId: string,
  uid: string,
  v: Verdict,
  actor: string,
) {
  const ref = col(eventId, "participants").doc(uid);
  await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw notFound("Participant");
    if (p.get("mergedInto")) throw conflict("This record was merged into another");
    const update: Record<string, unknown> = { eligibility: { ...v, override: true } };
    if (CHECKED_STATUSES.has(p.get("status"))) update.status = nextStatus(p.get("status"), v);
    tx.update(ref, update);
    await writeAudit(
      {
        eventId,
        actor,
        action: "eligibility.override",
        target: uid,
        before: p.get("eligibility") ?? null,
        after: v,
        reason: v.reason,
      },
      tx,
    );
  });
  await enqueue(message(eventId, uid, v));
  stats.recomputeSoon(eventId);
}
