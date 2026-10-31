import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { COL } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, forbidden, notFound } from "../../core/http.js";
import { enqueue } from "../../core/outbox.js";
import { addMemberTx, removeMemberTx } from "../teams/membership.js";

// Replacement engine (plan D11). When someone withdraws, the best-fitting solo
// participant who opted in is invited; if they decline or the invitation
// expires, the next one is; when the list runs out, the top of the waitlist is
// offered the seat. The candidate accepts (participant app, Phase 2), then an
// organizer approves and they join the team. Every step is audited.

export const INVITE_TTL_MS = Number(process.env.REPLACEMENT_INVITE_MINUTES ?? 120) * 60_000;

const repRef = (eventId: string, id: string) => col(eventId, "replacements").doc(id);

export interface Candidate {
  uid: string;
  score: number;
}

/** Solo participants who opted in, are eligible and have no team. */
export async function findCandidates(eventId: string, exclude: string[] = []): Promise<DocumentSnapshot[]> {
  const snap = await col(eventId, "participants").where("openToReplacement.on", "==", true).get();
  return snap.docs.filter(
    (p) =>
      !exclude.includes(p.id) &&
      !p.get("teamId") &&
      !p.get("mergedInto") &&
      !p.get("withdrawnAt") &&
      p.get("eligibility.result") === "eligible",
  );
}

/**
 * Ranks by skill fit (skills the team doesn't have yet), same track and stated
 * availability. Ties go to whoever registered first.
 */
export async function rank(eventId: string, teamId: string, candidates: DocumentSnapshot[]): Promise<Candidate[]> {
  if (!candidates.length) return [];
  const team = await col(eventId, "teams").doc(teamId).get();
  const memberUids = (team.get("memberUids") as string[]) ?? [];
  const users = await db.getAll(
    ...[...memberUids, ...candidates.map((c) => c.id)].map((u) => db.collection(COL.users).doc(u)),
    { fieldMask: ["skills"] },
  );
  const skillsOf = new Map(users.map((u) => [u.id, ((u.get("skills") as string[]) ?? []).map((s) => s.toLowerCase())]));
  const teamSkills = new Set(memberUids.flatMap((u) => skillsOf.get(u) ?? []));

  return candidates
    .map((c) => {
      const declared = (c.get("openToReplacement.skills") as string[] | undefined)?.map((s) => s.toLowerCase());
      const skills = declared?.length ? declared : (skillsOf.get(c.id) ?? []);
      const complementary = skills.filter((s) => !teamSkills.has(s)).length;
      const trackMatch = team.get("track") && c.get("track") === team.get("track") ? 2 : 0;
      const available = c.get("openToReplacement.availability") ? 1 : 0;
      return { uid: c.id, score: complementary * 3 + trackMatch + available, at: c.get("registeredAt")?.toMillis() ?? 0 };
    })
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map(({ uid, score }) => ({ uid, score }));
}

/** Organizer or participant withdraws someone from a team. Returns the replacement ID. */
export async function onWithdraw(eventId: string, teamId: string, uid: string, actor: string, reason?: string) {
  const ref = col(eventId, "replacements").doc();
  await db.runTransaction(async (tx) => {
    const apply = await removeMemberTx(tx, eventId, teamId, uid, { force: true });
    const change = apply();
    tx.update(col(eventId, "participants").doc(uid), { withdrawnAt: FieldValue.serverTimestamp() });
    tx.create(ref, {
      teamId,
      vacantUid: uid,
      candidates: [],
      passed: [],
      status: "searching",
      createdAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({ eventId, actor, action: "team.withdraw", target: teamId, ...change, reason }, tx);
  });

  const ranked = await rank(eventId, teamId, await findCandidates(eventId, [uid]));
  await ref.update({ candidates: ranked.map((c) => c.uid) });
  await inviteNext(eventId, ref.id);
  return ref.id;
}

/** Invites the next candidate who hasn't passed; falls back to the waitlist, then gives up. */
export async function inviteNext(eventId: string, replacementId: string) {
  const outcome = await db.runTransaction(async (tx) => {
    const r = await tx.get(repRef(eventId, replacementId));
    if (!r.exists) throw notFound("Replacement");
    const passed = (r.get("passed") as string[]) ?? [];
    const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);

    // Re-check each candidate: someone may have joined another team meanwhile.
    const remaining = (r.get("candidates") as string[]).filter((u) => !passed.includes(u));
    const snaps = remaining.length
      ? await tx.getAll(...remaining.map((u) => col(eventId, "participants").doc(u)))
      : [];
    const next = snaps.find((p) => p.exists && !p.get("teamId") && !p.get("withdrawnAt"));
    if (next) {
      tx.update(r.ref, { status: "invited", currentCandidate: next.id, inviteExpiresAt: expiresAt });
      return { kind: "invited" as const, uid: next.id, teamId: r.get("teamId") as string, expiresAt };
    }

    const waiting = await tx.get(
      col(eventId, "waitlist").where("status", "==", "waiting").where("eligible", "==", true).orderBy("position").limit(1),
    );
    const top = waiting.docs[0];
    if (top) {
      tx.update(top.ref, {
        status: "offered",
        offeredAt: FieldValue.serverTimestamp(),
        offerExpiresAt: expiresAt,
        replacementId,
      });
      tx.update(r.ref, { status: "waitlist", currentCandidate: top.id, inviteExpiresAt: expiresAt });
      return { kind: "waitlist" as const, uid: top.id, teamId: r.get("teamId") as string, expiresAt };
    }

    tx.update(r.ref, { status: "failed", currentCandidate: FieldValue.delete(), inviteExpiresAt: FieldValue.delete() });
    return { kind: "failed" as const, teamId: r.get("teamId") as string };
  });

  if (outcome.kind !== "failed") {
    await enqueue({
      channel: "whatsapp",
      uid: outcome.uid,
      template: outcome.kind === "invited" ? "replacement_invite" : "waitlist_offer",
      vars: { teamId: outcome.teamId, expiresAt: outcome.expiresAt.toDate().toISOString() },
      dedupeKey: `replacement_${replacementId}`,
      eventId,
    });
  }
  await writeAudit({
    eventId,
    actor: "system",
    action: `replacement.${outcome.kind}`,
    target: replacementId,
    after: outcome.kind === "failed" ? null : { uid: outcome.uid },
  });
  return outcome;
}

/** Moves on from the current candidate (declined or expired). */
export async function passCurrent(eventId: string, replacementId: string, why: "declined" | "expired", uid?: string) {
  const passedUid = await db.runTransaction(async (tx) => {
    const r = await tx.get(repRef(eventId, replacementId));
    if (!r.exists) throw notFound("Replacement");
    const status = r.get("status");
    if (status !== "invited" && status !== "waitlist") throw conflict(`Replacement is ${status}`);
    const current = r.get("currentCandidate") as string;
    if (uid && uid !== current) throw forbidden("This invitation is not yours");
    if (status === "waitlist") {
      tx.update(col(eventId, "waitlist").doc(current), { status: why === "declined" ? "declined" : "expired" });
    }
    tx.update(r.ref, { passed: FieldValue.arrayUnion(current), currentCandidate: FieldValue.delete() });
    return current;
  });
  await writeAudit({ eventId, actor: uid ?? "system", action: `replacement.${why}`, target: replacementId, after: { uid: passedUid } });
  return inviteNext(eventId, replacementId);
}

/** Candidate accepts (wired to the participant app by Manthan in Phase 2). */
export async function accept(eventId: string, replacementId: string, uid: string) {
  const teamId = await db.runTransaction(async (tx) => {
    const r = await tx.get(repRef(eventId, replacementId));
    if (!r.exists) throw notFound("Replacement");
    const status = r.get("status");
    if (status !== "invited" && status !== "waitlist") throw conflict(`Replacement is ${status}`);
    if (r.get("currentCandidate") !== uid) throw forbidden("This invitation is not yours");
    if ((r.get("inviteExpiresAt") as Timestamp).toMillis() < Date.now()) throw conflict("Invitation expired");
    if (status === "waitlist") tx.update(col(eventId, "waitlist").doc(uid), { status: "accepted" });
    tx.update(r.ref, { status: "accepted", acceptedUid: uid });
    return r.get("teamId") as string;
  });
  const team = await col(eventId, "teams").doc(teamId).get();
  await enqueue({
    channel: "whatsapp",
    uid: team.get("leaderUid"),
    template: "replacement_accepted",
    vars: { teamId },
    dedupeKey: `replacement_accepted_${replacementId}`,
    eventId,
  });
  await writeAudit({ eventId, actor: uid, action: "replacement.accept", target: replacementId });
}

export const decline = (eventId: string, replacementId: string, uid: string) =>
  passCurrent(eventId, replacementId, "declined", uid);

/** Organizer approves: the accepted candidate joins the team (even if teams are locked). */
export async function approve(eventId: string, replacementId: string, actor: string, reason?: string) {
  const event = await getEvent(eventId);
  const { uid, teamId } = await db.runTransaction(async (tx) => {
    const r = await tx.get(repRef(eventId, replacementId));
    if (!r.exists) throw notFound("Replacement");
    if (r.get("status") !== "accepted") throw conflict("Only an accepted replacement can be approved");
    const uid = r.get("acceptedUid") as string;
    const teamId = r.get("teamId") as string;
    const apply = await addMemberTx(tx, eventId, teamId, uid, { teamMax: event.teamMax, force: true });
    const change = apply();
    tx.update(r.ref, { status: "approved", approvedBy: actor });
    await writeAudit({ eventId, actor, action: "replacement.approve", target: replacementId, ...change, reason }, tx);
    return { uid, teamId };
  });
  await enqueue({
    channel: "whatsapp",
    uid,
    template: "replacement_approved",
    vars: { teamId },
    dedupeKey: `replacement_approved_${replacementId}`,
    eventId,
  });
}

/** Cron: moves on from every invitation that has expired. */
export async function expireInvites(eventId: string, now = Timestamp.now()) {
  const snap = await col(eventId, "replacements")
    .where("status", "in", ["invited", "waitlist"])
    .where("inviteExpiresAt", "<=", now)
    .get();
  for (const r of snap.docs) {
    try {
      await passCurrent(eventId, r.id, "expired");
    } catch (err) {
      console.error(`[replacement] expire ${r.id} failed`, err);
    }
  }
  return snap.size;
}
