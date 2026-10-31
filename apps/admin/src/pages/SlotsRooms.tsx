import { useMemo, useState } from "react";
import { DataTable, DateTimeInput, Dialog, Field, Loader, PageIntro, Panel, ReasonDialog } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useAllPages, useApi } from "../lib/hooks";
import { fmtDate, fmtTime } from "../lib/format";
import type { ParticipantRow } from "./Participants";

// Slots and rooms (plan A11): slot editor, room editor, "Run allotment" with a
// summary, the room board (move people between rooms with a reason), and the
// rebalance log.

interface Slot extends Record<string, unknown> {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  booked: number;
  rebalancedAt?: string;
}
interface Room extends Record<string, unknown> {
  id: string;
  name: string;
  floor: string;
  capacity: number;
  occupied: number;
  track?: string;
  mentorDesk: boolean;
}
interface AllotResult {
  assigned: number;
  groups: number;
  unassigned: { teamId?: string; uids: string[]; reason: string }[];
  capacityViolations: number;
}

export function SlotsRooms() {
  const { base, event } = useEvent();
  const slots = useApi<{ items: Slot[] }>(base ? `${base}/slots` : null);
  const rooms = useApi<{ items: Room[] }>(base ? `${base}/rooms` : null);
  const log = useApi<{ items: { id: string; action: string; ts: string; after: Record<string, unknown> }[] }>(base ? `${base}/audit?action=allotment.rebalance&limit=10` : null);
  const { run, busy } = useAction();
  const [slotEdit, setSlotEdit] = useState<Partial<Slot> | null>(null);
  const [roomEdit, setRoomEdit] = useState<Partial<Room> | null>(null);
  const [result, setResult] = useState<AllotResult | null>(null);
  const [boardRoom, setBoardRoom] = useState<string | null>(null);

  return (
    <div>
      <PageIntro
        eyebrow="ARRIVAL PLANNING"
        title="Slots & rooms"
        subtitle="Teams are kept together and placed near their track's mentor desk. Checked-in people keep their seats."
        actions={
          <>
            <button className="secondary" disabled={busy} onClick={() => run<{ released: number; seated: number }>("POST", `${base}/allotment/rebalance`, {}, (r) => `Released ${r.released} no-show seats, seated ${r.seated} late arrivals`)}>
              Rebalance now
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                const r = await run<AllotResult>("POST", `${base}/allotment/run`, {}, "Allotment done");
                if (r) setResult(r);
              }}
            >
              Run allotment
            </button>
          </>
        }
      />
      {result && (
        <div className={result.unassigned.length || result.capacityViolations ? "notice" : "notice good"}>
          <span>
            Seated {result.assigned} people in {result.groups} groups · {result.capacityViolations} capacity violations ·{" "}
            {result.unassigned.length ? `${result.unassigned.length} groups not placed: ${result.unassigned.map((u) => `${u.teamId ?? u.uids[0]} (${u.reason})`).join("; ")}` : "everyone placed"}
          </span>
          <button onClick={() => setResult(null)}>×</button>
        </div>
      )}

      <div className="split-panels">
        <Panel title="Arrival slots" actions={<button className="secondary" onClick={() => setSlotEdit({ capacity: 40, startAt: event?.startAt, endAt: event?.startAt })}>+ Slot</button>}>
          <Loader query={slots}>
            {(d) => (
              <DataTable
                rows={d.items}
                onRow={setSlotEdit}
                columns={[
                  { key: "startAt", label: "Starts", render: (r) => fmtDate(r.startAt) },
                  { key: "endAt", label: "Ends", render: (r) => fmtTime(r.endAt) },
                  { key: "booked", label: "Booked", render: (r) => `${r.booked} / ${r.capacity}` },
                  { key: "rebalancedAt", label: "Rebalanced", render: (r) => (r.rebalancedAt ? fmtTime(r.rebalancedAt) : "—") },
                ]}
              />
            )}
          </Loader>
        </Panel>
        <Panel title="Rooms" actions={<button className="secondary" onClick={() => setRoomEdit({ capacity: 24, floor: "", mentorDesk: false })}>+ Room</button>}>
          <Loader query={rooms}>
            {(d) => (
              <DataTable
                rows={d.items}
                onRow={setRoomEdit}
                columns={[
                  { key: "name", label: "Room" },
                  { key: "floor", label: "Floor" },
                  { key: "track", label: "Track" },
                  { key: "occupied", label: "Seats", render: (r) => `${r.occupied} / ${r.capacity}` },
                  { key: "mentorDesk", label: "Mentor desk" },
                ]}
              />
            )}
          </Loader>
        </Panel>
      </div>

      <Panel title="Room board" actions={<span className="hint">Click a room to see who's in it and move people.</span>}>
        <div className="room-grid">
          {(rooms.data?.items ?? []).map((r) => {
            const ratio = r.capacity ? r.occupied / r.capacity : 0;
            return (
              <button key={r.id} className={`room-tile ${ratio >= 1 ? "full" : ratio >= 0.85 ? "near" : ""}`} onClick={() => setBoardRoom(r.id)}>
                <b>{r.name}</b>
                <span>
                  {r.occupied}/{r.capacity} {r.track && `· ${r.track}`} {r.mentorDesk && "· desk"}
                </span>
                <div className="bar">
                  <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Rebalance log">
        <Loader query={log}>
          {(d) => (
            <DataTable
              rows={d.items}
              empty="No rebalances yet. They run 30 minutes after each slot ends."
              columns={[
                { key: "ts", label: "When", render: (r) => fmtDate(r.ts) },
                { key: "after", label: "Result", render: (r) => `released ${String(r.after?.released ?? 0)}, seated ${String(r.after?.seated ?? 0)}` },
              ]}
            />
          )}
        </Loader>
      </Panel>

      {slotEdit && <SlotDialog slot={slotEdit} onClose={() => setSlotEdit(null)} />}
      {roomEdit && <RoomDialog room={roomEdit} onClose={() => setRoomEdit(null)} />}
      {boardRoom && <RoomPeople roomId={boardRoom} rooms={rooms.data?.items ?? []} onClose={() => setBoardRoom(null)} />}
    </div>
  );
}

function SlotDialog({ slot, onClose }: { slot: Partial<Slot>; onClose: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const [s, setS] = useState({ startAt: slot.startAt ?? "", endAt: slot.endAt ?? "", capacity: slot.capacity ?? 40 });
  const save = async () => {
    const ok = slot.id ? await run("PATCH", `${base}/slots/${slot.id}`, s, "Slot saved") : await run("POST", `${base}/slots`, s, "Slot added");
    if (ok) onClose();
  };
  return (
    <Dialog title={slot.id ? "Edit slot" : "New arrival slot"} onClose={onClose}>
      <Field label="Starts">
        <DateTimeInput value={s.startAt} onChange={(v) => setS({ ...s, startAt: v })} />
      </Field>
      <Field label="Ends">
        <DateTimeInput value={s.endAt} onChange={(v) => setS({ ...s, endAt: v })} />
      </Field>
      <Field label="Capacity">
        <input type="number" min={0} value={s.capacity} onChange={(e) => setS({ ...s, capacity: Number(e.target.value) })} />
      </Field>
      <div className="dialog-actions">
        {slot.id && (
          <button className="secondary danger-text" disabled={busy} onClick={async () => (await run("DELETE", `${base}/slots/${slot.id}`, undefined, "Slot deleted")) && onClose()}>
            Delete
          </button>
        )}
        <button className="primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

function RoomDialog({ room, onClose }: { room: Partial<Room>; onClose: () => void }) {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const [r, setR] = useState({ name: room.name ?? "", floor: room.floor ?? "", capacity: room.capacity ?? 24, track: room.track ?? "", mentorDesk: room.mentorDesk ?? false });
  const body = { ...r, track: r.track || undefined };
  const save = async () => {
    const ok = room.id ? await run("PATCH", `${base}/rooms/${room.id}`, body, "Room saved") : await run("POST", `${base}/rooms`, body, "Room added");
    if (ok) onClose();
  };
  return (
    <Dialog title={room.id ? `Edit ${room.name}` : "New room"} onClose={onClose}>
      <Field label="Name">
        <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      </Field>
      <Field label="Floor">
        <input value={r.floor} onChange={(e) => setR({ ...r, floor: e.target.value })} />
      </Field>
      <Field label="Seats">
        <input type="number" min={0} value={r.capacity} onChange={(e) => setR({ ...r, capacity: Number(e.target.value) })} />
      </Field>
      <Field label="Track">
        <select value={r.track} onChange={(e) => setR({ ...r, track: e.target.value })}>
          <option value="">Any</option>
          {event?.tracks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={r.mentorDesk} onChange={(e) => setR({ ...r, mentorDesk: e.target.checked })} /> Mentor desk in this room
      </label>
      <div className="dialog-actions">
        {room.id && (
          <button className="secondary danger-text" disabled={busy} onClick={async () => (await run("DELETE", `${base}/rooms/${room.id}`, undefined, "Room deleted")) && onClose()}>
            Delete
          </button>
        )}
        <button className="primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

function RoomPeople({ roomId, rooms, onClose }: { roomId: string; rooms: Room[]; onClose: () => void }) {
  const { base } = useEvent();
  // The participant API has no room filter; the board loads everyone once (cached).
  const everyone = useAllPages<ParticipantRow>(`${base}/participants`);
  const inRoom = useMemo(
    () =>
      (everyone.data ?? [])
        .filter((p) => p.roomId === roomId)
        .sort((a, b) => String(a.seat).localeCompare(String(b.seat), undefined, { numeric: true })),
    [everyone.data, roomId],
  );
  const { run, busy } = useAction();
  const [move, setMove] = useState<{ uid: string; name: string; to: string } | null>(null);
  const room = rooms.find((r) => r.id === roomId);

  return (
    <Dialog title={`${room?.name ?? roomId} · ${room?.occupied ?? "?"}/${room?.capacity ?? "?"}`} onClose={onClose}>
      {everyone.isLoading && <p className="hint">Loading…</p>}
      <ul className="member-list scroll">
        {inRoom.map((p) => (
          <li key={p.id}>
            <span>
              <b>{p.seat}</b> {p.name} <small className="muted">{p.teamId ?? "solo"}</small>
            </span>
            <select value="" onChange={(e) => e.target.value && setMove({ uid: p.id, name: p.name, to: e.target.value })}>
              <option value="">Move to…</option>
              {rooms
                .filter((r) => r.id !== roomId)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={r.occupied >= r.capacity}>
                    {r.name} ({r.occupied}/{r.capacity})
                  </option>
                ))}
            </select>
          </li>
        ))}
        {!everyone.isLoading && inRoom.length === 0 && <li className="hint">Nobody seated here yet.</li>}
      </ul>
      {move && (
        <ReasonDialog
          title={`Move ${move.name}`}
          description={`To ${rooms.find((r) => r.id === move.to)?.name}. They get the next free seat.`}
          busy={busy}
          onClose={() => setMove(null)}
          onConfirm={(reason) => run("POST", `${base}/participants/${move.uid}/move`, { roomId: move.to, reason }, "Moved")}
        />
      )}
    </Dialog>
  );
}
