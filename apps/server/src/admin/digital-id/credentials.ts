import { randomInt } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { PARTICIPANT_STATUSES } from "@hackos/shared";
import { b64u, backupCodeHash, type CredentialPayload } from "@hackos/shared/crypto";
import { writeAudit } from "../../core/audit.js";
import { randomToken, sha256Hex } from "../../core/crypto.js";
import { env } from "../../core/env.js";
import { col, eventRef, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, conflict, HttpError, notFound } from "../../core/http.js";
import { enqueueMany, type EnqueueInput } from "../../core/outbox.js";
import { signCredential } from "../../core/signing.js";
import { stats } from "../../core/stats.js";
import { bumpRosterTx } from "./roster.js";
import { assertEnrollmentApproved } from "./enrollment-policy.js";

// Digital ID (plan D13, Samrat's guide 6.2–6.4).

export const ENROLL_TOKEN_TTL_MS = 48 * 60 * 60_000;
const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function generateBackupCode(): string {
  return Array.from({ length: 8 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join(
    "",
  );
}

/** A valid device key is a raw uncompressed P-256 point: 65 bytes starting with 0x04. */
function assertDeviceKey(devicePubKey: string) {
  let bytes: Uint8Array;
  try {
    bytes = b64u.dec(devicePubKey);
  } catch {
    throw badRequest("devicePubKey is not base64url");
  }
  if (bytes.length !== 65 || bytes[0] !== 0x04)
    throw badRequest("devicePubKey must be a raw 65-byte P-256 key");
}

const statusIndex = (s: string) =>
  PARTICIPANT_STATUSES.indexOf(s as (typeof PARTICIPANT_STATUSES)[number]);

/**
 * Binds a device key to a participant and signs their credential. Returns the
 * credential and the one-time-visible backup code. Used by enrollWithToken
 * (participant app) and by the simulator script.
 */
export async function completeEnrollment(eventId: string, uid: string, devicePubKey: string) {
  assertDeviceKey(devicePubKey);
  const event = await getEvent(eventId);
  const backupCode = generateBackupCode();

  const credential = await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef(eventId));
    const p = await tx.get(col(eventId, "participants").doc(uid));
    if (!p.exists) throw notFound("Participant");
    assertEnrollmentApproved(p.data() ?? {});
    if (p.get("enrollment.status") === "revoked")
      throw new HttpError(403, "REVOKED", "This ID was revoked");

    const payload: CredentialPayload = {
      v: 1,
      eventId,
      participantId: uid,
      teamId: p.get("teamId") || undefined,
      devicePubKey,
      issuedAt: new Date().toISOString(),
      expiresAt: (event.endAt as Timestamp).toDate().toISOString(),
    };
    const update: Record<string, unknown> = {
      enrollment: { status: "enrolled", devicePubKey },
      backupCode: await backupCodeHash(eventId, backupCode),
    };
    if (statusIndex(p.get("status")) < statusIndex("enrolled") && p.get("status") !== "rejected") {
      update.status = "enrolled";
    }
    tx.update(p.ref, update);
    bumpRosterTx(tx, eventSnap, [uid]);
    return signCredential(env.organizerPrivatePem, payload);
  });

  stats.recomputeSoon(eventId);
  return { credential, backupCode, organizerPubKey: env.organizerPublicKey };
}

/** POST /api/p/enroll (Manthan wires the route in Phase 2): single-use, 48-hour token. */
export async function enrollWithToken(eventId: string, token: string, devicePubKey: string) {
  const ref = col(eventId, "enrollTokens").doc(sha256Hex(token));
  const uid = await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw new HttpError(400, "BAD_TOKEN", "Invalid enrollment link");
    if (t.get("used")) throw new HttpError(409, "TOKEN_USED", "Already enrolled on another device");
    if ((t.get("expiresAt") as Timestamp).toMillis() < Date.now()) {
      throw new HttpError(
        410,
        "TOKEN_EXPIRED",
        "Enrollment link expired, ask an organizer for a new one",
      );
    }
    tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
    return t.get("uid") as string;
  });
  const result = await completeEnrollment(eventId, uid, devicePubKey);
  const p = await col(eventId, "participants").doc(uid).get();
  return {
    ...result,
    uid,
    profile: { name: p.get("name"), college: p.get("college"), teamId: p.get("teamId") },
  };
}

/** Marks every unused token of these participants as used, so old links stop working. */
async function invalidateTokens(eventId: string, uids: string[]) {
  const writer = db.bulkWriter();
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await col(eventId, "enrollTokens")
      .where("uid", "in", uids.slice(i, i + 30))
      .where("used", "==", false)
      .get();
    for (const d of snap.docs) writer.update(d.ref, { used: true, invalidated: true });
  }
  await writer.close();
}

/**
 * Creates enrollment tokens and queues the links. Without `uids`: every eligible
 * participant who hasn't been sent a link yet. With `uids`: those people, and any
 * earlier links they had stop working.
 */
export async function sendEnrollmentLinks(eventId: string, actor: string, uids?: string[]) {
  let targets: string[];
  if (uids?.length) {
    targets = uids;
    await invalidateTokens(eventId, uids);
  } else {
    const snap = await col(eventId, "participants")
      .where("eligibility.result", "==", "eligible")
      .get();
    targets = snap.docs
      .filter((p) => !p.get("enrollment") && !p.get("mergedInto") && !p.get("withdrawnAt"))
      .map((p) => p.id);
  }

  const expiresAt = Timestamp.fromMillis(Date.now() + ENROLL_TOKEN_TTL_MS);
  const writer = db.bulkWriter();
  const messages: EnqueueInput[] = [];
  for (const uid of targets) {
    const token = randomToken();
    const hash = sha256Hex(token);
    writer.create(col(eventId, "enrollTokens").doc(hash), { uid, expiresAt, used: false });
    writer.set(
      col(eventId, "participants").doc(uid),
      { enrollment: { status: "invited" } },
      { merge: true },
    );
    messages.push({
      channel: "whatsapp",
      uid,
      template: "enrollment_link",
      vars: { link: `${env.participantAppUrl}/id?e=${eventId}&token=${token}` },
      dedupeKey: `enroll_${hash.slice(0, 16)}`,
      eventId,
    });
  }
  await writer.close();
  await enqueueMany(messages);
  await writeAudit({
    eventId,
    actor,
    action: "enrollment.send",
    target: eventId,
    after: { count: targets.length },
  });
  return { sent: targets.length };
}

/** Revokes a participant's ID: scanners reject it after their next roster sync. */
export async function revokeId(eventId: string, uid: string, actor: string, reason: string) {
  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef(eventId));
    const p = await tx.get(col(eventId, "participants").doc(uid));
    if (!p.exists) throw notFound("Participant");
    if (p.get("enrollment.status") === "revoked") throw conflict("Already revoked");
    tx.update(p.ref, {
      "enrollment.status": "revoked",
      "enrollment.revokedAt": FieldValue.serverTimestamp(),
    });
    bumpRosterTx(tx, eventSnap, [uid]);
    await writeAudit(
      {
        eventId,
        actor,
        action: "id.revoke",
        target: uid,
        before: p.get("enrollment") ?? null,
        reason,
      },
      tx,
    );
  });
  await invalidateTokens(eventId, [uid]);
  stats.recomputeSoon(eventId);
}

/** Lost or changed phone: the old device key stops working and a fresh link is sent. */
export async function reissueId(eventId: string, uid: string, actor: string, reason: string) {
  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef(eventId));
    const p = await tx.get(col(eventId, "participants").doc(uid));
    if (!p.exists) throw notFound("Participant");
    tx.update(p.ref, { enrollment: { status: "invited" }, backupCode: FieldValue.delete() });
    bumpRosterTx(tx, eventSnap, [uid]);
    await writeAudit(
      {
        eventId,
        actor,
        action: "id.reissue",
        target: uid,
        before: p.get("enrollment") ?? null,
        reason,
      },
      tx,
    );
  });
  await sendEnrollmentLinks(eventId, actor, [uid]);
  stats.recomputeSoon(eventId);
}
