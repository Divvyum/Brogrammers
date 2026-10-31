import { Router } from "express";
import { FieldPath } from "firebase-admin/firestore";
import {
  COL,
  DuplicateActionBody,
  DuplicateStatus,
  EligibilityOverrideBody,
  EligibilityRunBody,
  ImportBody,
  ParticipantListQuery,
} from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, requireRole, param } from "../../core/auth.js";
import { decrypt, mask } from "../../core/crypto.js";
import { col, page } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { notFound } from "../../core/http.js";
import { stats } from "../../core/stats.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { overrideEligibility, runEligibility } from "../eligibility/engine.js";
import { detectDuplicates, dismissDuplicate, mergeDuplicate } from "./duplicates.js";
import { importRegistrations } from "./import.js";

// Registrations, duplicates and eligibility (plan D8, D9).
// Mounted under /api/admin/events/:eventId.

export const registrationsRouter = Router({ mergeParams: true });

registrationsRouter.get("/participants", requireRole("organizer", "volunteer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const q = parseQuery(req, ParticipantListQuery);
  let query = col(eventId, "participants").orderBy(FieldPath.documentId());
  if (q.status) query = query.where("status", "==", q.status);
  if (q.college) query = query.where("college", "==", q.college);
  if (q.track) query = query.where("track", "==", q.track);
  if (q.teamId) query = query.where("teamId", "==", q.teamId);
  if (q.after) query = query.startAfter(q.after);
  const snap = await query.limit(q.limit + 1).get();
  res.json(page(snap.docs.map((d) => ({ id: d.id, ...d.data() })), q.limit));
});

registrationsRouter.get("/participants/:uid", requireRole("organizer", "volunteer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const uid = param(req, "uid");
  const [p, u] = await Promise.all([
    col(eventId, "participants").doc(uid).get(),
    db.collection(COL.users).doc(uid).get(),
  ]);
  if (!p.exists) throw notFound("Participant");

  // Volunteers only ever see masked contact details (plan D29).
  const show = (enc?: string) => {
    if (!enc) return null;
    const plain = decrypt(enc);
    return req.user!.role === "volunteer" ? mask(plain) : plain;
  };
  const { emailEnc, phoneEnc, emailHash: _e, phoneHash: _p, pinKey: _k, ...profile } = u.data() ?? {};

  const audit =
    req.user!.role === "volunteer"
      ? []
      : (
          await col(eventId, "audit").where("target", "==", uid).orderBy("ts", "desc").limit(50).get()
        ).docs.map((d) => ({ id: d.id, ...d.data() }));

  res.json({
    id: uid,
    ...p.data(),
    profile: { ...profile, email: show(emailEnc), phone: show(phoneEnc) },
    audit,
  });
});

registrationsRouter.post("/registrations/import", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { csv } = parseBody(req, ImportBody);
  const result = await importRegistrations(eventId, csv);
  const duplicatesFound = result.created ? await detectDuplicates(eventId) : 0;
  await writeAudit({
    eventId,
    actor: req.user!.uid,
    action: "registrations.import",
    target: eventId,
    after: { created: result.created, teams: result.teamsCreated, errors: result.errors.length },
  });
  stats.recomputeSoon(eventId);
  res.json({ ...result, duplicatesFound });
});

// ---------- duplicates ----------

registrationsRouter.post("/duplicates/detect", requireRole("organizer"), async (req, res) => {
  res.json({ created: await detectDuplicates(eventIdOf(req)) });
});

registrationsRouter.get("/duplicates", requireRole("organizer"), async (req, res) => {
  const { status } = parseQuery(req, z.object({ status: DuplicateStatus.default("open") }));
  const snap = await col(eventIdOf(req), "duplicates").where("status", "==", status).get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

registrationsRouter.post("/duplicates/:id/merge", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { reason } = parseBody(req, DuplicateActionBody);
  const result = await mergeDuplicate(eventId, param(req, "id"), req.user!.uid, reason);
  stats.recomputeSoon(eventId);
  res.json(result);
});

registrationsRouter.post("/duplicates/:id/dismiss", requireRole("organizer"), async (req, res) => {
  const { reason } = parseBody(req, DuplicateActionBody);
  await dismissDuplicate(eventIdOf(req), param(req, "id"), req.user!.uid, reason);
  res.json({ ok: true });
});

// ---------- eligibility ----------

registrationsRouter.post("/eligibility/run", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { uid } = parseBody(req, EligibilityRunBody);
  const summary = await runEligibility(eventId, uid);
  await writeAudit({ eventId, actor: req.user!.uid, action: "eligibility.run", target: uid ?? eventId, after: summary });
  res.json(summary);
});

registrationsRouter.post("/participants/:uid/eligibility", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, EligibilityOverrideBody);
  await overrideEligibility(eventIdOf(req), param(req, "uid"), body, req.user!.uid);
  res.json({ ok: true });
});
