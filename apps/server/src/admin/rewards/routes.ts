import { Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  ComplaintRespondBody,
  ComplaintStatus,
  RatingResponseBody,
  REWARD_TRANSITIONS,
  RewardBody,
  RewardProofBody,
  RewardStatusBody,
  UploadSignatureBody,
} from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { isOurCloudinaryUrl, signUpload } from "../../core/cloudinary.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, conflict, isoToTs, notFound } from "../../core/http.js";
import { enqueue, enqueueMany } from "../../core/outbox.js";
import { parseBody, parseQuery } from "../../core/validate.js";

// RewardLink, complaints and ratings, admin side (plan D26).
// Mounted under /api/admin/events/:eventId.

export const rewardsRouter = Router({ mergeParams: true });

async function teamMembers(eventId: string, teamId?: string) {
  if (!teamId) return [];
  const t = await col(eventId, "teams").doc(teamId).get();
  return (t.get("memberUids") as string[] | undefined) ?? [];
}

// ---------- rewards ----------

rewardsRouter.get("/rewards", requireRole("organizer"), async (req, res) => {
  const snap = await col(eventIdOf(req), "rewards").orderBy("dueAt").get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

rewardsRouter.post("/rewards", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, RewardBody);
  if (body.winnerTeamId && !(await col(eventId, "teams").doc(body.winnerTeamId).get()).exists) throw badRequest("Unknown team");
  const ref = col(eventId, "rewards").doc();
  const doc = { ...body, dueAt: isoToTs(body.dueAt), status: "announced", history: [] };
  const batch = db.batch();
  batch.create(ref, doc);
  await writeAudit({ eventId, actor: req.user!.uid, action: "reward.create", target: ref.id, after: body }, batch);
  await batch.commit();
  res.status(201).json({ id: ref.id, ...doc });
});

rewardsRouter.patch("/rewards/:id", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, RewardBody.partial());
  const ref = col(eventId, "rewards").doc(param(req, "id"));
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) throw notFound("Reward");
    const update: Record<string, unknown> = { ...body };
    if (body.dueAt) {
      update.dueAt = isoToTs(body.dueAt);
      // A new due date in the future clears the overdue flag.
      if (isoToTs(body.dueAt).toMillis() > Date.now()) update.overdue = false;
    }
    tx.update(ref, update);
    await writeAudit({ eventId, actor: req.user!.uid, action: "reward.update", target: ref.id, before: r.data(), after: body }, tx);
  });
  res.json({ ok: true });
});

/** Announced → Verified → Processing → Delivered, with Disputed reachable from any of them. */
rewardsRouter.post("/rewards/:id/status", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { status, note } = parseBody(req, RewardStatusBody);
  const ref = col(eventId, "rewards").doc(param(req, "id"));
  const reward = await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) throw notFound("Reward");
    const from = r.get("status") as string;
    if (!REWARD_TRANSITIONS[from]?.includes(status)) throw conflict(`Can't go from ${from} to ${status}`);
    if (status === "delivered" && !r.get("proofUrl")) throw conflict("Upload proof of delivery first");
    const update: Record<string, unknown> = {
      status,
      history: FieldValue.arrayUnion({ at: Timestamp.now(), by: req.user!.uid, status, note: note ?? null }),
    };
    if (status === "delivered") update.overdue = false;
    tx.update(ref, update);
    await writeAudit({ eventId, actor: req.user!.uid, action: "reward.status", target: ref.id, before: { status: from }, after: { status }, reason: note }, tx);
    return r.data()!;
  });
  const members = await teamMembers(eventId, reward.winnerTeamId);
  await enqueueMany(
    members.map((uid) => ({
      channel: "whatsapp" as const,
      uid,
      template: "reward_status",
      vars: { prize: reward.prize, status },
      dedupeKey: `reward_${ref.id}_${status}`,
      eventId,
    })),
  );
  res.json({ status });
});

/** Signed parameters for a direct browser upload to Cloudinary. */
rewardsRouter.post("/uploads/sign", requireRole("organizer"), async (req, res) => {
  const { folder } = parseBody(req, UploadSignatureBody);
  res.json(signUpload(folder, eventIdOf(req)));
});

rewardsRouter.post("/rewards/:id/proof", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { proofUrl } = parseBody(req, RewardProofBody);
  if (!isOurCloudinaryUrl(proofUrl)) throw badRequest("Proof must be uploaded through HACKOS");
  const ref = col(eventId, "rewards").doc(param(req, "id"));
  if (!(await ref.get()).exists) throw notFound("Reward");
  await ref.update({ proofUrl });
  await writeAudit({ eventId, actor: req.user!.uid, action: "reward.proof", target: ref.id, after: { proofUrl } });
  res.json({ ok: true });
});

// ---------- complaints ----------

rewardsRouter.get("/complaints", requireRole("organizer"), async (req, res) => {
  const { status } = parseQuery(req, z.object({ status: ComplaintStatus.optional() }));
  let q: FirebaseFirestore.Query = col(eventIdOf(req), "complaints");
  if (status) q = q.where("status", "==", status);
  const snap = await q.get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

rewardsRouter.post("/complaints/:id/respond", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { note, status = "responded" } = parseBody(req, ComplaintRespondBody);
  const ref = col(eventId, "complaints").doc(param(req, "id"));
  const uid = await db.runTransaction(async (tx) => {
    const c = await tx.get(ref);
    if (!c.exists) throw notFound("Complaint");
    if (c.get("status") === "resolved") throw conflict("Complaint is already resolved");
    tx.update(ref, { status, history: FieldValue.arrayUnion({ at: Timestamp.now(), by: req.user!.uid, note }) });
    await writeAudit({ eventId, actor: req.user!.uid, action: "complaint.respond", target: ref.id, before: { status: c.get("status") }, after: { status }, reason: note }, tx);
    return c.get("uid") as string;
  });
  await enqueue({ channel: "whatsapp", uid, template: "complaint_response", vars: { note }, dedupeKey: `complaint_${ref.id}_${Date.now()}`, eventId });
  res.json({ status });
});

// ---------- ratings ----------

const CATEGORIES = ["organization", "mentors", "judging", "comms", "infra", "rewards"] as const;

rewardsRouter.get("/ratings", requireRole("organizer"), async (req, res) => {
  const snap = await col(eventIdOf(req), "ratings").get();
  const items = snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as { uid: string; scores?: Record<string, number> });
  const averages = Object.fromEntries(
    CATEGORIES.map((c) => {
      const xs = items.map((i) => i.scores?.[c]).filter((x): x is number => typeof x === "number");
      return [c, xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null];
    }),
  );
  res.json({ count: items.length, averages, items });
});

rewardsRouter.post("/ratings/:uid/response", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { response } = parseBody(req, RatingResponseBody);
  const ref = col(eventId, "ratings").doc(param(req, "uid"));
  if (!(await ref.get()).exists) throw notFound("Rating");
  await ref.update({ response, respondedBy: req.user!.uid });
  await writeAudit({ eventId, actor: req.user!.uid, action: "rating.respond", target: ref.id, after: { response } });
  res.json({ ok: true });
});
