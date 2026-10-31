import { randomInt } from "node:crypto";
import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import {
  ChangeRoleBody,
  COL,
  CreateStaffBody,
  DisableStaffBody,
  STAFF_ROLES,
  VolunteerLoginBody,
  type StaffRole,
} from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { requireRole, param } from "../../core/auth.js";
import { decrypt, encrypt, hashEmail, lookupHash, randomToken } from "../../core/crypto.js";
import { col, getEvent } from "../../core/events.js";
import { auth, db } from "../../core/firebase.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../../core/http.js";
import { strictLimiter } from "../../core/rateLimit.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { z } from "zod";

// Staff and roles (plan D5). Mounted at /api/admin/staff, plus the public
// volunteer PIN login at /api/admin/auth/volunteer-login.

export const staffRouter = Router();
export const volunteerLoginRouter = Router();

/** Super admin may act on any event; an organizer only on their own, and never on organizers. */
function scopeFor(
  user: NonNullable<Express.Request["user"]>,
  targetRole: StaffRole,
  eventId?: string,
): string {
  if (user.role === "superadmin") {
    if (!eventId) throw badRequest("eventId is required");
    return eventId;
  }
  if (targetRole === "organizer") throw forbidden("Only the super admin manages organizers");
  if (eventId && eventId !== user.eventId) throw forbidden("Not your event");
  return user.eventId;
}

async function loadStaff(uid: string) {
  const snap = await db.collection(COL.users).doc(uid).get();
  const role = snap.get("role");
  if (!snap.exists || !STAFF_ROLES.includes(role)) throw notFound("Staff member");
  return { snap, role: role as StaffRole, eventId: snap.get("eventId") as string };
}

const pinKey = (eventId: string, pin: string) => lookupHash(`pin:${eventId}:${pin}`);

staffRouter.post("/", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, CreateStaffBody);
  const eventId = scopeFor(req.user!, body.role, body.eventId);
  await getEvent(eventId);

  let record;
  try {
    record = await auth.getUserByEmail(body.email);
  } catch {
    record = await auth.createUser({ email: body.email, displayName: body.name });
  }
  const existingRole = record.customClaims?.role;
  if (existingRole && !STAFF_ROLES.includes(existingRole)) {
    throw conflict(`This email already has the role "${existingRole}"`);
  }

  const claims = { role: body.role, eventId };
  await auth.setCustomUserClaims(record.uid, claims);
  const doc = {
    name: body.name,
    role: body.role,
    eventId,
    emailHash: hashEmail(body.email),
    emailEnc: encrypt(body.email),
    skills: [],
    disabled: false,
  };
  const batch = db.batch();
  batch.set(db.collection(COL.users).doc(record.uid), doc, { merge: true });
  await writeAudit(
    { eventId, actor: req.user!.uid, action: "staff.create", target: record.uid, after: claims },
    batch,
  );
  await batch.commit();
  res.status(201).json({ uid: record.uid, ...claims, name: body.name, email: body.email });
});

staffRouter.get("/", requireRole("organizer"), async (req, res) => {
  const { eventId: requested } = parseQuery(req, z.object({ eventId: z.string().optional() }));
  const eventId = req.user!.role === "superadmin" ? requested : req.user!.eventId;
  let q = db.collection(COL.users).where("role", "in", [...STAFF_ROLES]);
  if (eventId) q = q.where("eventId", "==", eventId);
  const snap = await q.get();
  res.json({
    items: snap.docs.map((d) => ({
      uid: d.id,
      name: d.get("name"),
      email: d.get("emailEnc") ? decrypt(d.get("emailEnc")) : null,
      role: d.get("role"),
      eventId: d.get("eventId"),
      disabled: d.get("disabled") ?? false,
      hasPin: Boolean(d.get("pinKey")),
    })),
  });
});

staffRouter.patch("/:uid/role", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, ChangeRoleBody);
  const uid = param(req, "uid");
  const staff = await loadStaff(uid);
  scopeFor(req.user!, staff.role, staff.eventId);
  scopeFor(req.user!, body.role, staff.eventId);

  await auth.setCustomUserClaims(uid, { role: body.role, eventId: staff.eventId });
  await auth.revokeRefreshTokens(uid); // the new role applies at the next sign-in
  const batch = db.batch();
  batch.update(staff.snap.ref, { role: body.role });
  await writeAudit(
    {
      eventId: staff.eventId,
      actor: req.user!.uid,
      action: "staff.role",
      target: uid,
      before: { role: staff.role },
      after: { role: body.role },
      reason: body.reason,
    },
    batch,
  );
  await batch.commit();
  res.json({ uid, role: body.role });
});

staffRouter.post("/:uid/disable", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, DisableStaffBody);
  const uid = param(req, "uid");
  const staff = await loadStaff(uid);
  scopeFor(req.user!, staff.role, staff.eventId);

  await auth.updateUser(uid, { disabled: body.disabled });
  if (body.disabled) await auth.revokeRefreshTokens(uid);
  const batch = db.batch();
  batch.update(staff.snap.ref, { disabled: body.disabled });
  await writeAudit(
    {
      eventId: staff.eventId,
      actor: req.user!.uid,
      action: body.disabled ? "staff.disable" : "staff.enable",
      target: uid,
      reason: body.reason,
    },
    batch,
  );
  await batch.commit();
  res.json({ uid, disabled: body.disabled });
});

/** Issues a new 6-digit scanner PIN. The PIN is returned once and only its hash is stored. */
staffRouter.post("/:uid/pin", requireRole("organizer"), async (req, res) => {
  const uid = param(req, "uid");
  const staff = await loadStaff(uid);
  if (staff.role !== "volunteer") throw badRequest("PINs are only for volunteers");
  scopeFor(req.user!, staff.role, staff.eventId);

  const pins = col(staff.eventId, "volunteerPins");
  const oldKey = staff.snap.get("pinKey") as string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const key = pinKey(staff.eventId, pin);
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(pins.doc(key));
        if (existing.exists) throw new Error("PIN_TAKEN");
        tx.create(pins.doc(key), { uid, createdAt: FieldValue.serverTimestamp() });
        if (oldKey) tx.delete(pins.doc(oldKey));
        tx.update(staff.snap.ref, { pinKey: key });
        await writeAudit(
          { eventId: staff.eventId, actor: req.user!.uid, action: "staff.pin", target: uid },
          tx,
        );
      });
      res.json({ uid, pin });
      return;
    } catch (err) {
      if ((err as Error).message !== "PIN_TAKEN") throw err;
    }
  }
  throw new HttpError(503, "PIN_EXHAUSTED", "Could not generate a unique PIN, try again");
});

/** Public: event code + PIN → Firebase custom token for the scanner (plan A2/A13). */
volunteerLoginRouter.post("/volunteer-login", strictLimiter, async (req, res) => {
  const body = parseBody(req, VolunteerLoginBody);
  const fail = () => new HttpError(401, "BAD_LOGIN", "Wrong event code or PIN");

  const events = await db.collection("events").where("code", "==", body.eventCode.toUpperCase()).limit(1).get();
  const event = events.docs[0];
  if (!event) throw fail();
  const pinDoc = await col(event.id, "volunteerPins").doc(pinKey(event.id, body.pin)).get();
  if (!pinDoc.exists) throw fail();

  const uid = pinDoc.get("uid") as string;
  const user = await db.collection(COL.users).doc(uid).get();
  if (user.get("disabled") || user.get("role") !== "volunteer") throw fail();

  const token = await auth.createCustomToken(uid, { role: "volunteer", eventId: event.id });
  res.json({
    token,
    eventId: event.id,
    name: user.get("name"),
    /** Suggested scanner device ID; the app keeps its own once it has one. */
    deviceId: `vd_${randomToken(9)}`,
  });
});
