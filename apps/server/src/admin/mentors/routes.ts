import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { COL, MentorAvailabilityBody, MentorNoteBody, MentorTracksBody } from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, forbidden, notFound } from "../../core/http.js";
import { parseBody, parseQuery } from "../../core/validate.js";

// Mentors (plan D20). Mounted under /api/admin/events/:eventId.

export const mentorsRouter = Router({ mergeParams: true });

async function loadMentor(eventId: string, uid: string) {
  const m = await db.collection(COL.users).doc(uid).get();
  if (!m.exists || m.get("role") !== "mentor" || m.get("eventId") !== eventId) throw notFound("Mentor");
  return m;
}

/** A mentor may act only on themselves; organizers on anyone. */
function assertSelfOrOrganizer(user: NonNullable<Express.Request["user"]>, uid: string) {
  if (user.role === "mentor" && user.uid !== uid) throw forbidden("Mentors can only manage their own calendar");
}

/**
 * Splits availability windows into fixed-length slots. IDs are
 * `${mentorUid}_${startMillis}`, so re-sending the same availability creates no duplicates.
 */
export async function generateMentorSlots(
  eventId: string,
  mentorUid: string,
  windows: { startAt: Date; endAt: Date }[],
  slotMinutes = 15,
  track?: string,
) {
  const step = slotMinutes * 60_000;
  const writer = db.bulkWriter();
  writer.onWriteError((e) => e.code !== 6 && e.failedAttempts < 3);
  let created = 0;
  for (const w of windows) {
    for (let t = w.startAt.getTime(); t + step <= w.endAt.getTime(); t += step) {
      writer
        .create(col(eventId, "mentorSlots").doc(`${mentorUid}_${t}`), {
          mentorUid,
          startAt: Timestamp.fromMillis(t),
          endAt: Timestamp.fromMillis(t + step),
          track,
          status: "open",
        })
        .then(() => created++)
        .catch(() => {});
    }
  }
  await writer.close();
  return created;
}

mentorsRouter.get("/mentors", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const [mentors, slots] = await Promise.all([
    db.collection(COL.users).where("eventId", "==", eventId).where("role", "==", "mentor").get(),
    col(eventId, "mentorSlots").select("mentorUid", "status").get(),
  ]);
  res.json({
    items: mentors.docs.map((m) => {
      const mine = slots.docs.filter((s) => s.get("mentorUid") === m.id);
      return {
        uid: m.id,
        name: m.get("name"),
        tracks: m.get("mentorTracks") ?? [],
        slots: mine.length,
        booked: mine.filter((s) => s.get("status") === "booked").length,
      };
    }),
  });
});

mentorsRouter.put("/mentors/:uid/tracks", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { tracks } = parseBody(req, MentorTracksBody);
  const event = await getEvent(eventId);
  const unknown = tracks.filter((t) => !event.tracks.includes(t));
  if (unknown.length) throw badRequest(`Unknown tracks: ${unknown.join(", ")}`);
  const mentor = await loadMentor(eventId, param(req, "uid"));
  await mentor.ref.update({ mentorTracks: tracks });
  await writeAudit({ eventId, actor: req.user!.uid, action: "mentor.tracks", target: mentor.id, before: mentor.get("mentorTracks") ?? [], after: tracks });
  res.json({ uid: mentor.id, tracks });
});

mentorsRouter.post("/mentors/:uid/availability", requireRole("organizer", "mentor"), async (req, res) => {
  const eventId = eventIdOf(req);
  const uid = param(req, "uid");
  assertSelfOrOrganizer(req.user!, uid);
  const body = parseBody(req, MentorAvailabilityBody);
  const mentor = await loadMentor(eventId, uid);
  const tracks = (mentor.get("mentorTracks") as string[] | undefined) ?? [];
  const created = await generateMentorSlots(
    eventId,
    uid,
    body.windows.map((w) => ({ startAt: new Date(w.startAt), endAt: new Date(w.endAt) })),
    body.slotMinutes,
    tracks.length === 1 ? tracks[0] : undefined,
  );
  await writeAudit({ eventId, actor: req.user!.uid, action: "mentor.availability", target: uid, after: { windows: body.windows, created } });
  res.status(201).json({ created });
});

/** A mentor's calendar (mentors see only their own). */
mentorsRouter.get("/mentor-slots", requireRole("organizer", "mentor"), async (req, res) => {
  const eventId = eventIdOf(req);
  const q = parseQuery(req, z.object({ mentorUid: z.string().optional(), status: z.string().optional() }));
  const mentorUid = req.user!.role === "mentor" ? req.user!.uid : q.mentorUid;
  let query: FirebaseFirestore.Query = col(eventId, "mentorSlots");
  if (mentorUid) query = query.where("mentorUid", "==", mentorUid);
  if (q.status) query = query.where("status", "==", q.status);
  const snap = await query.get();
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as { id: string; startAt: Timestamp })
    .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
  res.json({ items });
});

mentorsRouter.patch("/mentor-slots/:id/notes", requireRole("organizer", "mentor"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { notes } = parseBody(req, MentorNoteBody);
  const ref = col(eventId, "mentorSlots").doc(param(req, "id"));
  const slot = await ref.get();
  if (!slot.exists) throw notFound("Mentor slot");
  assertSelfOrOrganizer(req.user!, slot.get("mentorUid"));
  await ref.update({ notes });
  res.json({ ok: true });
});

/** Team progress feed for mentors (participants post updates in Phase 2). */
mentorsRouter.get("/teams/:teamId/progress", requireRole("organizer", "mentor"), async (req, res) => {
  const eventId = eventIdOf(req);
  const teamId = param(req, "teamId");
  const [progress, notes] = await Promise.all([
    col(eventId, "progress").where("teamId", "==", teamId).orderBy("createdAt", "desc").limit(50).get(),
    col(eventId, "mentorSlots").where("teamId", "==", teamId).get(),
  ]);
  res.json({
    progress: progress.docs.map((d) => ({ id: d.id, ...d.data() })),
    mentorNotes: notes.docs.filter((d) => d.get("notes")).map((d) => ({ slotId: d.id, mentorUid: d.get("mentorUid"), startAt: d.get("startAt"), notes: d.get("notes") })),
  });
});
