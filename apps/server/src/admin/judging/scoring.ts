import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { COL, PARTICIPANT_STATUSES, type ScoreBody } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { resolveAudience } from "../../core/audience.js";
import { col, eventRef } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/http.js";
import { enqueueMany } from "../../core/outbox.js";

// Scoring, leaderboard and results (plan D24).

export const OUTLIER_Z = 1.5;

interface Criterion {
  id: string;
  name: string;
  weight: number;
  max: number;
}

export async function loadRubric(eventId: string, round: string): Promise<Criterion[]> {
  const snap = await col(eventId, "rubric").doc(round).get();
  if (!snap.exists) throw notFound(`Rubric for round "${round}"`);
  return snap.get("criteria") as Criterion[];
}

/** Weighted total out of 100: each criterion counts score/max × weight. */
export function weightedTotal(rubric: Criterion[], criteria: Record<string, number>): number {
  const total = rubric.reduce((t, c) => t + ((criteria[c.id] ?? 0) / c.max) * c.weight, 0);
  return Math.round(total * 100) / 100;
}

function validateCriteria(rubric: Criterion[], criteria: Record<string, number>) {
  const ids = new Set(rubric.map((c) => c.id));
  const extra = Object.keys(criteria).filter((k) => !ids.has(k));
  if (extra.length) throw badRequest(`Unknown criteria: ${extra.join(", ")}`);
  for (const c of rubric) {
    const v = criteria[c.id];
    if (v == null) throw badRequest(`Missing score for "${c.name}"`);
    if (v < 0 || v > c.max) throw badRequest(`"${c.name}" must be between 0 and ${c.max}`);
  }
}

/**
 * Saves a judge's score. `submit` locks it. Changing a locked score needs a
 * reason and is audited. Judges may only score teams assigned to them.
 */
export async function saveScore(
  eventId: string,
  teamId: string,
  judgeUid: string,
  body: ScoreBody,
  actor: { uid: string; role: string },
) {
  if (actor.role === "judge") {
    if (actor.uid !== judgeUid) throw forbidden("Judges can only enter their own scores");
    const a = await col(eventId, "judgeAssignments").doc(judgeUid).get();
    if (!(a.get("teamIds") as string[] | undefined)?.includes(teamId)) throw forbidden("This team isn't assigned to you");
  }
  const rubric = await loadRubric(eventId, body.round);
  validateCriteria(rubric, body.criteria);
  const total = weightedTotal(rubric, body.criteria);
  const ref = col(eventId, "scores").doc(`${judgeUid}_${teamId}`);

  const locked = await db.runTransaction(async (tx) => {
    const prev = await tx.get(ref);
    const wasLocked = prev.exists && prev.get("locked");
    if (wasLocked && !body.reason) throw conflict("This score is locked; give a reason to change it");
    const doc: DocumentData = {
      judgeUid,
      teamId,
      round: body.round,
      criteria: body.criteria,
      total,
      comment: body.comment ?? prev.get("comment") ?? null,
      locked: wasLocked || body.submit,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!wasLocked && body.submit) doc.lockedAt = FieldValue.serverTimestamp();
    tx.set(ref, doc, { merge: true });
    if (wasLocked) {
      await writeAudit(
        {
          eventId,
          actor: actor.uid,
          action: "score.editLocked",
          target: ref.id,
          before: { criteria: prev.get("criteria"), total: prev.get("total") },
          after: { criteria: body.criteria, total },
          reason: body.reason,
        },
        tx,
      );
    } else if (body.submit) {
      await writeAudit({ eventId, actor: actor.uid, action: "score.submit", target: ref.id, after: { total } }, tx);
    }
    return doc.locked as boolean;
  });

  if (locked) await computeLeaderboard(eventId, body.round);
  return { total, locked };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const stddev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * Leaderboard from locked scores: each team's average weighted total across its
 * judges, with a per-criterion breakdown. Ties share a rank (1, 2, 2, 4).
 * Judge consistency: each judge's average vs. the panel; |z| ≥ 1.5 is flagged.
 */
export async function computeLeaderboard(eventId: string, round = "current") {
  const [rubric, scores, teams] = await Promise.all([
    loadRubric(eventId, round),
    col(eventId, "scores").where("round", "==", round).where("locked", "==", true).get(),
    col(eventId, "teams").select("name").get(),
  ]);
  const teamName = new Map(teams.docs.map((t) => [t.id, t.get("name") as string]));

  const byTeam = new Map<string, DocumentData[]>();
  const byJudge = new Map<string, number[]>();
  for (const s of scores.docs) {
    byTeam.set(s.get("teamId"), [...(byTeam.get(s.get("teamId")) ?? []), s.data()]);
    byJudge.set(s.get("judgeUid"), [...(byJudge.get(s.get("judgeUid")) ?? []), s.get("total")]);
  }

  const rows = [...byTeam.entries()].map(([teamId, list]) => {
    const breakdown: Record<string, number> = {};
    for (const c of rubric) {
      breakdown[c.id] = Math.round(mean(list.map((s) => (s.criteria[c.id] / c.max) * c.weight)) * 100) / 100;
    }
    return {
      teamId,
      teamName: teamName.get(teamId) ?? teamId,
      total: Math.round(mean(list.map((s) => s.total)) * 100) / 100,
      breakdown,
      judges: list.length,
      rank: 0,
    };
  });
  rows.sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));
  rows.forEach((r, i) => (r.rank = i > 0 && r.total === rows[i - 1]!.total ? rows[i - 1]!.rank : i + 1));

  const judgeAverages = [...byJudge.entries()].map(([judgeUid, totals]) => ({ judgeUid, average: mean(totals), count: totals.length }));
  const panelMean = mean(judgeAverages.map((j) => j.average));
  const panelSd = stddev(judgeAverages.map((j) => j.average));
  const consistency = judgeAverages.map((j) => ({
    ...j,
    average: Math.round(j.average * 100) / 100,
    z: panelSd ? Math.round(((j.average - panelMean) / panelSd) * 100) / 100 : 0,
  }));
  const outlierJudges = consistency.filter((j) => Math.abs(j.z) >= OUTLIER_Z).map(({ judgeUid, average, z }) => ({ judgeUid, average, z }));

  const doc = { round, teams: rows, outlierJudges, consistency, computedAt: FieldValue.serverTimestamp() };
  await col(eventId, "leaderboard").doc(round === "current" ? "current" : round).set(doc);
  return { ...doc, computedAt: new Date() };
}

/** Publishes results: leaderboard visible, everyone notified, status moves to "results". */
export async function publishResults(eventId: string, actor: string) {
  await computeLeaderboard(eventId);
  await eventRef(eventId).update({ leaderboardVisible: true, resultsPublishedAt: FieldValue.serverTimestamp() });

  const uids = await resolveAudience(eventId, { type: "all", ids: [] });
  const resultsIdx = PARTICIPANT_STATUSES.indexOf("results");
  const parts = uids.length ? await db.getAll(...uids.map((u) => col(eventId, "participants").doc(u)), { fieldMask: ["status", "checkedInAt"] }) : [];
  const writer = db.bulkWriter();
  for (const p of parts) {
    const idx = PARTICIPANT_STATUSES.indexOf(p.get("status"));
    if (p.get("checkedInAt") && idx >= 0 && idx < resultsIdx) writer.update(p.ref, { status: "results" });
  }
  await writer.close();
  const queued = await enqueueMany(
    uids.map((uid) => ({ channel: "whatsapp" as const, uid, template: "results_published", dedupeKey: `results_${eventId}`, eventId })),
  );
  await writeAudit({ eventId, actor, action: "results.publish", target: eventId, after: { notified: uids.length } });
  return { notified: queued };
}

/** Judges in an event, with their assigned teams. */
export async function listJudges(eventId: string) {
  const judges = await db.collection(COL.users).where("eventId", "==", eventId).where("role", "==", "judge").get();
  const assignments = judges.docs.length
    ? await db.getAll(...judges.docs.map((j) => col(eventId, "judgeAssignments").doc(j.id)))
    : [];
  return judges.docs.map((j, i) => ({ uid: j.id, name: j.get("name"), teamIds: (assignments[i]?.get("teamIds") as string[]) ?? [] }));
}
