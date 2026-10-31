import Dexie, { type Table } from "dexie";
import type { CheckinMethod, CheckinRejectReason, CheckinResult } from "@hackos/shared";
import type { RosterEntry } from "./verify";

// Scanner storage on the volunteer's phone (Samrat's guide 5.3). IndexedDB via
// Dexie, so the roster (with photos) and the log survive going offline,
// reloading and restarting the phone.

export interface LogEntry {
  id: string;
  eventId: string;
  participantId: string;
  deviceId: string;
  volunteerUid: string;
  ts: string;
  method: CheckinMethod;
  result: CheckinResult;
  rejectReason?: CheckinRejectReason;
  overrideNote?: string;
  prevHash: string;
  entryHash: string;
  /** 1 once the server has the check-in. */
  synced: 0 | 1;
  /** Shown on the log screen; not uploaded. */
  name?: string;
}

export interface Meta {
  key: string;
  value: unknown;
}

class ScannerDB extends Dexie {
  roster!: Table<RosterEntry & { eventId: string }, [string, string]>;
  log!: Table<LogEntry, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super("hackos-scanner");
    this.version(1).stores({
      roster: "[eventId+participantId], eventId, teamId",
      log: "id, eventId, synced, ts, participantId",
      meta: "key",
    });
  }
}

export const sdb = new ScannerDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await sdb.meta.get(key))?.value as T | undefined;
}
export const setMeta = (key: string, value: unknown) => sdb.meta.put({ key, value });

/** Keys are per event so one phone can serve two events without mixing them. */
export const metaKey = (eventId: string, name: string) => `${eventId}:${name}`;

/** Ask the browser not to clear our storage under pressure (guide section 8). */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
