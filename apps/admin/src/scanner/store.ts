import { doc, getDocFromServer, setDoc } from "firebase/firestore";
import { CHAIN_GENESIS, computeEntryHash } from "@hackos/shared/crypto";
import { api } from "../api/client";
import { db as firestore } from "../firebase";
import { getMeta, metaKey, sdb, setMeta, type LogEntry } from "./db";
import type { RosterEntry } from "./verify";

// Roster sync and the tamper-evident check-in log (guide 6.4, 6.6, 6.7).

interface RosterResponse {
  eventId: string;
  rosterVersion: number;
  organizerPubKey: string;
  participants: RosterEntry[];
  revoked: string[];
  removed: string[];
}

async function fetchPhoto(url: string | null): Promise<Blob | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { mode: "cors" });
    return res.ok ? await res.blob() : undefined;
  } catch {
    return undefined; // the card shows initials instead
  }
}

/** Downloads changes since the last sync (or everything the first time), photos included. */
export async function syncRoster(eventId: string) {
  const since = (await getMeta<number>(metaKey(eventId, "rosterVersion"))) ?? 0;
  const r = await api<RosterResponse>(`/events/${eventId}/roster?since=${since}`);

  const existing = new Map(
    (await sdb.roster.where("eventId").equals(eventId).toArray()).map((e) => [e.participantId, e]),
  );
  const rows = await Promise.all(
    r.participants.map(async (p) => {
      const prev = existing.get(p.participantId);
      // Keep a check-in made on this phone even if the server hasn't seen it yet.
      const checkedInAt = p.checkedInAt ?? prev?.checkedInAt ?? null;
      const photo = prev?.photo && prev.photoUrl === p.photoUrl ? prev.photo : await fetchPhoto(p.photoUrl);
      return { ...p, checkedInAt, photo, eventId };
    }),
  );
  await sdb.transaction("rw", sdb.roster, sdb.meta, async () => {
    if (r.removed.length) await sdb.roster.bulkDelete(r.removed.map((id) => [eventId, id] as [string, string]));
    await sdb.roster.bulkPut(rows);
    await setMeta(metaKey(eventId, "rosterVersion"), r.rosterVersion);
    await setMeta(metaKey(eventId, "organizerPubKey"), r.organizerPubKey);
    await setMeta(metaKey(eventId, "lastSync"), new Date().toISOString());
  });
  return { version: r.rosterVersion, changed: rows.length, removed: r.removed.length };
}

export async function loadRoster(eventId: string) {
  const rows = await sdb.roster.where("eventId").equals(eventId).toArray();
  return new Map(rows.map((r) => [r.participantId, r]));
}

/**
 * Appends one attempt to this phone's hash chain, then writes it to Firestore.
 * With offline persistence the write is queued and uploads when the internet
 * returns; `synced` flips once the server confirms it.
 */
export async function appendLog(
  partial: Omit<LogEntry, "id" | "prevHash" | "entryHash" | "synced">,
): Promise<LogEntry> {
  const chainKey = metaKey(partial.eventId, `lastHash:${partial.deviceId}`);
  const entry = await sdb.transaction("rw", sdb.log, sdb.meta, async () => {
    const prevHash = (await getMeta<string>(chainKey)) ?? CHAIN_GENESIS;
    const id = crypto.randomUUID();
    const { name, ...rest } = partial;
    const body = { id, ...rest, prevHash };
    const entryHash = await computeEntryHash(body);
    const full: LogEntry = { ...body, entryHash, synced: 0, name };
    await sdb.log.add(full);
    await setMeta(chainKey, entryHash);
    return full;
  });

  const { id, eventId, synced: _s, name: _n, ...fields } = entry;
  // Only the fields the rules allow; undefined optional fields are left out.
  const docData = Object.fromEntries(
    Object.entries({ ...fields, processed: false, flagged: false }).filter(([, v]) => v !== undefined),
  );
  setDoc(doc(firestore, "events", eventId, "checkins", id), docData)
    .then(() => sdb.log.update(id, { synced: 1 }))
    .catch((e) => console.error("[scanner] check-in write failed", e));
  return entry;
}

/** After a reload, confirms which queued entries the server now has. */
export async function confirmSynced(eventId: string) {
  if (!navigator.onLine) return 0;
  const pending = await sdb.log.where("eventId").equals(eventId).filter((e) => e.synced === 0).toArray();
  let confirmed = 0;
  for (const e of pending) {
    try {
      const snap = await getDocFromServer(doc(firestore, "events", eventId, "checkins", e.id));
      if (snap.exists()) {
        await sdb.log.update(e.id, { synced: 1 });
        confirmed++;
      }
    } catch {
      break; // offline again
    }
  }
  return confirmed;
}

/** Emergency backup (guide section 8): the whole local log as a JSON file. */
export async function exportLog(eventId: string) {
  const rows = await sdb.log.where("eventId").equals(eventId).sortBy("ts");
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `checkin-log-${eventId}-${new Date().toISOString().slice(0, 16)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
