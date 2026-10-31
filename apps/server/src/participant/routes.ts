import { randomBytes } from "node:crypto";
import { Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { allotOne } from "../admin/allotment/allotment.service.js";
import { completeEnrollment, enrollWithToken, reissueId } from "../admin/digital-id/credentials.js";
import { runEligibility } from "../admin/eligibility/engine.js";
import { accept, decline, onWithdraw } from "../admin/replacement/replacement.service.js";
import { respondToOffer } from "../admin/replacement/waitlist.js";
import { refreshGithub } from "../admin/submissions/routes.js";
import { detectDuplicates } from "../admin/registrations/duplicates.js";
import { isOurCloudinaryUrl, signUpload } from "../core/cloudinary.js";
import { encrypt, hashEmail, normalizeEmail } from "../core/crypto.js";
import { col, eventRef, getEvent } from "../core/events.js";
import { db } from "../core/firebase.js";
import { app } from "../core/firebase.js";
import { getMessaging } from "firebase-admin/messaging";
import { issueFoodPass } from "../core/foodpass.js";
import { conflict, forbidden, HttpError, notFound } from "../core/http.js";
import { enqueue } from "../core/outbox.js";
import { strictLimiter } from "../core/rateLimit.js";
import { parseBody } from "../core/validate.js";
import { OtpRequest, OtpVerify, requestOtp, verifyOtp } from "./auth.js";
import { requireParticipant } from "./middleware.js";
import { createTeam, joinTeam, leaveTeam } from "./team.js";

const body =
  <T extends z.ZodType>(schema: T) =>
  (req: Parameters<typeof parseBody>[0]) =>
    parseBody(req, schema);
const id = z.string().trim().min(1);
const url = z.url();
const iso = z.iso.datetime({ offset: true });
const participant = (eventId: string, uid: string) => col(eventId, "participants").doc(uid);
const mine = (req: Express.Request) => ({ eventId: req.user!.eventId, uid: req.user!.uid });
const data = (d: FirebaseFirestore.DocumentSnapshot) => ({ id: d.id, ...d.data() });

export const participantPublicRouter = Router();
participantPublicRouter.post("/auth/otp/request", strictLimiter, async (req, res) => {
  const b = body(OtpRequest)(req);
  res.status(202).json(await requestOtp(b.phone, b.eventId));
});
participantPublicRouter.post("/auth/otp/verify", strictLimiter, async (req, res) => {
  const b = body(OtpVerify)(req);
  res.json(await verifyOtp(b.phone, b.eventId, b.code));
});
participantPublicRouter.post("/enroll", strictLimiter, async (req, res) => {
  const b = body(z.object({ eventId: id, token: id, devicePubKey: id }))(req);
  res.json(await enrollWithToken(b.eventId, b.token, b.devicePubKey));
});

export const participantRouter = Router();
participantRouter.use(requireParticipant);

participantRouter.get("/me", async (req, res) => {
  const { eventId, uid } = mine(req);
  const [u, p] = await Promise.all([
    db.collection("users").doc(uid).get(),
    participant(eventId, uid).get(),
  ]);
  res.json({ uid, profile: u.data() ?? null, registration: p.data() ?? null });
});
participantRouter.get("/status", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  if (!p.exists) throw notFound("Registration");
  res.json({
    status: p.get("status"),
    eligibility: p.get("eligibility"),
    teamId: p.get("teamId"),
    slotId: p.get("slotId"),
    roomId: p.get("roomId"),
    seat: p.get("seat"),
    checkedInAt: p.get("checkedInAt"),
  });
});

// A signed-in participant may bind the current browser/device to their own ID.
// The private key never leaves the browser; only its public key is sent here.
participantRouter.post("/id/enroll", strictLimiter, async (req, res) => {
  const { eventId, uid } = mine(req);
  const { devicePubKey } = body(z.object({ devicePubKey: id }))(req);
  res.json(await completeEnrollment(eventId, uid, devicePubKey));
});

participantRouter.put("/registration", async (req, res) => {
  const b = body(
    z.object({
      name: z.string().trim().min(1),
      email: z.email(),
      college: z.string().trim().min(1),
      year: z.number().int().min(1).max(8),
      city: z.string().trim().min(1),
      skills: z.array(z.string().trim().min(1)).max(30),
      track: id,
      githubUsername: z.string().trim().optional(),
      photoUrl: url.optional(),
    }),
  )(req);
  const { eventId, uid } = mine(req);
  const email = normalizeEmail(b.email);
  const emailHash = hashEmail(email);
  await db.runTransaction(async (tx) => {
    const unique = db.collection("uniqueKeys").doc(`email_${emailHash}`);
    const results = await tx.getAll(unique, participant(eventId, uid));
    const key = results[0]!;
    const existing = results[1]!;
    if (key.exists && key.get("uid") !== uid) throw conflict("Email is already registered");
    const user = {
      name: b.name,
      emailHash,
      emailEnc: encrypt(email),
      college: b.college,
      year: b.year,
      city: b.city,
      skills: b.skills,
      githubUsername: b.githubUsername,
      photoUrl: b.photoUrl,
      role: "participant",
      eventId,
    };
    tx.set(db.collection("users").doc(uid), user, { merge: true });
    tx.set(unique, { uid, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      participant(eventId, uid),
      {
        name: b.name,
        college: b.college,
        track: b.track,
        status: existing.get("status") ?? "registered",
        registeredAt: existing.get("registeredAt") ?? FieldValue.serverTimestamp(),
        rosterVersion: existing.get("rosterVersion") ?? 0,
      },
      { merge: true },
    );
  });
  await runEligibility(eventId, uid);
  await detectDuplicates(eventId);
  await enqueue({
    channel: "whatsapp",
    uid,
    template: "registration_confirmed",
    vars: { name: b.name },
    dedupeKey: `registration_${eventId}`,
    eventId,
  });
  res.status(201).json({ registered: true });
});
participantRouter.post("/upload-signature", async (req, res) => {
  const { eventId } = mine(req);
  const { folder } = body(
    z.object({ folder: z.enum(["photos", "submissions", "complaint-evidence"]) }),
  )(req);
  res.json(signUpload(folder, eventId));
});

participantRouter.post("/teams", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(z.object({ name: id, track: id.optional() }))(req);
  res.status(201).json(await createTeam(eventId, uid, b.name, b.track));
});
participantRouter.post("/teams/join", async (req, res) => {
  const { eventId, uid } = mine(req);
  res.json(await joinTeam(eventId, uid, body(z.object({ inviteCode: id }))(req).inviteCode));
});
participantRouter.post("/teams/leave", async (req, res) => {
  const { eventId, uid } = mine(req);
  await leaveTeam(eventId, uid);
  res.status(204).end();
});
participantRouter.post("/teams/withdraw", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const teamId = p.get("teamId");
  if (!teamId) throw conflict("Not in a team");
  res.json({
    replacementId: await onWithdraw(
      eventId,
      teamId,
      uid,
      uid,
      body(z.object({ reason: z.string().min(3) }))(req).reason,
    ),
  });
});
participantRouter.post("/team-requests", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(
    z.object({
      type: z.enum(["join", "leave", "replace"]),
      teamId: id,
      reason: z.string().optional(),
    }),
  )(req);
  const ref = await col(eventId, "teamChangeRequests").add({
    ...b,
    uid,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: ref.id });
});
participantRouter.get("/teams/mine", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const teamId = p.get("teamId");
  if (!teamId) return res.json(null);
  const t = await col(eventId, "teams").doc(teamId).get();
  res.json(data(t));
});

participantRouter.get("/matching", async (req, res) => {
  const { eventId, uid } = mine(req);
  const [me, users, parts] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db
      .collection("users")
      .where("eventId", "==", eventId)
      .where("role", "==", "participant")
      .limit(100)
      .get(),
    col(eventId, "participants").get(),
  ]);
  const mineSkills = new Set<string>(
    ((me.get("skills") as string[]) ?? []).map((s) => s.toLowerCase()),
  );
  const pMap = new Map(parts.docs.map((p) => [p.id, p]));
  const suggestions = users.docs
    .filter((u) => u.id !== uid && !pMap.get(u.id)?.get("teamId"))
    .map((u) => {
      const skills = (u.get("skills") as string[]) ?? [];
      const complement = skills.filter((s) => !mineSkills.has(s.toLowerCase())).length;
      const sameTrack = pMap.get(u.id)?.get("track") === pMap.get(uid)?.get("track");
      return {
        uid: u.id,
        name: u.get("name"),
        skills,
        score: complement * 3 + (sameTrack ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  res.json({ suggestions });
});
participantRouter.post("/connections", async (req, res) => {
  const { eventId, uid } = mine(req);
  const { toUid } = body(z.object({ toUid: id }))(req);
  const ref = col(eventId, "connections").doc(`${uid}_${toUid}`);
  await ref.create({
    fromUid: uid,
    toUid,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: ref.id });
});
participantRouter.post("/connections/:id/respond", async (req, res) => {
  const { eventId, uid } = mine(req);
  const ref = col(eventId, "connections").doc(req.params.id);
  const snap = await ref.get();
  if (snap.get("toUid") !== uid) throw forbidden();
  const { accept: yes } = body(z.object({ accept: z.boolean() }))(req);
  await ref.update({
    status: yes ? "accepted" : "declined",
    respondedAt: FieldValue.serverTimestamp(),
  });
  res.json({ status: yes ? "accepted" : "declined" });
});
participantRouter.post("/teams/:teamId/invitations", async (req, res) => {
  const { eventId, uid } = mine(req);
  const { toUid } = body(z.object({ toUid: id }))(req);
  const team = await col(eventId, "teams").doc(req.params.teamId).get();
  if (!team.exists) throw notFound("Team");
  if (team.get("leaderUid") !== uid) throw forbidden("Only the team leader can invite");
  const ref = col(eventId, "teamChangeRequests").doc();
  await ref.create({
    type: "join",
    uid: toUid,
    teamId: team.id,
    invitedBy: uid,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  await enqueue({
    channel: "whatsapp",
    uid: toUid,
    template: "command_reply",
    vars: { reply: `You were invited to join ${team.get("name")}. Open HACKOS to respond.` },
    dedupeKey: `team_invite_${ref.id}`,
    eventId,
  });
  res.status(201).json({ id: ref.id });
});

participantRouter.put("/replacement/open", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(
    z.object({ on: z.boolean(), skills: z.array(z.string()), availability: z.string() }),
  )(req);
  await participant(eventId, uid).update({ openToReplacement: b });
  res.json(b);
});
participantRouter.post("/replacements/:id/accept", async (req, res) => {
  const { eventId, uid } = mine(req);
  await accept(eventId, req.params.id, uid);
  res.json({ accepted: true });
});
participantRouter.post("/replacements/:id/decline", async (req, res) => {
  const { eventId, uid } = mine(req);
  await decline(eventId, req.params.id, uid);
  res.json({ declined: true });
});
participantRouter.post("/waitlist/respond", async (req, res) => {
  const { eventId, uid } = mine(req);
  await respondToOffer(eventId, uid, body(z.object({ accept: z.boolean() }))(req).accept);
  res.json({ ok: true });
});

participantRouter.put("/travel", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(
    z.object({
      city: id,
      route: id,
      mode: id,
      departAt: iso,
      arriveAt: iso,
      carpool: z.boolean().default(false),
    }),
  )(req);
  await col(eventId, "travelPlans")
    .doc(uid)
    .set({
      ...b,
      uid,
      departAt: Timestamp.fromDate(new Date(b.departAt)),
      arriveAt: Timestamp.fromDate(new Date(b.arriveAt)),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const same = await col(eventId, "travelPlans")
    .where("route", "==", b.route)
    .where("mode", "==", b.mode)
    .limit(20)
    .get();
  const circle = await col(eventId, "circles").where("route", "==", b.route).limit(1).get();
  let ref = circle.docs[0]?.ref;
  if (!ref) {
    ref = col(eventId, "circles").doc();
    await ref.create({
      route: b.route,
      mode: b.mode,
      members: [],
      meetupPoint: "",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await ref.update({
    members: FieldValue.arrayUnion(...same.docs.map((d) => d.id), uid),
    carpool: b.carpool,
  });
  res.json({ circleId: ref.id });
});
participantRouter.get("/circles/mine", async (req, res) => {
  const { eventId, uid } = mine(req);
  const s = await col(eventId, "circles").where("members", "array-contains", uid).get();
  res.json(s.docs.map(data));
});
participantRouter.post("/circles/:id/messages", async (req, res) => {
  const { eventId, uid } = mine(req);
  const c = col(eventId, "circles").doc(req.params.id);
  const snap = await c.get();
  if (!((snap.get("members") as string[]) ?? []).includes(uid)) throw forbidden();
  const { text } = body(z.object({ text: z.string().trim().min(1).max(1000) }))(req);
  const m = await c
    .collection("messages")
    .add({ uid, text, createdAt: FieldValue.serverTimestamp() });
  res.status(201).json({ id: m.id });
});
participantRouter.post("/slots/:slotId/book", async (req, res) => {
  const { eventId, uid } = mine(req);
  const slot = col(eventId, "slots").doc(req.params.slotId);
  await db.runTransaction(async (tx) => {
    const results = await tx.getAll(slot, participant(eventId, uid));
    const s = results[0]!;
    const p = results[1]!;
    if (!s.exists) throw notFound("Slot");
    if (!p.exists) throw notFound("Participant");
    if ((s.get("booked") ?? 0) >= s.get("capacity")) throw conflict("Slot is full");
    if (p.get("slotId")) throw conflict("Arrival slot already booked");
    tx.update(slot, { booked: FieldValue.increment(1) });
    tx.update(p.ref, { slotId: slot.id, status: "travel_booked" });
  });
  const room = await allotOne(eventId, uid);
  await enqueue({
    channel: "whatsapp",
    uid,
    template: "slot_booked",
    vars: { slotId: slot.id, room: room?.roomId ?? "pending" },
    dedupeKey: `slot_${slot.id}`,
    eventId,
  });
  res.json({ slotId: slot.id, room });
});

participantRouter.post("/id/reissue", async (req, res) => {
  const { eventId, uid } = mine(req);
  await reissueId(eventId, uid, uid, body(z.object({ reason: z.string().min(3) }))(req).reason);
  res.json({ reissued: true });
});
participantRouter.get("/schedule", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const s = await col(eventId, "schedule").orderBy("startAt").get();
  res.json(
    s.docs
      .filter((d) => {
        const a = d.get("audience");
        return (
          a?.type === "all" ||
          (a?.type === "track" && a.ids.includes(p.get("track"))) ||
          (a?.type === "room" && a.ids.includes(p.get("roomId"))) ||
          (a?.type === "team" && a.ids.includes(p.get("teamId")))
        );
      })
      .map(data),
  );
});
participantRouter.get("/problems", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const s = await col(eventId, "problems").where("released", "==", true).get();
  res.json(s.docs.filter((d) => d.get("track") === p.get("track")).map(data));
});
participantRouter.get("/announcements", async (req, res) => {
  const { eventId } = mine(req);
  const s = await col(eventId, "announcements").orderBy("createdAt", "desc").limit(50).get();
  res.json(s.docs.map(data));
});
participantRouter.post("/announcements/:id/seen", async (req, res) => {
  const { eventId, uid } = mine(req);
  await col(eventId, "announcements")
    .doc(req.params.id)
    .collection("seen")
    .doc(uid)
    .set({ seenAt: FieldValue.serverTimestamp() });
  res.status(204).end();
});
participantRouter.put("/fcm-token", async (req, res) => {
  const { uid, eventId } = mine(req);
  const b = body(
    z.object({
      token: id,
      topics: z
        .array(id.regex(/^[A-Za-z0-9-_.~%]+$/))
        .max(10)
        .default(["all"]),
    }),
  )(req);
  const topics = [...new Set(["all", ...b.topics])];
  await Promise.all(topics.map((topic) => getMessaging(app).subscribeToTopic(b.token, topic)));
  await db
    .collection("users")
    .doc(uid)
    .set(
      { fcmTokens: FieldValue.arrayUnion(b.token), fcmTopics: topics, eventId },
      { merge: true },
    );
  res.json({ registered: true, topics });
});

participantRouter.get("/mentor-slots", async (req, res) => {
  const { eventId } = mine(req);
  const s = await col(eventId, "mentorSlots")
    .where("status", "==", "open")
    .orderBy("startAt")
    .limit(50)
    .get();
  res.json(s.docs.map(data));
});
participantRouter.post("/mentor-slots/:id/book", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const teamId = p.get("teamId");
  if (!teamId) throw conflict("Join a team first");
  const ref = col(eventId, "mentorSlots").doc(req.params.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get("status") !== "open") throw conflict("Slot unavailable");
    const existing = await tx.get(col(eventId, "mentorSlots").where("teamId", "==", teamId));
    if (existing.size >= 3) throw conflict("Team booking limit reached");
    tx.update(ref, {
      teamId,
      bookedBy: uid,
      status: "booked",
      bookedAt: FieldValue.serverTimestamp(),
    });
  });
  res.json({ booked: true });
});
participantRouter.delete("/mentor-slots/:id/book", async (req, res) => {
  const { eventId, uid } = mine(req);
  const ref = col(eventId, "mentorSlots").doc(req.params.id);
  const s = await ref.get();
  if (s.get("bookedBy") !== uid) throw forbidden();
  await ref.update({ teamId: FieldValue.delete(), bookedBy: FieldValue.delete(), status: "open" });
  res.status(204).end();
});

participantRouter.post("/progress", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  if (!p.get("teamId")) throw conflict("Join a team first");
  const { text } = body(z.object({ text: z.string().min(1).max(2000) }))(req);
  const r = await col(eventId, "progress").add({
    teamId: p.get("teamId"),
    uid,
    text,
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: r.id });
});
participantRouter.post("/tickets", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(z.object({ text: z.string().min(1).max(2000), roomId: id.optional() }))(req);
  const r = await col(eventId, "tickets").add({
    ...b,
    createdBy: uid,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: r.id });
});
participantRouter.get("/food-pass", async (req, res) => {
  const { eventId, uid } = mine(req);
  res.json({ token: issueFoodPass(eventId, uid), expiresInSeconds: 900 });
});

participantRouter.post("/submissions", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(
    z.object({
      pptUrl: url,
      videoUrl: url,
      repoUrl: z
        .url()
        .refine(
          (v) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(v),
          "GitHub repository URL required",
        ),
    }),
  )(req);
  if (!isOurCloudinaryUrl(b.pptUrl))
    throw new HttpError(400, "BAD_UPLOAD_URL", "Upload the deck through HACKOS");
  if (!/(youtube\.com|youtu\.be|drive\.google\.com)/.test(b.videoUrl))
    throw new HttpError(400, "BAD_VIDEO_URL", "Use YouTube or Google Drive");
  const [event, p] = await Promise.all([getEvent(eventId), participant(eventId, uid).get()]);
  if (event.submissionsLocked || Date.now() > event.deadlines.submission.toMillis())
    throw conflict("Submission deadline passed");
  const teamId = p.get("teamId");
  if (!teamId) throw conflict("Join a team first");
  const root = col(eventId, "submissions").doc(teamId);
  const versions = await root.collection("versions").count().get();
  const version = versions.data().count + 1;
  const receiptId = randomBytes(10).toString("hex");
  const submittedAt = FieldValue.serverTimestamp();
  await root.set({ ...b, submittedAt, version, receiptId, submittedBy: uid }, { merge: true });
  await root
    .collection("versions")
    .doc(String(version))
    .set({ ...b, submittedAt, version, receiptId, submittedBy: uid });
  await participant(eventId, uid).update({ status: "submitted" });
  await enqueue({
    channel: "whatsapp",
    uid,
    template: "submission_receipt",
    vars: { receiptId, version: String(version) },
    dedupeKey: `submission_${receiptId}`,
    eventId,
  });
  void refreshGithub(eventId, teamId, true).catch(console.error);
  res.status(201).json({ receiptId, version });
});
participantRouter.get("/results", async (req, res) => {
  const { eventId, uid } = mine(req);
  const event = await eventRef(eventId).get();
  if (!event.get("leaderboardVisible")) throw forbidden("Results are not published");
  const p = await participant(eventId, uid).get();
  const [board, scores] = await Promise.all([
    col(eventId, "leaderboard").doc("current").get(),
    col(eventId, "scores")
      .where("teamId", "==", p.get("teamId") ?? "_")
      .get(),
  ]);
  res.json({ leaderboard: board.data(), myScores: scores.docs.map(data) });
});
participantRouter.get("/certificates", async (req, res) => {
  const { eventId, uid } = mine(req);
  const s = await db
    .collection("certificates")
    .where("uid", "==", uid)
    .where("eventId", "==", eventId)
    .get();
  res.json(
    s.docs.map((d) => ({ ...data(d), downloadUrl: `/api/public/certificates/${d.id}/pdf` })),
  );
});

participantRouter.get("/rewards", async (req, res) => {
  const { eventId, uid } = mine(req);
  const p = await participant(eventId, uid).get();
  const teamId = p.get("teamId");
  if (!teamId) return res.json([]);
  const s = await col(eventId, "rewards").where("winnerTeamId", "==", teamId).get();
  res.json(s.docs.map(data));
});
participantRouter.post("/rewards/:id/confirm", async (req, res) => {
  const { eventId, uid } = mine(req);
  const ref = col(eventId, "rewards").doc(req.params.id);
  const reward = await ref.get();
  const p = await participant(eventId, uid).get();
  if (reward.get("winnerTeamId") !== p.get("teamId")) throw forbidden();
  await ref.update({
    status: "confirmed",
    confirmedAt: FieldValue.serverTimestamp(),
    confirmedBy: uid,
  });
  res.json({ confirmed: true });
});
participantRouter.post("/complaints", async (req, res) => {
  const { eventId, uid } = mine(req);
  const b = body(
    z.object({
      rewardId: id,
      text: z.string().min(3),
      evidenceUrls: z.array(url).max(10).default([]),
    }),
  )(req);
  if (b.evidenceUrls.some((e) => !isOurCloudinaryUrl(e)))
    throw new HttpError(400, "BAD_UPLOAD_URL", "Upload evidence through HACKOS");
  const r = await col(eventId, "complaints").add({
    ...b,
    uid,
    status: "open",
    history: [],
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: r.id });
});
participantRouter.post("/ratings", async (req, res) => {
  const { eventId, uid } = mine(req);
  const [event, p] = await Promise.all([getEvent(eventId), participant(eventId, uid).get()]);
  if (!p.get("checkedInAt") || Date.now() < event.endAt.toMillis())
    throw forbidden("Ratings open after the event for checked-in participants");
  const b = body(
    z.object({
      scores: z.record(z.string(), z.number().int().min(1).max(5)),
      text: z.string().max(2000).default(""),
    }),
  )(req);
  await col(eventId, "ratings")
    .doc(uid)
    .create({ ...b, uid, createdAt: FieldValue.serverTimestamp() });
  res.status(201).json({ created: true });
});
participantRouter.get("/community", async (req, res) => {
  const { eventId } = mine(req);
  const s = await db
    .collection("users")
    .where("eventId", "==", eventId)
    .where("communityOptIn", "==", true)
    .limit(50)
    .get();
  res.json(
    s.docs.map((d) => ({
      uid: d.id,
      name: d.get("name"),
      skills: d.get("skills"),
      githubUsername: d.get("githubUsername"),
    })),
  );
});
participantRouter.put("/community/opt-in", async (req, res) => {
  const { uid } = mine(req);
  const { enabled } = body(z.object({ enabled: z.boolean() }))(req);
  await db.collection("users").doc(uid).update({ communityOptIn: enabled });
  res.json({ enabled });
});

participantRouter.use((_req, res) =>
  res.status(404).json({ error: "NOT_FOUND", message: "No such participant route" }),
);
