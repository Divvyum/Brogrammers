import { Router } from "express";
import { AddWaitlistBody, ReplacementApproveBody, ReplacementStatus, WithdrawBody } from "@hackos/shared";
import { z } from "zod";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { col } from "../../core/events.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { approve, onWithdraw } from "./replacement.service.js";
import { addToWaitlist, offerSeat, recomputeWaitlist } from "./waitlist.js";

// Waitlist and replacements, admin side (plan D11).
// Mounted under /api/admin/events/:eventId.

export const replacementRouter = Router({ mergeParams: true });

replacementRouter.post("/teams/:teamId/withdraw", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, WithdrawBody);
  const id = await onWithdraw(eventIdOf(req), param(req, "teamId"), body.uid, req.user!.uid, body.reason);
  const rep = await col(eventIdOf(req), "replacements").doc(id).get();
  res.status(201).json({ id, ...rep.data() });
});

replacementRouter.get("/replacements", requireRole("organizer"), async (req, res) => {
  const { status } = parseQuery(req, z.object({ status: ReplacementStatus.optional() }));
  let q = col(eventIdOf(req), "replacements").orderBy("createdAt", "desc");
  if (status) q = q.where("status", "==", status);
  const snap = await q.limit(100).get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

replacementRouter.post("/replacements/:id/approve", requireRole("organizer"), async (req, res) => {
  const { reason } = parseBody(req, ReplacementApproveBody);
  await approve(eventIdOf(req), param(req, "id"), req.user!.uid, reason);
  res.json({ ok: true });
});

replacementRouter.get("/waitlist", requireRole("organizer"), async (req, res) => {
  const snap = await col(eventIdOf(req), "waitlist").orderBy("position").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

replacementRouter.post("/waitlist", requireRole("organizer"), async (req, res) => {
  const { uids } = parseBody(req, AddWaitlistBody);
  res.json(await addToWaitlist(eventIdOf(req), uids, req.user!.uid));
});

replacementRouter.post("/waitlist/recompute", requireRole("organizer"), async (req, res) => {
  res.json({ waiting: await recomputeWaitlist(eventIdOf(req)) });
});

replacementRouter.post("/waitlist/:uid/offer", requireRole("organizer"), async (req, res) => {
  await offerSeat(eventIdOf(req), param(req, "uid"), req.user!.uid);
  res.json({ ok: true });
});
