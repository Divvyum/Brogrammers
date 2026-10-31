import { parse } from "csv-parse/sync";
import { FieldValue } from "firebase-admin/firestore";
import { COL, DOC, RegistrationRow } from "@hackos/shared";
import { encrypt, hashEmail, hashPhone, normalizeEmail, normalizePhone, randomToken } from "../../core/crypto.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";

// CSV import of registrations (plan D8). uniqueKeys/{type_hash} is created in the
// same transaction as the user, so the same phone or email can't register twice.

export interface ImportResult {
  created: number;
  teamsCreated: number;
  errors: { row: number; message: string }[];
}

export const splitSkills = (s?: string) =>
  (s ?? "")
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

export async function importRegistrations(eventId: string, csv: string): Promise<ImportResult> {
  const event = await getEvent(eventId);
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<
    string,
    string
  >[];

  const result: ImportResult = { created: 0, teamsCreated: 0, errors: [] };
  const teams = new Map<string, { uids: string[]; track?: string }>();

  for (const [i, raw] of records.entries()) {
    const row = i + 2; // header is line 1
    const parsed = RegistrationRow.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "")));
    if (!parsed.success) {
      result.errors.push({ row, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    const r = parsed.data;
    if (r.track && !event.tracks.includes(r.track)) {
      result.errors.push({ row, message: `Unknown track "${r.track}"` });
      continue;
    }

    const uid = db.collection(COL.users).doc().id;
    const phoneHash = hashPhone(r.phone);
    const emailHash = hashEmail(r.email);
    try {
      await db.runTransaction(async (tx) => {
        const phoneKey = db.doc(DOC.uniqueKey("phone", phoneHash));
        const emailKey = db.doc(DOC.uniqueKey("email", emailHash));
        const [p, e] = await tx.getAll(phoneKey, emailKey);
        if (p?.exists) throw new Error("This phone number is already registered");
        if (e?.exists) throw new Error("This email is already registered");
        const now = FieldValue.serverTimestamp();
        tx.create(phoneKey, { uid, createdAt: now });
        tx.create(emailKey, { uid, createdAt: now });
        tx.create(db.collection(COL.users).doc(uid), {
          name: r.name,
          emailHash,
          emailEnc: encrypt(normalizeEmail(r.email)),
          phoneHash,
          phoneEnc: encrypt(normalizePhone(r.phone)),
          college: r.college,
          year: r.year,
          city: r.city,
          skills: splitSkills(r.skills),
          githubUsername: r.githubUsername,
          role: "participant",
          eventId,
        });
        tx.create(col(eventId, "participants").doc(uid), {
          name: r.name,
          college: r.college,
          registeredAt: now,
          status: "registered",
          track: r.track,
          rosterVersion: event.rosterVersion,
        });
      });
    } catch (err) {
      result.errors.push({ row, message: (err as Error).message });
      continue;
    }
    result.created++;
    if (r.teamName) {
      const t = teams.get(r.teamName) ?? { uids: [], track: r.track };
      t.uids.push(uid);
      teams.set(r.teamName, t);
    }
  }

  for (const [name, t] of teams) {
    const ref = col(eventId, "teams").doc();
    const batch = db.batch();
    batch.create(ref, {
      name,
      inviteCode: randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6),
      leaderUid: t.uids[0],
      memberUids: t.uids,
      track: t.track,
      status: "forming",
    });
    for (const uid of t.uids) batch.update(col(eventId, "participants").doc(uid), { teamId: ref.id });
    await batch.commit();
    result.teamsCreated++;
  }
  return result;
}
