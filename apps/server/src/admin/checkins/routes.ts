import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { CheckinListQuery, ResolveCheckinBody } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { col, page } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { processPending } from "./processor.js";

// Check-in monitor and resolution (plan D14, A14).
// Mounted under /api/admin/events/:eventId.

export const checkinsRouter = Router({ mergeParams: true });

checkinsRouter.get("/checkins", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const q = parseQuery(req, CheckinListQuery);
  let query: FirebaseFirestore.Query = col(eventId, "checkins");
  if (q.filter === "valid") query = query.where("serverResult", "==", "official");
  if (q.filter === "flagged") query = query.where("flagged", "==", true);
  if (q.filter === "rejected") query = query.where("serverResult", "==", "rejected");
  if (q.filter === "manual") query = query.where("method", "in", ["manual", "code"]);
  if (q.filter === "broken") query = query.where("chain", "==", "broken");
  query = query.orderBy("ts", "desc");
  if (q.after) {
    const cursor = await col(eventId, "checkins").doc(q.after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  const snap = await query.limit(q.limit + 1).get();
  res.json(page(snap.docs.map((d) => ({ id: d.id, ...d.data() })), q.limit));
});

checkinsRouter.post("/checkins/:id/resolve", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ResolveCheckinBody);
  const ref = col(eventId, "checkins").doc(param(req, "id"));

  await db.runTransaction(async (tx) => {
    const c = await tx.get(ref);
    if (!c.exists) throw notFound("Check-in");
    if (!c.get("processed")) throw conflict("Not processed yet");
    const resolution = { action: body.action, by: req.user!.uid, reason: body.reason };

    if (body.action === "dismissed") {
      tx.update(ref, { flagged: false, resolution });
    } else {
      const pRef = col(eventId, "participants").doc(c.get("participantId"));
      const p = await tx.get(pRef);
      if (!p.exists) throw notFound("Participant");
      const previous = p.get("checkinId") as string | undefined;
      tx.update(pRef, { checkedInAt: Timestamp.fromDate(new Date(c.get("ts"))), checkinId: c.id });
      if (previous && previous !== c.id) {
        tx.update(col(eventId, "checkins").doc(previous), { flagged: true, serverResult: "duplicate" });
      }
      tx.update(ref, { flagged: false, serverResult: "official", resolution });
    }
    await writeAudit(
      {
        eventId,
        actor: req.user!.uid,
        action: `checkin.${body.action}`,
        target: c.id,
        before: { flagged: c.get("flagged"), serverResult: c.get("serverResult") ?? null },
        reason: body.reason,
      },
      tx,
    );
  });
  res.json({ ok: true });
});

/** Process pending check-ins now instead of waiting for the listener. */
checkinsRouter.post("/checkins/process", requireRole("organizer"), async (_req, res) => {
  res.json(await processPending());
});
