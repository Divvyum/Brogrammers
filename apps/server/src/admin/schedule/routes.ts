import { Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AudienceBody, ScheduleBody, type Audience } from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { resolveAudience } from "../../core/audience.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { isoToTs, notFound } from "../../core/http.js";
import { enqueueMany } from "../../core/outbox.js";
import { parseBody } from "../../core/validate.js";

// Schedule (plan D16). Every create, change or delete notifies only the people
// in the old and new audience.

export const scheduleRouter = Router({ mergeParams: true });

const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatWhen = (ts: Timestamp) => fmt.format(ts.toDate());

async function notify(
  eventId: string,
  audiences: Audience[],
  template: "schedule_changed" | "schedule_cancelled",
  item: { id: string; title: string; startAt?: Timestamp; location?: string },
  version: string,
) {
  const uids = new Set<string>();
  for (const a of audiences) for (const uid of await resolveAudience(eventId, a)) uids.add(uid);
  const vars = {
    title: item.title,
    when: item.startAt ? formatWhen(item.startAt) : "",
    location: item.location ? `, ${item.location}` : "",
  };
  return enqueueMany(
    [...uids].map((uid) => ({
      channel: "whatsapp" as const,
      uid,
      template,
      vars,
      // A new key per change, so every change is announced once.
      dedupeKey: `schedule_${item.id}_${version}`,
      eventId,
    })),
  );
}

scheduleRouter.get("/schedule", requireRole("organizer", "volunteer", "mentor", "judge"), async (req, res) => {
  const snap = await col(eventIdOf(req), "schedule").orderBy("startAt").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

/** Who a change would reach, for the "who will be notified" preview (A15). */
scheduleRouter.post("/schedule/preview-audience", requireRole("organizer"), async (req, res) => {
  const { audience } = parseBody(req, z.object({ audience: AudienceBody }));
  res.json({ count: (await resolveAudience(eventIdOf(req), audience)).length });
});

scheduleRouter.post("/schedule", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ScheduleBody);
  const ref = col(eventId, "schedule").doc();
  const doc = { ...body, startAt: isoToTs(body.startAt), endAt: isoToTs(body.endAt), updatedAt: FieldValue.serverTimestamp() };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "schedule.create", target: ref.id, after: body }, batch);
  await batch.commit();
  const notified = await notify(eventId, [body.audience], "schedule_changed", { id: ref.id, ...doc }, "created");
  res.status(201).json({ id: ref.id, notified });
});

scheduleRouter.patch("/schedule/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ScheduleBody);
  const ref = col(eventId, "schedule").doc(param(req, "id"));
  const before = await ref.get();
  if (!before.exists) throw notFound("Schedule item");

  const doc = { ...body, startAt: isoToTs(body.startAt), endAt: isoToTs(body.endAt), updatedAt: FieldValue.serverTimestamp() };
  const batch = db.batch();
  batch.update(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "schedule.update", target: ref.id, before: before.data(), after: body }, batch);
  await batch.commit();
  const notified = await notify(
    eventId,
    [before.get("audience"), body.audience],
    "schedule_changed",
    { id: ref.id, ...doc },
    String(Date.now()),
  );
  res.json({ id: ref.id, notified });
});

scheduleRouter.delete("/schedule/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const ref = col(eventId, "schedule").doc(param(req, "id"));
  const before = await ref.get();
  if (!before.exists) throw notFound("Schedule item");
  const batch = db.batch();
  batch.delete(ref);
  await writeAudit({ eventId, actor: req.user!.uid, action: "schedule.delete", target: ref.id, before: before.data() }, batch);
  await batch.commit();
  const notified = await notify(eventId, [before.get("audience")], "schedule_cancelled", { id: ref.id, title: before.get("title") }, "deleted");
  res.json({ ok: true, notified });
});
