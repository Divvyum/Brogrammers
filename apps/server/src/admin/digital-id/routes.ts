import { Router } from "express";
import { COL, RevokeBody, RosterQuery, SendEnrollmentBody } from "@hackos/shared";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { env } from "../../core/env.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { reissueId, revokeId, sendEnrollmentLinks } from "./credentials.js";

// Digital ID management and the volunteer roster (plan D13).
// Mounted under /api/admin/events/:eventId.

export const digitalIdRouter = Router({ mergeParams: true });

digitalIdRouter.post("/enrollment/send", requireRole("organizer"), async (req, res) => {
  const { uids } = parseBody(req, SendEnrollmentBody);
  res.json(await sendEnrollmentLinks(eventIdOf(req), req.user!.uid, uids));
});

digitalIdRouter.post("/participants/:uid/revoke", requireRole("organizer"), async (req, res) => {
  const { reason } = parseBody(req, RevokeBody);
  await revokeId(eventIdOf(req), param(req, "uid"), req.user!.uid, reason);
  res.json({ ok: true });
});

digitalIdRouter.post("/participants/:uid/reissue", requireRole("organizer"), async (req, res) => {
  const { reason } = parseBody(req, RevokeBody);
  await reissueId(eventIdOf(req), param(req, "uid"), req.user!.uid, reason);
  res.json({ ok: true });
});

/**
 * Volunteer roster (Samrat's guide 6.4). `?since=N` returns only participants
 * changed after roster version N; `removed` lists merged or withdrawn people the
 * device should delete. No phone numbers or emails are included.
 */
digitalIdRouter.get("/roster", requireRole("volunteer", "organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { since } = parseQuery(req, RosterQuery);
  const [event, snap] = await Promise.all([
    getEvent(eventId),
    col(eventId, "participants").where("rosterVersion", ">", since).get(),
  ]);

  const removed = snap.docs.filter((p) => p.get("mergedInto") || p.get("withdrawnAt")).map((p) => p.id);
  const active = snap.docs.filter((p) => !removed.includes(p.id));
  const teamIds = [...new Set(active.map((p) => p.get("teamId")).filter(Boolean))] as string[];
  const [teams, users] = await Promise.all([
    teamIds.length
      ? db.getAll(...teamIds.map((id) => col(eventId, "teams").doc(id)), { fieldMask: ["name"] })
      : [],
    active.length
      ? db.getAll(...active.map((p) => db.collection(COL.users).doc(p.id)), { fieldMask: ["photoUrl"] })
      : [],
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.get("name") as string]));

  res.json({
    eventId,
    rosterVersion: event.rosterVersion,
    organizerPubKey: env.organizerPublicKey,
    participants: active.map((p, i) => ({
      participantId: p.id,
      name: p.get("name"),
      college: p.get("college") ?? null,
      teamId: p.get("teamId") ?? null,
      teamName: teamName.get(p.get("teamId")) ?? null,
      roomId: p.get("roomId") ?? null,
      seat: p.get("seat") ?? null,
      photoUrl: users[i]?.get("photoUrl") ?? null,
      devicePubKey: p.get("enrollment.devicePubKey") ?? null,
      status: p.get("enrollment.status") ?? "invited",
      backupCodeHash: p.get("backupCode") ?? null,
      checkedInAt: p.get("checkedInAt") ?? null,
    })),
    revoked: active.filter((p) => p.get("enrollment.status") === "revoked").map((p) => p.id),
    removed,
  });
});
