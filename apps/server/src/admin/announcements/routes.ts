import { Router } from "express";
import { AiDraftBody, AnnouncementBody } from "@hackos/shared";
import { resolveAudience } from "../../core/audience.js";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { col } from "../../core/events.js";
import { parseBody } from "../../core/validate.js";
import { draftAnnouncement, sendAnnouncement } from "./announcements.js";

// Announcements (plan D18). Mounted under /api/admin/events/:eventId.

export const announcementsRouter = Router({ mergeParams: true });

announcementsRouter.get("/announcements", requireRole("organizer"), async (req, res) => {
  const snap = await col(eventIdOf(req), "announcements").orderBy("createdAt", "desc").limit(100).get();
  res.json({
    items: snap.docs.map((d) => {
      const recipients = (d.get("recipients") as number) ?? 0;
      return { id: d.id, ...d.data(), seenPct: recipients ? Math.round((d.get("seenCount") / recipients) * 100) : 0 };
    }),
  });
});

announcementsRouter.post("/announcements", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, AnnouncementBody);
  res.status(201).json(await sendAnnouncement(eventIdOf(req), body, req.user!.uid));
});

announcementsRouter.post("/announcements/preview-audience", requireRole("organizer"), async (req, res) => {
  const { audience } = parseBody(req, AnnouncementBody.pick({ audience: true }));
  res.json({ count: (await resolveAudience(eventIdOf(req), audience)).length });
});

announcementsRouter.post("/announcements/ai-draft", requireRole("organizer"), async (req, res) => {
  const { notes, tone } = parseBody(req, AiDraftBody);
  res.json(await draftAnnouncement(notes, tone));
});
