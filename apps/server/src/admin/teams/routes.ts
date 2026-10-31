import { Router } from "express";
import { FieldPath } from "firebase-admin/firestore";
import { ForceMemberBody, PageQuery, RequestStatus, TeamRequestDecisionBody, TeamStatus } from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { col, getEvent, page } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { lockTeams } from "./lock.js";
import { addMemberTx, removeMemberTx } from "./membership.js";

// Teams, admin side (plan D10). Mounted under /api/admin/events/:eventId.

export const teamsRouter = Router({ mergeParams: true });

teamsRouter.get("/teams", requireRole("organizer", "mentor"), async (req, res) => {
  const q = parseQuery(req, PageQuery.extend({ status: TeamStatus.optional(), track: z.string().optional() }));
  let query = col(eventIdOf(req), "teams").orderBy(FieldPath.documentId());
  if (q.status) query = query.where("status", "==", q.status);
  if (q.track) query = query.where("track", "==", q.track);
  if (q.after) query = query.startAfter(q.after);
  const snap = await query.limit(q.limit + 1).get();
  res.json(page(snap.docs.map((d) => ({ id: d.id, ...d.data() })), q.limit));
});

teamsRouter.get("/teams/:teamId", requireRole("organizer", "mentor"), async (req, res) => {
  const eventId = eventIdOf(req);
  const team = await col(eventId, "teams").doc(param(req, "teamId")).get();
  if (!team.exists) throw notFound("Team");
  const uids = team.get("memberUids") as string[];
  const members = uids.length
    ? await db.getAll(...uids.map((u) => col(eventId, "participants").doc(u)), {
        fieldMask: ["name", "college", "status", "track"],
      })
    : [];
  res.json({ id: team.id, ...team.data(), members: members.map((m) => ({ id: m.id, ...m.data() })) });
});

teamsRouter.get("/team-requests", requireRole("organizer"), async (req, res) => {
  const { status } = parseQuery(req, z.object({ status: RequestStatus.default("pending") }));
  const snap = await col(eventIdOf(req), "teamChangeRequests").where("status", "==", status).get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

teamsRouter.post("/team-requests/:id/decision", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, TeamRequestDecisionBody);
  const event = await getEvent(eventId);
  const ref = col(eventId, "teamChangeRequests").doc(param(req, "id"));

  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) throw notFound("Request");
    if (r.get("status") !== "pending") throw conflict(`Request is already ${r.get("status")}`);

    let apply: (() => unknown) | undefined;
    if (body.decision === "approved") {
      if (event.teamsLockedAt) throw conflict("Teams are locked; use force add/remove instead");
      const type = r.get("type");
      apply =
        type === "leave"
          ? await removeMemberTx(tx, eventId, r.get("teamId"), r.get("uid"))
          : await addMemberTx(tx, eventId, r.get("teamId"), r.get("uid"), { teamMax: event.teamMax });
    }
    apply?.();
    tx.update(ref, { status: body.decision, reason: body.reason, decidedBy: req.user!.uid });
    await writeAudit(
      {
        eventId,
        actor: req.user!.uid,
        action: `teamRequest.${body.decision}`,
        target: r.id,
        after: { type: r.get("type"), uid: r.get("uid"), teamId: r.get("teamId") },
        reason: body.reason,
      },
      tx,
    );
  });
  res.json({ ok: true });
});

teamsRouter.post("/teams/:teamId/members", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ForceMemberBody);
  const event = await getEvent(eventId);
  const teamId = param(req, "teamId");
  await db.runTransaction(async (tx) => {
    const apply = await addMemberTx(tx, eventId, teamId, body.uid, { teamMax: event.teamMax, force: true });
    const change = apply();
    await writeAudit(
      { eventId, actor: req.user!.uid, action: "team.forceAdd", target: teamId, ...change, reason: body.reason },
      tx,
    );
  });
  res.json({ ok: true });
});

teamsRouter.delete("/teams/:teamId/members/:uid", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { reason } = parseBody(req, z.object({ reason: z.string().trim().min(3) }));
  const teamId = param(req, "teamId");
  await db.runTransaction(async (tx) => {
    const apply = await removeMemberTx(tx, eventId, teamId, param(req, "uid"), { force: true });
    const change = apply();
    await writeAudit(
      { eventId, actor: req.user!.uid, action: "team.forceRemove", target: teamId, ...change, reason },
      tx,
    );
  });
  res.json({ ok: true });
});

/** Locks all teams now, without waiting for the deadline. */
teamsRouter.post("/teams/lock", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const event = await getEvent(eventId);
  if (event.teamsLockedAt) throw conflict("Teams are already locked");
  await lockTeams(eventId);
  await writeAudit({ eventId, actor: req.user!.uid, action: "teams.lockNow", target: eventId });
  res.json({ ok: true });
});
