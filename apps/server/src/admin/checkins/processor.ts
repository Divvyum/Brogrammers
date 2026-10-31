import { Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { PARTICIPANT_STATUSES } from "@hackos/shared";
import { CHAIN_GENESIS, computeEntryHash, type ChainEntryBody } from "@hackos/shared/crypto";
import { writeAudit } from "../../core/audit.js";
import { col } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { enqueue } from "../../core/outbox.js";
import { stats } from "../../core/stats.js";

// Check-in processor (plan D14, Samrat's guide 6.7). Volunteer devices write
// check-ins straight to events/{id}/checkins/{uuid} with processed=false;
// Firestore offline persistence uploads them when the internet returns. The
// server then verifies each device's hash chain and decides the official check-in.

/** How long to wait for a missing earlier entry to upload before calling the chain broken. */
export const CHAIN_WAIT_MS = 10 * 60_000;

const statusIndex = (s: string) => PARTICIPANT_STATUSES.indexOf(s as (typeof PARTICIPANT_STATUSES)[number]);

function bodyOf(eventId: string, d: QueryDocumentSnapshot): ChainEntryBody {
  return {
    id: d.id,
    eventId,
    participantId: d.get("participantId"),
    deviceId: d.get("deviceId"),
    volunteerUid: d.get("volunteerUid"),
    ts: d.get("ts"),
    method: d.get("method"),
    result: d.get("result"),
    rejectReason: d.get("rejectReason") ?? undefined,
    overrideNote: d.get("overrideNote") ?? undefined,
    prevHash: d.get("prevHash"),
  };
}

/**
 * Verifies one device's whole log. Each entry is "ok" if its hash is right and
 * the links from GENESIS reach it, "broken" if not, or "wait" if an earlier
 * entry simply hasn't uploaded yet.
 */
export async function verifyDeviceChain(eventId: string, docs: QueryDocumentSnapshot[], now = Date.now()) {
  const verdict = new Map<string, "ok" | "broken" | "wait">();
  const hashOk = new Map<string, boolean>();
  for (const d of docs) hashOk.set(d.id, (await computeEntryHash(bodyOf(eventId, d))) === d.get("entryHash"));

  const byPrev = new Map<string, QueryDocumentSnapshot[]>();
  for (const d of docs) byPrev.set(d.get("prevHash"), [...(byPrev.get(d.get("prevHash")) ?? []), d]);

  // Walk from GENESIS. A fork (two entries with the same prevHash) means tampering.
  let cursor = CHAIN_GENESIS;
  for (;;) {
    const next = byPrev.get(cursor) ?? [];
    if (next.length !== 1 || !hashOk.get(next[0]!.id)) break;
    verdict.set(next[0]!.id, "ok");
    cursor = next[0]!.get("entryHash");
  }

  const storedHashes = new Set(docs.map((d) => d.get("entryHash")));
  for (const d of docs) {
    if (verdict.has(d.id)) continue;
    const predecessorMissing = d.get("prevHash") !== CHAIN_GENESIS && !storedHashes.has(d.get("prevHash"));
    const age = now - (d.createTime?.toMillis() ?? 0);
    verdict.set(d.id, hashOk.get(d.id) && predecessorMissing && age < CHAIN_WAIT_MS ? "wait" : "broken");
  }
  return verdict;
}

export interface ProcessResult {
  processed: number;
  official: number;
  duplicates: number;
  broken: number;
  waiting: number;
}

/** Applies one chain-verified "valid" entry to the participant, earliest timestamp wins. */
async function applyValid(eventId: string, d: QueryDocumentSnapshot) {
  const pRef = col(eventId, "participants").doc(d.get("participantId"));
  const entryTs = Timestamp.fromDate(new Date(d.get("ts")));

  return db.runTransaction(async (tx) => {
    const p = await tx.get(pRef);
    if (!p.exists) {
      tx.update(d.ref, { processed: true, chain: "ok", flagged: true, serverResult: "rejected" });
      return { kind: "unknown" as const };
    }
    const officialId = p.get("checkinId") as string | undefined;
    const officialTs = p.get("checkedInAt") as Timestamp | undefined;
    const isEarlier = !officialTs || entryTs.toMillis() < officialTs.toMillis();

    if (officialId === d.id) {
      tx.update(d.ref, { processed: true, chain: "ok" });
      return { kind: "noop" as const };
    }
    if (!isEarlier) {
      tx.update(d.ref, { processed: true, chain: "ok", flagged: true, serverResult: "duplicate" });
      return { kind: "duplicate" as const };
    }

    // This entry becomes official; an existing later one is demoted to a flagged duplicate.
    const update: Record<string, unknown> = { checkedInAt: entryTs, checkinId: d.id };
    const room = p.get("roomId");
    const target = room ? "room_assigned" : "checked_in";
    if (statusIndex(p.get("status")) < statusIndex(target) && p.get("status") !== "rejected") update.status = target;
    tx.update(pRef, update);
    tx.update(d.ref, { processed: true, chain: "ok", flagged: false, serverResult: "official" });
    if (officialId) {
      tx.update(col(eventId, "checkins").doc(officialId), { flagged: true, serverResult: "duplicate" });
    }
    return {
      kind: officialId ? ("replaced" as const) : ("first" as const),
      uid: p.id,
      slotId: p.get("slotId") as string | undefined,
      seat: p.get("seat") as string | undefined,
      roomId: room as string | undefined,
    };
  });
}

/** Processes every pending check-in across all events. Safe to run concurrently with itself. */
export async function processPending(limit = 500): Promise<ProcessResult> {
  const out: ProcessResult = { processed: 0, official: 0, duplicates: 0, broken: 0, waiting: 0 };
  const pending = await db.collectionGroup("checkins").where("processed", "==", false).limit(limit).get();
  if (pending.empty) return out;

  // Group by event + device: a chain belongs to one device.
  const groups = new Map<string, { eventId: string; deviceId: string }>();
  for (const d of pending.docs) {
    const eventId = d.ref.parent.parent!.id;
    groups.set(`${eventId}/${d.get("deviceId")}`, { eventId, deviceId: d.get("deviceId") });
  }

  for (const { eventId, deviceId } of groups.values()) {
    const all = await col(eventId, "checkins").where("deviceId", "==", deviceId).get();
    const verdict = await verifyDeviceChain(eventId, all.docs);
    const mine = all.docs.filter((d) => d.get("processed") === false).sort((a, b) => a.get("ts").localeCompare(b.get("ts")));

    for (const d of mine) {
      const v = verdict.get(d.id);
      if (v === "wait") {
        out.waiting++;
        continue;
      }
      out.processed++;
      if (v === "broken") {
        await d.ref.update({ processed: true, chain: "broken", flagged: true, serverResult: "broken" });
        out.broken++;
        continue;
      }

      if (d.get("method") !== "qr") {
        await writeAudit({
          eventId,
          actor: d.get("volunteerUid"),
          action: `checkin.${d.get("method")}`,
          target: d.get("participantId"),
          after: { checkinId: d.id, result: d.get("result") },
          reason: d.get("overrideNote") ?? undefined,
        });
      }

      const result = d.get("result");
      if (result === "rejected") {
        await d.ref.update({ processed: true, chain: "ok", serverResult: "rejected" });
        continue;
      }
      if (result === "duplicate") {
        await d.ref.update({ processed: true, chain: "ok", flagged: true, serverResult: "duplicate" });
        out.duplicates++;
        continue;
      }

      const applied = await applyValid(eventId, d);
      if (applied.kind === "duplicate" || applied.kind === "unknown") out.duplicates++;
      if (applied.kind === "replaced") out.duplicates++;
      if (applied.kind === "first") {
        out.official++;
        stats.inc(eventId, "checkedIn");
        if (applied.slotId) stats.inc(eventId, `arrivedBySlot.${applied.slotId}.arrived`);
        const roomName = applied.roomId
          ? ((await col(eventId, "rooms").doc(applied.roomId).get()).get("name") as string)
          : "";
        await enqueue({
          channel: "whatsapp",
          uid: applied.uid,
          template: "checkin_welcome",
          vars: { room: roomName, seat: applied.seat ?? "" },
          dedupeKey: `checkin_welcome_${eventId}`,
          eventId,
        });
      }
      if (applied.kind === "replaced") out.official++;
    }
  }
  return out;
}

let running: Promise<unknown> | null = null;
let again = false;

/** Runs processPending, coalescing calls that arrive while it's already running. */
export function scheduleProcessing(): void {
  if (running) {
    again = true;
    return;
  }
  running = processPending()
    .catch((e) => console.error("[checkins] processing failed", e))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        scheduleProcessing();
      }
    });
}

/** Server-side listener on pending check-ins (replaces a Firestore-triggered function). */
export function startCheckinListener(): () => void {
  return db
    .collectionGroup("checkins")
    .where("processed", "==", false)
    .limit(1)
    .onSnapshot(
      (snap) => {
        if (!snap.empty) scheduleProcessing();
      },
      (err) => console.error("[checkins] listener error", err),
    );
}
