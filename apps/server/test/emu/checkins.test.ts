import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { DOC } from "@hackos/shared";
import { CHAIN_GENESIS, computeEntryHash, type ChainEntryBody } from "@hackos/shared/crypto";
import { processPending } from "../../src/admin/checkins/processor.js";
import { col } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { stats } from "../../src/core/stats.js";
import { api, auditFor, bearer, eventBody, outboxFor, resetEmulators, tokenFor } from "./helpers.js";

// D14: check-in processor. Builds hash-chained logs exactly as the scanner will,
// writes them as the device's offline cache would on reconnect, then processes.

let E: string;
let org: string;

type Entry = ChainEntryBody & { entryHash: string };

/** A device's chained log. */
async function deviceLog(deviceId: string, items: { pid: string; ts: string; method?: "qr" | "manual" | "code"; result?: "valid" | "duplicate" | "rejected"; overrideNote?: string }[]) {
  const out: Entry[] = [];
  let prevHash = CHAIN_GENESIS;
  for (const [i, it] of items.entries()) {
    const body: ChainEntryBody = {
      id: `${deviceId}-${i}`,
      eventId: E,
      participantId: it.pid,
      deviceId,
      volunteerUid: `vol-${deviceId}`,
      ts: it.ts,
      method: it.method ?? "qr",
      result: it.result ?? "valid",
      overrideNote: it.overrideNote,
      prevHash,
    };
    const entryHash = await computeEntryHash(body);
    out.push({ ...body, entryHash });
    prevHash = entryHash;
  }
  return out;
}

/** What the scanner writes to Firestore (the doc ID is the entry ID; eventId is in the path). */
async function upload(entries: Entry[]) {
  for (const { id, eventId: _e, ...rest } of entries) {
    await col(E, "checkins").doc(id).set({ ...rest, processed: false, flagged: false });
  }
}

const p = async (uid: string) => (await col(E, "participants").doc(uid).get()).data()!;
const c = async (id: string) => (await col(E, "checkins").doc(id).get()).data()!;

beforeAll(async () => {
  await resetEmulators();
  const su = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  E = (await api().post("/api/admin/events").set(bearer(su)).send(eventBody())).body.id;
  org = await tokenFor("org1", { role: "organizer", eventId: E });
  await col(E, "rooms").doc("r1").set({ name: "A101", floor: "1", capacity: 10, mentorDesk: false, occupied: 3 });
  for (const uid of ["p1", "p2", "p3"]) {
    await col(E, "participants").doc(uid).set({
      name: uid,
      registeredAt: Timestamp.now(),
      status: "enrolled",
      rosterVersion: 1,
      roomId: "r1",
      seat: `A101-${uid.slice(1)}`,
      slotId: "s1",
    });
  }
  await stats.recompute(E);
});

describe("D14: check-in processor", () => {
  it("two devices check in the same person offline: one official record, one flagged", async () => {
    // Gate A checks in p1 at 10:05 and p2 at 10:06; it syncs first.
    const a = await deviceLog("gateA", [
      { pid: "p1", ts: "2026-11-07T10:05:00.000Z" },
      { pid: "p2", ts: "2026-11-07T10:06:00.000Z" },
    ]);
    await upload(a);
    expect(await processPending()).toMatchObject({ processed: 2, official: 2, broken: 0 });
    expect(await p("p1")).toMatchObject({ checkinId: "gateA-0", status: "room_assigned" });

    // Gate B checked p1 in earlier (10:00) but was offline longer; it syncs now.
    const b = await deviceLog("gateB", [{ pid: "p1", ts: "2026-11-07T10:00:00.000Z" }]);
    await upload(b);
    await processPending();

    expect((await p("p1")).checkinId).toBe("gateB-0"); // earliest wins
    expect(await c("gateB-0")).toMatchObject({ serverResult: "official", flagged: false, chain: "ok" });
    expect(await c("gateA-0")).toMatchObject({ serverResult: "duplicate", flagged: true });
    expect((await c("gateA-0")).result).toBe("valid"); // the device's own record is untouched

    const flagged = await api().get(`/api/admin/events/${E}/checkins?filter=flagged`).set(bearer(org));
    expect(flagged.body.items.map((x: { id: string }) => x.id)).toEqual(["gateA-0"]);
  });

  it("sends the welcome message once per person, with the room", async () => {
    const msgs = (await outboxFor("p1")).filter((m) => m.template === "checkin_welcome");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.vars).toEqual({ room: "A101", seat: "A101-1" });
  });

  it("re-uploading the same entries changes nothing (idempotent)", async () => {
    const before = await p("p1");
    expect(await processPending()).toMatchObject({ processed: 0 });
    expect(await p("p1")).toEqual(before);
  });

  it("an edited log entry is detected as a broken chain", async () => {
    const log = await deviceLog("gateC", [
      { pid: "p3", ts: "2026-11-07T11:00:00.000Z", result: "rejected" },
      { pid: "p3", ts: "2026-11-07T11:01:00.000Z" },
      { pid: "p2", ts: "2026-11-07T11:02:00.000Z", result: "duplicate" },
    ]);
    log[1] = { ...log[1]!, participantId: "p2" }; // someone edits the local log before sync
    await upload(log);
    const out = await processPending();
    expect(out.broken).toBe(2); // the edited entry and everything after it
    expect(await c("gateC-0")).toMatchObject({ chain: "ok", serverResult: "rejected" });
    expect(await c("gateC-1")).toMatchObject({ chain: "broken", flagged: true });
    expect(await c("gateC-2")).toMatchObject({ chain: "broken", flagged: true });
    expect((await p("p3")).checkinId).toBeUndefined(); // a broken entry never becomes official

    const broken = await api().get(`/api/admin/events/${E}/checkins?filter=broken`).set(bearer(org));
    expect(broken.body.items).toHaveLength(2);
  });

  it("waits for a missing earlier entry instead of calling it broken", async () => {
    const log = await deviceLog("gateD", [
      { pid: "p3", ts: "2026-11-07T12:00:00.000Z", result: "rejected" },
      { pid: "p3", ts: "2026-11-07T12:01:00.000Z" },
    ]);
    await upload([log[1]!]); // entry 1 uploads before entry 0
    expect(await processPending()).toMatchObject({ waiting: 1, processed: 0 });
    await upload([log[0]!]);
    expect(await processPending()).toMatchObject({ processed: 2, broken: 0 });
    expect((await p("p3")).checkinId).toBe("gateD-1");
  });

  it("manual check-ins are recorded in the audit log with the override note", async () => {
    await col(E, "participants").doc("p4").set({ name: "p4", registeredAt: Timestamp.now(), status: "enrolled", rosterVersion: 1 });
    const log = await deviceLog("gateE", [{ pid: "p4", ts: "2026-11-07T13:00:00.000Z", method: "manual", overrideNote: "Phone dead, checked college ID" }]);
    await upload(log);
    await processPending();
    expect((await p("p4")).status).toBe("checked_in");
    const [entry] = await auditFor(E, "checkin.manual");
    expect(entry).toMatchObject({ target: "p4", reason: "Phone dead, checked college ID" });
  });

  it("organizers resolve flagged check-ins", async () => {
    const res = await api().post(`/api/admin/events/${E}/checkins/gateA-0/resolve`).set(bearer(org)).send({ action: "made_official", reason: "Gate B clock was wrong" });
    expect(res.status).toBe(200);
    expect((await p("p1")).checkinId).toBe("gateA-0");
    expect(await c("gateB-0")).toMatchObject({ serverResult: "duplicate", flagged: true });

    const dismiss = await api().post(`/api/admin/events/${E}/checkins/gateB-0/resolve`).set(bearer(org)).send({ action: "dismissed", reason: "Known clock issue" });
    expect(dismiss.status).toBe(200);
    expect((await c("gateB-0")).flagged).toBe(false);
    expect(await auditFor(E, "checkin.made_official")).toHaveLength(1);
  });

  it("live stats count each person once", async () => {
    await stats.flushAll();
    const live = (await db.doc(DOC.liveStats(E)).get()).data()!;
    expect(live.checkedIn).toBe(4); // p1, p2, p3, p4
    expect(live.arrivedBySlot.s1.arrived).toBe(3); // p1, p2, p3 booked slot s1
  });
});
