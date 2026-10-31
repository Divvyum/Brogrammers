import { Router } from "express";
import { MoveParticipantBody, RoomBody, SlotBody } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, isoToTs, notFound } from "../../core/http.js";
import { stats } from "../../core/stats.js";
import { parseBody } from "../../core/validate.js";
import { moveParticipant, rebalanceDueSlots, runAllotment } from "./allotment.service.js";

// Arrival slots, rooms and allotment (plan D12).
// Mounted under /api/admin/events/:eventId.

export const allotmentRouter = Router({ mergeParams: true });

// ---------- slots ----------

allotmentRouter.get("/slots", requireRole("organizer", "volunteer"), async (req, res) => {
  const snap = await col(eventIdOf(req), "slots").orderBy("startAt").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

allotmentRouter.post("/slots", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, SlotBody);
  const ref = col(eventId, "slots").doc();
  const doc = { startAt: isoToTs(body.startAt), endAt: isoToTs(body.endAt), capacity: body.capacity, booked: 0 };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "slot.create", target: ref.id, after: body }, batch);
  await batch.commit();
  res.status(201).json({ id: ref.id, ...doc });
});

allotmentRouter.patch("/slots/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, SlotBody);
  const ref = col(eventId, "slots").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw notFound("Slot");
    if (body.capacity < s.get("booked")) throw conflict(`${s.get("booked")} people already booked this slot`);
    tx.update(ref, { startAt: isoToTs(body.startAt), endAt: isoToTs(body.endAt), capacity: body.capacity });
    await writeAudit({ eventId, actor: req.user!.uid, action: "slot.update", target: ref.id, before: s.data(), after: body }, tx);
  });
  res.json({ ok: true });
});

allotmentRouter.delete("/slots/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const ref = col(eventId, "slots").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw notFound("Slot");
    if (s.get("booked") > 0) throw conflict("Slot has bookings");
    tx.delete(ref);
    await writeAudit({ eventId, actor: req.user!.uid, action: "slot.delete", target: ref.id, before: s.data() }, tx);
  });
  res.json({ ok: true });
});

// ---------- rooms ----------

allotmentRouter.get("/rooms", requireRole("organizer", "volunteer", "mentor"), async (req, res) => {
  const snap = await col(eventIdOf(req), "rooms").orderBy("name").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

allotmentRouter.post("/rooms", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, RoomBody);
  const ref = col(eventId, "rooms").doc();
  const doc = { ...body, occupied: 0 };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "room.create", target: ref.id, after: body }, batch);
  await batch.commit();
  stats.recomputeSoon(eventId);
  res.status(201).json({ id: ref.id, ...doc });
});

allotmentRouter.patch("/rooms/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, RoomBody);
  const ref = col(eventId, "rooms").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) throw notFound("Room");
    if (body.capacity < r.get("occupied")) throw conflict(`${r.get("occupied")} seats are already assigned`);
    tx.update(ref, body);
    await writeAudit({ eventId, actor: req.user!.uid, action: "room.update", target: ref.id, before: r.data(), after: body }, tx);
  });
  stats.recomputeSoon(eventId);
  res.json({ ok: true });
});

allotmentRouter.delete("/rooms/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const ref = col(eventId, "rooms").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) throw notFound("Room");
    if (r.get("occupied") > 0) throw conflict("Room has assigned seats");
    tx.delete(ref);
    await writeAudit({ eventId, actor: req.user!.uid, action: "room.delete", target: ref.id, before: r.data() }, tx);
  });
  stats.recomputeSoon(eventId);
  res.json({ ok: true });
});

// ---------- allotment ----------

allotmentRouter.post("/allotment/run", requireRole("organizer"), async (req, res) => {
  res.json(await runAllotment(eventIdOf(req), req.user!.uid));
});

allotmentRouter.post("/allotment/rebalance", requireRole("organizer"), async (req, res) => {
  res.json(await rebalanceDueSlots(eventIdOf(req)));
});

allotmentRouter.post("/participants/:uid/move", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, MoveParticipantBody);
  res.json(await moveParticipant(eventIdOf(req), param(req, "uid"), body.roomId, req.user!.uid, body.reason));
});
