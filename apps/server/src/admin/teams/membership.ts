import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { col } from "../../core/events.js";
import { conflict, notFound } from "../../core/http.js";

// Team membership changes inside a transaction. Used by the admin team routes
// and the replacement engine; Manthan's participant routes use them in Phase 2.
// All reads happen before any write, as Firestore transactions require.

export interface MembershipOptions {
  teamMax: number;
  /** Admin force-add: allowed on locked teams and above the size limit. */
  force?: boolean;
}

export async function addMemberTx(
  tx: Transaction,
  eventId: string,
  teamId: string,
  uid: string,
  opts: MembershipOptions,
) {
  const teamRef = col(eventId, "teams").doc(teamId);
  const pRef = col(eventId, "participants").doc(uid);
  const [team, p] = await tx.getAll(teamRef, pRef);
  if (!team?.exists) throw notFound("Team");
  if (!p?.exists) throw notFound("Participant");
  if (p.get("mergedInto")) throw conflict("This record was merged into another");
  if (p.get("teamId")) throw conflict("Participant is already in a team");

  const members = team.get("memberUids") as string[];
  if (!opts.force) {
    if (team.get("status") === "locked") throw conflict("Team is locked");
    if (members.length >= opts.teamMax) throw conflict(`Team is full (max ${opts.teamMax})`);
  }
  return () => {
    tx.update(teamRef, { memberUids: FieldValue.arrayUnion(uid) });
    const update: Record<string, unknown> = { teamId };
    if (team.get("track")) update.track = team.get("track");
    if (team.get("status") === "locked" && p.get("status") === "eligible") update.status = "team_locked";
    tx.update(pRef, update);
    return { before: members, after: [...members, uid] };
  };
}

export async function removeMemberTx(
  tx: Transaction,
  eventId: string,
  teamId: string,
  uid: string,
  opts: { force?: boolean } = {},
) {
  const teamRef = col(eventId, "teams").doc(teamId);
  const pRef = col(eventId, "participants").doc(uid);
  const [team, p] = await tx.getAll(teamRef, pRef);
  if (!team?.exists) throw notFound("Team");
  const members = team.get("memberUids") as string[];
  if (!members.includes(uid)) throw conflict("Not a member of this team");
  if (!opts.force && team.get("status") === "locked") throw conflict("Team is locked");

  return () => {
    const rest = members.filter((m) => m !== uid);
    const update: Record<string, unknown> = { memberUids: rest };
    if (team.get("leaderUid") === uid && rest[0]) update.leaderUid = rest[0];
    tx.update(teamRef, update);
    if (p?.exists) {
      const pUpdate: Record<string, unknown> = { teamId: FieldValue.delete() };
      if (p.get("status") === "team_locked") pUpdate.status = "eligible";
      tx.update(pRef, pUpdate);
    }
    return { before: members, after: rest };
  };
}
