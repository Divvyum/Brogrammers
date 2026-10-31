import { Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  FoodScanBody,
  MealsBody,
  TaskBody,
  TaskUpdateBody,
  TicketAssignBody,
  TicketResolveBody,
  TicketStatus,
} from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col, eventRef, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { verifyFoodPass } from "../../core/foodpass.js";
import { badRequest, conflict, forbidden, HttpError, isoToTs, notFound } from "../../core/http.js";
import { enqueue } from "../../core/outbox.js";
import { stats } from "../../core/stats.js";
import { parseBody, parseQuery } from "../../core/validate.js";

// Volunteer operations (plan D21): tasks, help-desk tickets, food counter.
// Mounted under /api/admin/events/:eventId.

export const opsRouter = Router({ mergeParams: true });

// ---------- tasks ----------

opsRouter.get("/tasks", requireRole("organizer", "volunteer"), async (req, res) => {
  let q: FirebaseFirestore.Query = col(eventIdOf(req), "tasks");
  if (req.user!.role === "volunteer") q = q.where("assignedTo", "==", req.user!.uid);
  const snap = await q.get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

opsRouter.post("/tasks", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, TaskBody);
  const ref = col(eventId, "tasks").doc();
  const doc = { ...body, dueAt: body.dueAt ? isoToTs(body.dueAt) : undefined, status: "todo" };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "task.create", target: ref.id, after: body }, batch);
  await batch.commit();
  res.status(201).json({ id: ref.id, ...doc });
});

opsRouter.patch("/tasks/:id", requireRole("organizer", "volunteer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, TaskUpdateBody);
  const ref = col(eventId, "tasks").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw notFound("Task");
    if (req.user!.role === "volunteer") {
      if (t.get("assignedTo") !== req.user!.uid) throw forbidden("Not your task");
      if (body.assignedTo !== undefined) throw forbidden("Volunteers can't reassign tasks");
    }
    tx.update(ref, body);
    await writeAudit({ eventId, actor: req.user!.uid, action: "task.update", target: ref.id, before: { status: t.get("status"), assignedTo: t.get("assignedTo") ?? null }, after: body }, tx);
  });
  res.json({ ok: true });
});

/** Cron (every minute): one reminder per task due within the next 30 minutes. */
export async function remindDueTasks(eventId: string, now = Date.now()) {
  const soon = await col(eventId, "tasks")
    .where("dueAt", ">=", Timestamp.fromMillis(now))
    .where("dueAt", "<=", Timestamp.fromMillis(now + 30 * 60_000))
    .get();
  let sent = 0;
  for (const t of soon.docs) {
    if (t.get("status") === "done" || t.get("remindedAt") || !t.get("assignedTo")) continue;
    await enqueue({
      channel: "whatsapp",
      uid: t.get("assignedTo"),
      template: "task_reminder",
      vars: { title: t.get("title"), dueAt: (t.get("dueAt") as Timestamp).toDate().toISOString() },
      dedupeKey: `task_reminder_${t.id}`,
      eventId,
    });
    await t.ref.update({ remindedAt: FieldValue.serverTimestamp() });
    sent++;
  }
  return sent;
}

// ---------- help-desk tickets ----------

opsRouter.get("/tickets", requireRole("organizer", "volunteer"), async (req, res) => {
  const { status } = parseQuery(req, z.object({ status: TicketStatus.optional() }));
  let q: FirebaseFirestore.Query = col(eventIdOf(req), "tickets");
  if (status) q = q.where("status", "==", status);
  const snap = await q.get();
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as { id: string; createdAt?: Timestamp })
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  res.json({ items });
});

/** Organizers assign anyone; a volunteer can only claim a ticket for themselves. */
opsRouter.post("/tickets/:id/assign", requireRole("organizer", "volunteer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { assignedTo } = parseBody(req, TicketAssignBody);
  if (req.user!.role === "volunteer" && assignedTo !== req.user!.uid) throw forbidden("Volunteers can only claim tickets for themselves");
  const ref = col(eventId, "tickets").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw notFound("Ticket");
    if (t.get("status") === "resolved") throw conflict("Ticket is already resolved");
    if (req.user!.role === "volunteer" && t.get("assignedTo") && t.get("assignedTo") !== req.user!.uid) {
      throw conflict("Someone else already claimed this ticket");
    }
    tx.update(ref, { assignedTo, status: "assigned" });
    await writeAudit({ eventId, actor: req.user!.uid, action: "ticket.assign", target: ref.id, after: { assignedTo } }, tx);
  });
  stats.recomputeSoon(eventId);
  res.json({ ok: true });
});

opsRouter.post("/tickets/:id/resolve", requireRole("organizer", "volunteer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { resolution } = parseBody(req, TicketResolveBody);
  const ref = col(eventId, "tickets").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw notFound("Ticket");
    if (t.get("status") === "resolved") throw conflict("Ticket is already resolved");
    if (req.user!.role === "volunteer" && t.get("assignedTo") !== req.user!.uid) throw forbidden("Claim the ticket first");
    tx.update(ref, { status: "resolved", resolution, resolvedAt: FieldValue.serverTimestamp() });
    await writeAudit({ eventId, actor: req.user!.uid, action: "ticket.resolve", target: ref.id, after: { resolution } }, tx);
  });
  stats.recomputeSoon(eventId);
  res.json({ ok: true });
});

// ---------- food and swag ----------

opsRouter.get("/food/config", requireRole("organizer", "volunteer"), async (req, res) => {
  const event = await getEvent(eventIdOf(req));
  res.json({ meals: event.meals ?? [], counters: event.counters ?? [] });
});

opsRouter.put("/food/config", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, MealsBody);
  if (new Set(body.meals.map((m) => m.id)).size !== body.meals.length) throw badRequest("Meal IDs must be unique");
  const meals = body.meals.map((m) => ({ ...m, startAt: isoToTs(m.startAt), endAt: isoToTs(m.endAt) }));
  await eventRef(eventId).update({ meals, counters: body.counters });
  await writeAudit({ eventId, actor: req.user!.uid, action: "food.config", target: eventId, after: body });
  res.json({ meals, counters: body.counters });
});

/** Grace around each meal window, so a slightly early or late scan still works. */
const MEAL_GRACE_MS = 30 * 60_000;

/**
 * Counter scan. The claim document's ID is `${uid}_${mealId}` and is created,
 * never overwritten, so the same pass for the same meal is accepted only once.
 */
opsRouter.post("/food/scan", requireRole("volunteer", "organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, FoodScanBody);
  const { uid } = verifyFoodPass(body.token, eventId);
  const event = await getEvent(eventId);

  const meal = (event.meals as { id: string; name: string; startAt: Timestamp; endAt: Timestamp }[] | undefined)?.find((m) => m.id === body.mealId);
  if (!meal) throw badRequest(`Unknown meal "${body.mealId}"`);
  const now = Date.now();
  if (now < meal.startAt.toMillis() - MEAL_GRACE_MS || now > meal.endAt.toMillis() + MEAL_GRACE_MS) {
    throw new HttpError(409, "MEAL_NOT_ACTIVE", `${meal.name} isn't being served now`);
  }

  const p = await col(eventId, "participants").doc(uid).get();
  if (!p.exists || p.get("mergedInto") || p.get("withdrawnAt")) throw notFound("Participant");

  const ref = col(eventId, "food").doc(`${uid}_${body.mealId}`);
  try {
    await ref.create({ uid, mealId: body.mealId, claimedAt: FieldValue.serverTimestamp(), counter: body.counter, volunteerUid: req.user!.uid });
  } catch (err) {
    if ((err as { code?: number }).code !== 6) throw err;
    const prev = await ref.get();
    throw new HttpError(409, "ALREADY_CLAIMED", `${p.get("name")} already collected ${meal.name}`, {
      claimedAt: prev.get("claimedAt")?.toDate().toISOString(),
      counter: prev.get("counter"),
    });
  }
  res.json({ ok: true, name: p.get("name"), meal: meal.name });
});

opsRouter.get("/food/stats", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const event = await getEvent(eventId);
  const meals = (event.meals as { id: string; name: string }[] | undefined) ?? [];
  const counts = await Promise.all(
    meals.map(async (m) => ({
      mealId: m.id,
      name: m.name,
      claimed: (await col(eventId, "food").where("mealId", "==", m.id).count().get()).data().count,
    })),
  );
  res.json({ items: counts });
});
