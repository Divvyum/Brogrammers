import { Router } from "express";
import { AuditQuery } from "@hackos/shared";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { col, page } from "../../core/events.js";
import { isoToTs } from "../../core/http.js";
import { parseQuery } from "../../core/validate.js";

// Audit log viewer (plan A26). Mounted under /api/admin/events/:eventId.

export const auditRouter = Router({ mergeParams: true });

auditRouter.get("/audit", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const q = parseQuery(req, AuditQuery);
  let query: FirebaseFirestore.Query = col(eventId, "audit");
  if (q.actor) query = query.where("actor", "==", q.actor);
  if (q.action) query = query.where("action", "==", q.action);
  if (q.target) query = query.where("target", "==", q.target);
  if (q.from) query = query.where("ts", ">=", isoToTs(q.from));
  if (q.to) query = query.where("ts", "<=", isoToTs(q.to));
  query = query.orderBy("ts", "desc");
  if (q.after) {
    const cursor = await col(eventId, "audit").doc(q.after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  const snap = await query.limit(q.limit + 1).get();
  res.json(page(snap.docs.map((d) => ({ id: d.id, ...d.data() })), q.limit));
});
