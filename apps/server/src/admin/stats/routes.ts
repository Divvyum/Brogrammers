import { Router } from "express";
import { DOC } from "@hackos/shared";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { db } from "../../core/firebase.js";
import { notFound } from "../../core/http.js";
import { stats } from "../../core/stats.js";

// Live stats (plan D15). The dashboard can also listen to events/{id}/stats/live
// directly; this is for one-off reads and forcing a recompute.

export const statsRouter = Router({ mergeParams: true });

statsRouter.get("/stats", requireRole("organizer"), async (req, res) => {
  const snap = await db.doc(DOC.liveStats(eventIdOf(req))).get();
  if (!snap.exists) throw notFound("Stats");
  res.json(snap.data());
});

statsRouter.post("/stats/recompute", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  await stats.flushAll();
  await stats.recompute(eventId);
  res.json((await db.doc(DOC.liveStats(eventId)).get()).data());
});
