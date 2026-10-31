import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { writeAudit } from "../../core/audit.js";
import { col, eventRef } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, notFound } from "../../core/http.js";
import { stats } from "../../core/stats.js";
import { bumpRoster, bumpRosterTx } from "../digital-id/roster.js";

// Room allotment (plan D12).

export const REBALANCE_GRACE_MS = Number(process.env.REBALANCE_GRACE_MINUTES ?? 30) * 60_000;

interface RoomState {
  id: string;
  name: string;
  capacity: number;
  track?: string;
  mentorDesk: boolean;
  /** Seat numbers in use (1-based). */
  taken: Set<number>;
}

const free = (r: RoomState) => r.capacity - r.taken.size;
const seatLabel = (r: { name: string }, n: number) => `${r.name}-${n}`;

function nextSeat(r: RoomState): number {
  let n = 1;
  while (r.taken.has(n)) n++;
  r.taken.add(n);
  return n;
}

function seatNumber(seat: unknown): number | null {
  const m = typeof seat === "string" ? /-(\d+)$/.exec(seat) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Best room for a group: the track's mentor-desk room first, then other rooms of
 * that track, then rooms without a track, then any room. Within the same
 * preference, the tightest fit, so big rooms stay free for big teams.
 */
function pickRoom(rooms: RoomState[], size: number, track?: string): RoomState | undefined {
  const pref = (r: RoomState) => {
    if (track && r.track === track) return r.mentorDesk ? 0 : 1;
    return r.track ? 3 : 2;
  };
  return rooms
    .filter((r) => free(r) >= size)
    .sort((a, b) => pref(a) - pref(b) || free(a) - free(b) || a.name.localeCompare(b.name))[0];
}

const isActive = (p: DocumentSnapshot) =>
  !p.get("mergedInto") && !p.get("withdrawnAt") && p.get("status") !== "rejected";

function roomStates(rooms: DocumentSnapshot[]): RoomState[] {
  return rooms.map((r) => ({
    id: r.id,
    name: r.get("name"),
    capacity: r.get("capacity"),
    track: r.get("track") || undefined,
    mentorDesk: Boolean(r.get("mentorDesk")),
    taken: new Set(),
  }));
}

export interface AllotmentResult {
  assigned: number;
  groups: number;
  unassigned: { teamId?: string; uids: string[]; reason: string }[];
  capacityViolations: number;
  splitTeams: number;
}

/**
 * Full run. Slots in time order; each team is placed as one group, in the room of
 * its first member's slot, with seats for every active member. Participants who
 * are already checked in keep their seats.
 */
export async function runAllotment(eventId: string, actor: string): Promise<AllotmentResult> {
  const [roomSnap, slotSnap, partSnap, teamSnap] = await Promise.all([
    col(eventId, "rooms").get(),
    col(eventId, "slots").orderBy("startAt").get(),
    col(eventId, "participants").get(),
    col(eventId, "teams").get(),
  ]);
  const rooms = roomStates(roomSnap.docs);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const slotOrder = new Map(slotSnap.docs.map((s, i) => [s.id, i]));
  const teamTrack = new Map(teamSnap.docs.map((t) => [t.id, t.get("track") as string | undefined]));
  const participants = partSnap.docs.filter(isActive);

  // Checked-in participants keep their seats.
  for (const p of participants) {
    const room = roomById.get(p.get("roomId"));
    const n = seatNumber(p.get("seat"));
    if (p.get("checkedInAt") && room && n) room.taken.add(n);
  }

  // Groups: a team, or a solo participant. Only groups with at least one slot booking.
  const groups = new Map<string, DocumentSnapshot[]>();
  for (const p of participants) {
    if (p.get("checkedInAt")) continue;
    const key = p.get("teamId") ? `t:${p.get("teamId")}` : `u:${p.id}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const ordered = [...groups.entries()]
    .map(([key, members]) => {
      const slots = members.map((m) => slotOrder.get(m.get("slotId"))).filter((i) => i !== undefined);
      return { key, members, slot: slots.length ? Math.min(...slots) : Infinity };
    })
    .filter((g) => g.slot !== Infinity)
    .sort((a, b) => a.slot - b.slot || b.members.length - a.members.length);

  const result: AllotmentResult = { assigned: 0, groups: ordered.length, unassigned: [], capacityViolations: 0, splitTeams: 0 };
  const assignments = new Map<string, { roomId: string; seat: string } | null>();

  for (const g of ordered) {
    const teamId = g.key.startsWith("t:") ? g.key.slice(2) : undefined;
    const track = (teamId && teamTrack.get(teamId)) || g.members[0]!.get("track") || undefined;
    // A team member who is already checked in pins the team to their room.
    const pinned = teamId
      ? participants.find((p) => p.get("teamId") === teamId && p.get("checkedInAt") && p.get("roomId"))
      : undefined;
    const pinnedRoom = pinned ? roomById.get(pinned.get("roomId")) : undefined;
    const room = pinnedRoom && free(pinnedRoom) >= g.members.length ? pinnedRoom : pickRoom(rooms, g.members.length, track);
    if (!room) {
      result.unassigned.push({ teamId, uids: g.members.map((m) => m.id), reason: `No room with ${g.members.length} free seats` });
      for (const m of g.members) assignments.set(m.id, null);
      continue;
    }
    for (const m of g.members) {
      assignments.set(m.id, { roomId: room.id, seat: seatLabel(room, nextSeat(room)) });
      result.assigned++;
    }
  }

  // Write only what changed. Anyone not placed in this run (no slot booked,
  // merged, withdrawn) loses an old seat, except checked-in people, who keep theirs.
  const changed: string[] = [];
  const writer = db.bulkWriter();
  for (const p of partSnap.docs) {
    if (isActive(p) && p.get("checkedInAt")) continue;
    const a = assignments.get(p.id) ?? null;
    if (a?.roomId === p.get("roomId") && a?.seat === p.get("seat")) continue;
    if (!a && !p.get("roomId")) continue;
    writer.update(p.ref, a ? { roomId: a.roomId, seat: a.seat } : { roomId: FieldValue.delete(), seat: FieldValue.delete() });
    changed.push(p.id);
  }
  for (const r of rooms) {
    if (r.taken.size > r.capacity) result.capacityViolations++;
    writer.update(col(eventId, "rooms").doc(r.id), { occupied: r.taken.size });
  }
  await writer.close();
  if (changed.length) await bumpRoster(eventId, changed);

  await writeAudit({
    eventId,
    actor,
    action: "allotment.run",
    target: eventId,
    after: { assigned: result.assigned, unassigned: result.unassigned.length, changed: changed.length },
  });
  stats.recomputeSoon(eventId);
  return result;
}

/** Seat numbers in use in a room, read inside a transaction. */
async function takenSeats(tx: FirebaseFirestore.Transaction, eventId: string, roomId: string) {
  const snap = await tx.get(col(eventId, "participants").where("roomId", "==", roomId));
  return new Set(snap.docs.map((d) => seatNumber(d.get("seat"))).filter((n): n is number => n !== null));
}

/**
 * Late booking: seats one participant next to their team if there's room,
 * otherwise in the best room with a free seat. Manthan calls this after slot booking.
 */
export async function allotOne(eventId: string, uid: string): Promise<{ roomId: string; seat: string } | null> {
  const result = await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef(eventId));
    const p = await tx.get(col(eventId, "participants").doc(uid));
    if (!p.exists) throw notFound("Participant");
    if (p.get("roomId")) return { roomId: p.get("roomId") as string, seat: p.get("seat") as string, existing: true };

    const roomSnap = await tx.get(col(eventId, "rooms"));
    const rooms = roomStates(roomSnap.docs);
    for (const r of rooms) r.taken = await takenSeats(tx, eventId, r.id);

    let room: RoomState | undefined;
    const teamId = p.get("teamId");
    if (teamId) {
      const mates = await tx.get(col(eventId, "participants").where("teamId", "==", teamId));
      const mateRoom = mates.docs.map((m) => m.get("roomId")).find(Boolean);
      const r = rooms.find((x) => x.id === mateRoom);
      if (r && free(r) >= 1) room = r;
    }
    room ??= pickRoom(rooms, 1, p.get("track"));
    if (!room) return null;

    const seat = seatLabel(room, nextSeat(room));
    tx.update(p.ref, { roomId: room.id, seat });
    tx.update(col(eventId, "rooms").doc(room.id), { occupied: room.taken.size });
    bumpRosterTx(tx, eventSnap, [uid]);
    return { roomId: room.id, seat, existing: false };
  });
  if (result && !result.existing) {
    await writeAudit({ eventId, actor: "system", action: "allotment.incremental", target: uid, after: result });
    stats.recomputeSoon(eventId);
  }
  return result ? { roomId: result.roomId, seat: result.seat } : null;
}

/** Organizer moves someone to another room (reason required, audited). */
export async function moveParticipant(eventId: string, uid: string, roomId: string, actor: string, reason: string) {
  return db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef(eventId));
    const p = await tx.get(col(eventId, "participants").doc(uid));
    const target = await tx.get(col(eventId, "rooms").doc(roomId));
    if (!p.exists) throw notFound("Participant");
    if (!target.exists) throw notFound("Room");
    const fromId = p.get("roomId") as string | undefined;
    if (fromId === roomId) throw conflict("Already in this room");

    const taken = await takenSeats(tx, eventId, roomId);
    if (taken.size >= target.get("capacity")) throw conflict("Room is full");
    const fromTaken = fromId ? await takenSeats(tx, eventId, fromId) : null;

    const state: RoomState = { id: roomId, name: target.get("name"), capacity: target.get("capacity"), mentorDesk: false, taken };
    const seat = seatLabel(state, nextSeat(state));
    tx.update(p.ref, { roomId, seat });
    tx.update(target.ref, { occupied: taken.size });
    if (fromId && fromTaken) tx.update(col(eventId, "rooms").doc(fromId), { occupied: Math.max(0, fromTaken.size - 1) });
    bumpRosterTx(tx, eventSnap, [uid]);
    await writeAudit(
      {
        eventId,
        actor,
        action: "allotment.move",
        target: uid,
        before: { roomId: fromId ?? null, seat: p.get("seat") ?? null },
        after: { roomId, seat },
        reason,
      },
      tx,
    );
    return { roomId, seat };
  });
}

/**
 * After a slot ends (plus a grace period): frees seats of people from that slot
 * who never arrived, then seats late arrivals (checked in, no room) with their team.
 */
export async function rebalanceDueSlots(eventId: string, now = Date.now()) {
  const slots = await col(eventId, "slots").where("endAt", "<=", Timestamp.fromMillis(now - REBALANCE_GRACE_MS)).get();
  const due = slots.docs.filter((s) => !s.get("rebalancedAt"));
  const out = { slots: due.length, released: 0, seated: 0 };
  if (!due.length) return out;

  const changed: string[] = [];
  for (const slot of due) {
    const noShows = await col(eventId, "participants").where("slotId", "==", slot.id).get();
    const writer = db.bulkWriter();
    for (const p of noShows.docs) {
      if (p.get("checkedInAt") || !p.get("roomId")) continue;
      writer.update(p.ref, { roomId: FieldValue.delete(), seat: FieldValue.delete() });
      writer.update(col(eventId, "rooms").doc(p.get("roomId")), { occupied: FieldValue.increment(-1) });
      changed.push(p.id);
      out.released++;
    }
    writer.update(slot.ref, { rebalancedAt: FieldValue.serverTimestamp() });
    await writer.close();
  }

  const late = await col(eventId, "participants").where("checkedInAt", "!=", null).get();
  for (const p of late.docs) {
    if (p.get("roomId")) continue;
    const seated = await allotOne(eventId, p.id);
    if (seated) out.seated++;
  }

  if (changed.length) await bumpRoster(eventId, changed);
  await writeAudit({ eventId, actor: "system", action: "allotment.rebalance", target: eventId, after: out });
  stats.recomputeSoon(eventId);
  return out;
}
