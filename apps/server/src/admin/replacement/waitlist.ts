import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../../core/audit.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, forbidden, notFound } from "../../core/http.js";
import { enqueue } from "../../core/outbox.js";
import { INVITE_TTL_MS } from "./replacement.service.js";

// Waitlist (plan D11): eligible people first, then by registration time.
// Seats offered by hand expire like replacement invitations. Seats offered by
// the replacement chain carry a replacementId and are expired by that chain.

export async function recomputeWaitlist(eventId: string) {
  const snap = await col(eventId, "waitlist").get();
  const waiting = snap.docs
    .filter((d) => d.get("status") === "waiting")
    .sort(
      (a, b) =>
        Number(b.get("eligible")) - Number(a.get("eligible")) ||
        a.get("registeredAt").toMillis() - b.get("registeredAt").toMillis(),
    );
  const writer = db.bulkWriter();
  waiting.forEach((d, i) => {
    if (d.get("position") !== i + 1) writer.update(d.ref, { position: i + 1 });
  });
  await writer.close();
  return waiting.length;
}

/** Puts registered participants on the waitlist. People already on it are skipped. */
export async function addToWaitlist(eventId: string, uids: string[], actor: string) {
  const participants = await db.getAll(...uids.map((u) => col(eventId, "participants").doc(u)));
  const existing = await db.getAll(...uids.map((u) => col(eventId, "waitlist").doc(u)));
  const result = { added: [] as string[], skipped: [] as { uid: string; reason: string }[] };

  const batch = db.batch();
  participants.forEach((p, i) => {
    const uid = uids[i]!;
    if (!p.exists) return result.skipped.push({ uid, reason: "Not registered" });
    if (p.get("mergedInto")) return result.skipped.push({ uid, reason: "Merged into another record" });
    if (p.get("teamId")) return result.skipped.push({ uid, reason: "Already in a team" });
    if (existing[i]?.exists) return result.skipped.push({ uid, reason: "Already on the waitlist" });
    batch.create(col(eventId, "waitlist").doc(uid), {
      position: 0,
      eligible: p.get("eligibility.result") === "eligible",
      status: "waiting",
      registeredAt: p.get("registeredAt"),
    });
    result.added.push(uid);
  });
  await batch.commit();
  if (result.added.length) {
    await recomputeWaitlist(eventId);
    await writeAudit({ eventId, actor, action: "waitlist.add", target: eventId, after: { uids: result.added } });
  }
  return result;
}

/** Organizer offers a waitlist seat by hand. The offer expires after the invite TTL. */
export async function offerSeat(eventId: string, uid: string, actor: string) {
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);
  await db.runTransaction(async (tx) => {
    const ref = col(eventId, "waitlist").doc(uid);
    const w = await tx.get(ref);
    if (!w.exists) throw notFound("Waitlist entry");
    if (w.get("status") !== "waiting") throw conflict(`Entry is already ${w.get("status")}`);
    tx.update(ref, { status: "offered", offeredAt: FieldValue.serverTimestamp(), offerExpiresAt: expiresAt });
    await writeAudit({ eventId, actor, action: "waitlist.offer", target: uid }, tx);
  });
  await enqueue({
    channel: "whatsapp",
    uid,
    template: "waitlist_offer",
    vars: { expiresAt: expiresAt.toDate().toISOString() },
    dedupeKey: `waitlist_offer_${eventId}`,
    eventId,
  });
}

/**
 * Participant accepts or declines a hand-made seat offer (Manthan wires this in
 * Phase 2). Offers from the replacement chain go through accept/decline in
 * replacement.service instead.
 */
export async function respondToOffer(eventId: string, uid: string, accepted: boolean) {
  await db.runTransaction(async (tx) => {
    const ref = col(eventId, "waitlist").doc(uid);
    const w = await tx.get(ref);
    if (!w.exists) throw notFound("Waitlist entry");
    if (w.get("status") !== "offered") throw conflict("There is no open offer");
    if (w.get("replacementId")) throw forbidden("Answer this offer through the replacement invitation");
    if ((w.get("offerExpiresAt") as Timestamp).toMillis() < Date.now()) throw conflict("The offer expired");
    tx.update(ref, { status: accepted ? "accepted" : "declined", respondedAt: FieldValue.serverTimestamp() });
    await writeAudit({ eventId, actor: uid, action: accepted ? "waitlist.accept" : "waitlist.decline", target: uid }, tx);
  });
}

/** Cron: hand-made offers nobody answered in time go to "expired". */
export async function expireWaitlistOffers(eventId: string, now = Timestamp.now()) {
  const snap = await col(eventId, "waitlist")
    .where("status", "==", "offered")
    .where("offerExpiresAt", "<=", now)
    .get();
  const due = snap.docs.filter((d) => !d.get("replacementId"));
  if (!due.length) return 0;
  const batch = db.batch();
  for (const d of due) batch.update(d.ref, { status: "expired" });
  await batch.commit();
  await writeAudit({
    eventId,
    actor: "system",
    action: "waitlist.expire",
    target: eventId,
    after: { uids: due.map((d) => d.id) },
  });
  return due.length;
}
