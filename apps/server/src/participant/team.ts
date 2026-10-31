import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { col, getEvent } from "../core/events.js";
import { db } from "../core/firebase.js";
import { conflict, notFound } from "../core/http.js";
import { addMemberTx, removeMemberTx } from "../admin/teams/membership.js";

export const inviteCode = () => randomBytes(6).toString("base64url").toUpperCase().slice(0, 8);

export async function createTeam(eventId: string, uid: string, name: string, track?: string) {
  const event = await getEvent(eventId);
  if (Date.now() >= event.deadlines.teamLock.toMillis()) throw conflict("Team lock deadline passed");
  const ref = col(eventId, "teams").doc();
  await db.runTransaction(async (tx) => {
    const p = await tx.get(col(eventId, "participants").doc(uid));
    if (!p.exists) throw notFound("Participant");
    if (p.get("teamId")) throw conflict("Already in a team");
    tx.create(ref, { name, inviteCode: inviteCode(), leaderUid: uid, memberUids: [uid], track: track ?? p.get("track"), status: "forming", createdAt: FieldValue.serverTimestamp() });
    tx.update(p.ref, { teamId: ref.id, track: track ?? p.get("track") });
  });
  return (await ref.get()).data() && { id: ref.id, ...(await ref.get()).data() };
}

export async function joinTeam(eventId: string, uid: string, code: string) {
  const event = await getEvent(eventId);
  const found = await col(eventId, "teams").where("inviteCode", "==", code.toUpperCase()).limit(1).get();
  const team = found.docs[0];
  if (!team) throw notFound("Invite code");
  await db.runTransaction(async (tx) => { const apply = await addMemberTx(tx, eventId, team.id, uid, { teamMax: event.teamMax }); apply(); });
  return { teamId: team.id };
}

export async function leaveTeam(eventId: string, uid: string) {
  const p = await col(eventId, "participants").doc(uid).get();
  const teamId = p.get("teamId") as string | undefined;
  if (!teamId) throw conflict("Not in a team");
  await db.runTransaction(async (tx) => { const apply = await removeMemberTx(tx, eventId, teamId, uid); apply(); });
}
