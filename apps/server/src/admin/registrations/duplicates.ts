import { FieldValue } from "firebase-admin/firestore";
import { COL } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { col, eventRef } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { bumpRosterTx } from "../digital-id/roster.js";
import { nameSimilarity, normalizeText } from "./similarity.js";

// Duplicate detection and merging (plan D8).

/** Name similarity at or above this, with the same college, counts as a likely duplicate. */
export const FUZZY_THRESHOLD = 0.92;

interface Person {
  uid: string;
  name: string;
  college: string;
  phoneHash?: string;
  emailHash?: string;
}

const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

async function loadPeople(eventId: string): Promise<Person[]> {
  const participants = await col(eventId, "participants").select("name", "college", "mergedInto").get();
  const active = participants.docs.filter((d) => !d.get("mergedInto"));
  const users = active.length
    ? await db.getAll(...active.map((d) => db.collection(COL.users).doc(d.id)), {
        fieldMask: ["phoneHash", "emailHash"],
      })
    : [];
  return active.map((d, i) => ({
    uid: d.id,
    name: normalizeText(d.get("name")),
    college: normalizeText(d.get("college")),
    phoneHash: users[i]?.get("phoneHash"),
    emailHash: users[i]?.get("emailHash"),
  }));
}

/**
 * Finds exact matches (same phone or email hash) and fuzzy matches (similar name,
 * same college) and writes new ones to events/{id}/duplicates. Pairs already
 * recorded, including dismissed ones, are left alone. Returns how many were new.
 */
export async function detectDuplicates(eventId: string): Promise<number> {
  const people = await loadPeople(eventId);
  const found = new Map<string, { uidA: string; uidB: string; matchType: string; score: number }>();

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i]!;
      const b = people[j]!;
      let matchType: string | null = null;
      let score = 1;
      if (a.phoneHash && a.phoneHash === b.phoneHash) matchType = "phone";
      else if (a.emailHash && a.emailHash === b.emailHash) matchType = "email";
      else if (a.college && a.college === b.college) {
        score = nameSimilarity(a.name, b.name);
        if (score >= FUZZY_THRESHOLD) matchType = "fuzzy";
      }
      if (matchType) {
        const [uidA, uidB] = a.uid < b.uid ? [a.uid, b.uid] : [b.uid, a.uid];
        found.set(pairId(a.uid, b.uid), { uidA, uidB, matchType, score: Math.round(score * 1000) / 1000 });
      }
    }
  }

  let created = 0;
  const writer = db.bulkWriter();
  writer.onWriteError((e) => e.code !== 6 && e.failedAttempts < 3);
  for (const [id, dup] of found) {
    writer
      .create(col(eventId, "duplicates").doc(id), { ...dup, status: "open", detectedAt: FieldValue.serverTimestamp() })
      .then(() => created++)
      .catch(() => {});
  }
  await writer.close();
  return created;
}

/**
 * Keeps the earlier registration, moves team membership to it when it has no
 * team of its own, and marks the other record as merged.
 */
export async function mergeDuplicate(eventId: string, dupId: string, actor: string, reason: string) {
  return db.runTransaction(async (tx) => {
    const dupRef = col(eventId, "duplicates").doc(dupId);
    const dup = await tx.get(dupRef);
    if (!dup.exists) throw notFound("Duplicate");
    if (dup.get("status") !== "open") throw conflict(`Duplicate is already ${dup.get("status")}`);

    const eventSnap = await tx.get(eventRef(eventId));
    const [a, b] = await tx.getAll(
      col(eventId, "participants").doc(dup.get("uidA")),
      col(eventId, "participants").doc(dup.get("uidB")),
    );
    if (!a?.exists || !b?.exists) throw notFound("Participant");
    const aFirst = a.get("registeredAt").toMillis() <= b.get("registeredAt").toMillis();
    const keep = aFirst ? a : b;
    const drop = aFirst ? b : a;

    const dropTeamId = drop.get("teamId") as string | undefined;
    const keepTeamId = keep.get("teamId") as string | undefined;
    const dropTeam = dropTeamId ? await tx.get(col(eventId, "teams").doc(dropTeamId)) : null;

    const keepUpdate: Record<string, unknown> = {};
    if (dropTeam?.exists) {
      let members = (dropTeam.get("memberUids") as string[]).filter((u) => u !== drop.id);
      let leader = dropTeam.get("leaderUid") as string;
      if (!keepTeamId) {
        // The kept record takes the dropped record's place in its team.
        members = [...members, keep.id];
        keepUpdate.teamId = dropTeamId;
        if (dropTeam.get("track")) keepUpdate.track = dropTeam.get("track");
        if (leader === drop.id) leader = keep.id;
      } else if (leader === drop.id) {
        leader = members[0] ?? keep.id;
      }
      tx.update(dropTeam.ref, { memberUids: members, leaderUid: leader });
    }

    if (Object.keys(keepUpdate).length) tx.update(keep.ref, keepUpdate);
    tx.update(drop.ref, {
      mergedInto: keep.id,
      status: "rejected",
      teamId: FieldValue.delete(),
      eligibility: { result: "rejected", reason: `Duplicate of ${keep.get("name")}`, override: true },
    });
    tx.update(dupRef, { status: "merged", keptUid: keep.id, resolvedBy: actor, reason });
    bumpRosterTx(tx, eventSnap, [keep.id, drop.id]);
    await writeAudit(
      {
        eventId,
        actor,
        action: "duplicate.merge",
        target: drop.id,
        before: { teamId: dropTeamId ?? null },
        after: { mergedInto: keep.id, keptTeamId: keepUpdate.teamId ?? keepTeamId ?? null },
        reason,
      },
      tx,
    );
    return { kept: keep.id, merged: drop.id };
  });
}

export async function dismissDuplicate(eventId: string, dupId: string, actor: string, reason: string) {
  await db.runTransaction(async (tx) => {
    const ref = col(eventId, "duplicates").doc(dupId);
    const dup = await tx.get(ref);
    if (!dup.exists) throw notFound("Duplicate");
    if (dup.get("status") !== "open") throw conflict(`Duplicate is already ${dup.get("status")}`);
    tx.update(ref, { status: "dismissed", resolvedBy: actor, reason });
    await writeAudit({ eventId, actor, action: "duplicate.dismiss", target: dupId, reason }, tx);
  });
}
