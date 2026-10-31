import { Router } from "express";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { analytics } from "./analytics.js";

// Analytics (plan D28). Mounted under /api/admin/events/:eventId.

export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.get("/analytics", requireRole("organizer"), async (req, res) => {
  res.json(await analytics(eventIdOf(req)));
});
