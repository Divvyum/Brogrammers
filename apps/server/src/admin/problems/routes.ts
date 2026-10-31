import { Router } from "express";
import { ProblemBody } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, conflict, isoToTs, notFound } from "../../core/http.js";
import { parseBody } from "../../core/validate.js";
import { releaseProblem } from "./problems.js";

// Problem statements (plan D17). Mounted under /api/admin/events/:eventId.

export const problemsRouter = Router({ mergeParams: true });

async function assertTrack(eventId: string, track: string) {
  const event = await getEvent(eventId);
  if (!event.tracks.includes(track)) throw badRequest(`Unknown track "${track}"`);
}

problemsRouter.get("/problems", requireRole("organizer", "mentor", "judge"), async (req, res) => {
  const snap = await col(eventIdOf(req), "problems").orderBy("releaseAt").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

problemsRouter.post("/problems", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ProblemBody);
  await assertTrack(eventId, body.track);
  const ref = col(eventId, "problems").doc();
  const doc = { ...body, releaseAt: isoToTs(body.releaseAt), released: false };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "problem.create", target: ref.id, after: body }, batch);
  await batch.commit();
  res.status(201).json({ id: ref.id, ...doc });
});

problemsRouter.patch("/problems/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ProblemBody);
  await assertTrack(eventId, body.track);
  const ref = col(eventId, "problems").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw notFound("Problem");
    // After release only the text can change, not the track or time.
    if (p.get("released") && (body.track !== p.get("track") || isoToTs(body.releaseAt).toMillis() !== p.get("releaseAt").toMillis())) {
      throw conflict("Already released: only the title and text can change");
    }
    tx.update(ref, { ...body, releaseAt: isoToTs(body.releaseAt) });
    await writeAudit({ eventId, actor: req.user!.uid, action: "problem.update", target: ref.id, before: p.data(), after: body }, tx);
  });
  res.json({ ok: true });
});

problemsRouter.delete("/problems/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const ref = col(eventId, "problems").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw notFound("Problem");
    if (p.get("released")) throw conflict("Released problems can't be deleted");
    tx.delete(ref);
    await writeAudit({ eventId, actor: req.user!.uid, action: "problem.delete", target: ref.id, before: p.data() }, tx);
  });
  res.json({ ok: true });
});

/** Release now instead of waiting for releaseAt. */
problemsRouter.post("/problems/:id/release", requireRole("organizer"), async (req, res) => {
  const ok = await releaseProblem(eventIdOf(req), param(req, "id"), req.user!.uid);
  if (!ok) throw conflict("Already released or not found");
  res.json({ ok: true });
});
