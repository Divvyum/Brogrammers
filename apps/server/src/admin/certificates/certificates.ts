import { randomInt } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COL } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict } from "../../core/http.js";
import { enqueueMany } from "../../core/outbox.js";
import { certificatePdf } from "./pdf.js";

// Certificates (plan D25). Records live in the top-level certificates
// collection so the public verify endpoint needs one read.

export const PUBLIC_BASE_URL = () => process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
export const verifyUrl = (certId: string) => `${PUBLIC_BASE_URL()}/api/public/certificates/${certId}`;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 12 characters, ~60 bits: hard to guess, easy to read out. */
export const newCertId = () => Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

interface Recipient {
  uid: string;
  name: string;
  rank?: number;
  teamName?: string;
}

async function recipientsFor(
  eventId: string,
  type: "participation" | "winner" | "mentor",
  uids: string[] | undefined,
  topTeams: number,
): Promise<Recipient[]> {
  if (type === "mentor") {
    const mentors = await db.collection(COL.users).where("eventId", "==", eventId).where("role", "==", "mentor").get();
    return mentors.docs.filter((m) => !uids || uids.includes(m.id)).map((m) => ({ uid: m.id, name: m.get("name") as string }));
  }
  if (type === "winner") {
    const lb = await col(eventId, "leaderboard").doc("current").get();
    const top = ((lb.get("teams") as { teamId: string; teamName: string; rank: number }[] | undefined) ?? []).filter((t) => t.rank <= topTeams);
    if (!top.length) throw conflict("No leaderboard yet: lock some scores first");
    const out: Recipient[] = [];
    for (const t of top) {
      const team = await col(eventId, "teams").doc(t.teamId).get();
      for (const uid of (team.get("memberUids") as string[]) ?? []) {
        const p = await col(eventId, "participants").doc(uid).get();
        if (p.exists && (!uids || uids.includes(uid))) out.push({ uid, name: p.get("name"), rank: t.rank, teamName: t.teamName });
      }
    }
    return out;
  }
  // Participation: everyone who checked in.
  const snap = await col(eventId, "participants").where("checkedInAt", "!=", null).get();
  return snap.docs
    .filter((p) => !p.get("mergedInto") && (!uids || uids.includes(p.id)))
    .map((p) => ({ uid: p.id, name: p.get("name") as string }));
}

/** Issues certificates (skipping anyone who already has one of this type) and queues the links. */
export async function issueCertificates(
  eventId: string,
  type: "participation" | "winner" | "mentor",
  actor: string,
  uids?: string[],
  topTeams = 3,
) {
  const event = await getEvent(eventId);
  const recipients = await recipientsFor(eventId, type, uids, topTeams);
  const existing = await db.collection(COL.certificates).where("eventId", "==", eventId).where("type", "==", type).select("uid").get();
  const have = new Set(existing.docs.map((d) => d.get("uid") as string));

  const batch = db.bulkWriter();
  const issued: { certId: string; uid: string }[] = [];
  for (const r of recipients) {
    if (have.has(r.uid)) continue;
    const certId = newCertId();
    batch.create(db.collection(COL.certificates).doc(certId), {
      uid: r.uid,
      eventId,
      type,
      name: r.name,
      eventName: event.name,
      rank: r.rank,
      teamName: r.teamName,
      issuedAt: FieldValue.serverTimestamp(),
    });
    issued.push({ certId, uid: r.uid });
  }
  await batch.close();
  await enqueueMany(
    issued.map((c) => ({
      channel: "whatsapp" as const,
      uid: c.uid,
      template: "certificate_ready",
      vars: { type, link: `${verifyUrl(c.certId)}/pdf` },
      dedupeKey: `certificate_${type}_${eventId}`,
      eventId,
    })),
  );
  await writeAudit({ eventId, actor, action: "certificates.issue", target: eventId, after: { type, issued: issued.length, skipped: recipients.length - issued.length } });
  return { issued: issued.length, skipped: recipients.length - issued.length, certificates: issued };
}

export async function loadCertificate(certId: string) {
  if (!/^[A-Z2-9]{12}$/.test(certId)) return null;
  const snap = await db.collection(COL.certificates).doc(certId).get();
  return snap.exists ? snap : null;
}

export async function renderCertificate(certId: string) {
  const c = await loadCertificate(certId);
  if (!c || c.get("revoked")) return null;
  return certificatePdf({
    certId,
    type: c.get("type"),
    name: c.get("name"),
    eventName: c.get("eventName"),
    issuedAt: (c.get("issuedAt") as Timestamp).toDate(),
    rank: c.get("rank"),
    teamName: c.get("teamName"),
    verifyUrl: verifyUrl(certId),
  });
}
