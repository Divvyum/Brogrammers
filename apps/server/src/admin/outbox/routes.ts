import { Router } from "express";
import { COL, DOC, OutboxQuery, TemplateBody } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { DEFAULT_TEMPLATES, ensureDefaultTemplates } from "../../core/templates.js";
import { parseBody, parseQuery } from "../../core/validate.js";

// Outbox, admin side (plan D19). Messages wait here until Manthan's worker sends
// them in Phase 2; this is the WhatsApp dashboard's API.

/** Per event: /api/admin/events/:eventId/outbox/... */
export const outboxRouter = Router({ mergeParams: true });
/** Global: /api/admin/templates/... */
export const templatesRouter = Router();

const outboxOf = (eventId: string) => db.collection(COL.outbox).where("eventId", "==", eventId);

outboxRouter.get("/outbox/status", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const count = async (status: string) =>
    (await outboxOf(eventId).where("status", "==", status).count().get()).data().count;
  const [wa, queued, sending, sent, failed] = await Promise.all([
    db.doc(DOC.waStatus).get(),
    count("queued"),
    count("sending"),
    count("sent"),
    count("failed"),
  ]);
  res.json({
    // Until the worker runs (Phase 2) there is no status document.
    connection: wa.exists ? wa.data() : { state: "disconnected", waitingForWorker: true },
    counts: { queued, sending, sent, failed },
  });
});

/** Message history, newest first, with optional filters. */
outboxRouter.get("/outbox/messages", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const q = parseQuery(req, OutboxQuery);
  let query = outboxOf(eventId);
  if (q.status) query = query.where("status", "==", q.status);
  if (q.template) query = query.where("template", "==", q.template);
  if (q.uid) query = query.where("to.uid", "==", q.uid);
  query = query.orderBy("createdAt", "desc");
  if (q.after) {
    const cursor = await db.collection(COL.outbox).doc(q.after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  const snap = await query.limit(q.limit + 1).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hasMore = items.length > q.limit;
  const pageItems = hasMore ? items.slice(0, q.limit) : items;
  res.json({ items: pageItems, next: hasMore ? pageItems[pageItems.length - 1]!.id : null });
});

/** Puts a failed message back in the queue. */
outboxRouter.post("/outbox/:id/retry", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const ref = db.collection(COL.outbox).doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const m = await tx.get(ref);
    if (!m.exists || m.get("eventId") !== eventId) throw notFound("Message");
    if (m.get("status") !== "failed") throw conflict(`Only failed messages can be retried (this one is ${m.get("status")})`);
    tx.update(ref, { status: "queued", attempts: 0, lastError: null, lockedBy: null, lockedAt: null });
    await writeAudit({ eventId, actor: req.user!.uid, action: "outbox.retry", target: ref.id, before: { lastError: m.get("lastError") ?? null } }, tx);
  });
  res.json({ ok: true });
});

// ---------- templates ----------

templatesRouter.get("/", requireRole("organizer"), async (_req, res) => {
  const snap = await db.collection(COL.templates).get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data(), isDefault: d.get("body") === DEFAULT_TEMPLATES[d.id]?.body })) });
});

templatesRouter.post("/defaults", requireRole("organizer"), async (_req, res) => {
  res.json({ created: await ensureDefaultTemplates() });
});

templatesRouter.put("/:id", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, TemplateBody);
  const id = param(req, "id");
  const ref = db.collection(COL.templates).doc(id);
  const before = await ref.get();
  await ref.set({ ...body, updatedAt: new Date() });
  const eventId = req.user!.eventId === "*" ? "_global" : req.user!.eventId;
  await writeAudit({ eventId, actor: req.user!.uid, action: "template.update", target: id, before: before.data() ?? null, after: body });
  res.json({ id, ...body });
});
