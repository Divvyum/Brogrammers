import { useMemo, useState } from "react";
import { DataTable, DateTimeInput, Dialog, Field, Loader, PageIntro, Panel, Status } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { useAction, useApi, useNow } from "../lib/hooks";
import { fmtDate, fmtTime } from "../lib/format";

// Mentors (plan A19). Organizers assign tracks and availability; a mentor sees
// their slot calendar, upcoming bookings, team progress and their notes.

interface MentorRow extends Record<string, unknown> {
  uid: string;
  name: string;
  tracks: string[];
  slots: number;
  booked: number;
}

interface Slot extends Record<string, unknown> {
  id: string;
  mentorUid: string;
  startAt: string;
  endAt: string;
  track?: string;
  teamId?: string;
  status: string;
  notes?: string;
}

/** Organizer view. */
export function Mentors() {
  const { base, event } = useEvent();
  const list = useApi<{ items: MentorRow[] }>(base ? `${base}/mentors` : null);
  const [edit, setEdit] = useState<MentorRow | null>(null);
  const [view, setView] = useState<string | null>(null);
  return (
    <div>
      <PageIntro eyebrow="EVENT DAY" title="Mentors" subtitle="Give each mentor a track and their available hours; slots are 15 minutes." />
      <Loader query={list}>
        {(d) => (
          <DataTable
            rows={d.items}
            rowKey={(r) => r.uid}
            onRow={(r) => setView(r.uid)}
            empty="No mentors yet. Add them on the Staff screen."
            columns={[
              { key: "name", label: "Mentor" },
              { key: "tracks", label: "Tracks", render: (r) => r.tracks.join(", ") || "—" },
              { key: "slots", label: "Slots" },
              { key: "booked", label: "Booked" },
              {
                key: "act",
                label: "",
                render: (r) => (
                  <button
                    className="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEdit(r);
                    }}
                  >
                    Tracks & hours
                  </button>
                ),
              },
            ]}
          />
        )}
      </Loader>
      {edit && <MentorSetup mentor={edit} tracks={event?.tracks ?? []} onClose={() => setEdit(null)} />}
      {view && (
        <Dialog title="Mentor calendar" onClose={() => setView(null)}>
          <MentorCalendar mentorUid={view} />
        </Dialog>
      )}
    </div>
  );
}

function MentorSetup({ mentor, tracks, onClose }: { mentor: MentorRow; tracks: string[]; onClose: () => void }) {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const [chosen, setChosen] = useState<string[]>(mentor.tracks);
  const [win, setWin] = useState({ startAt: event?.startAt ?? "", endAt: event?.startAt ?? "", slotMinutes: 15 });
  return (
    <Dialog title={mentor.name} onClose={onClose}>
      <Field label="Tracks">
        <div className="chip-list">
          {tracks.map((t) => (
            <button key={t} type="button" className={chosen.includes(t) ? "chip on" : "chip"} onClick={() => setChosen(chosen.includes(t) ? chosen.filter((x) => x !== t) : [...chosen, t])}>
              {t}
            </button>
          ))}
        </div>
      </Field>
      <button className="secondary" disabled={busy} onClick={() => run("PUT", `${base}/mentors/${mentor.uid}/tracks`, { tracks: chosen }, "Tracks saved")}>
        Save tracks
      </button>
      <h4>Add available hours</h4>
      <div className="inline-row">
        <Field label="From">
          <DateTimeInput value={win.startAt} onChange={(v) => setWin({ ...win, startAt: v })} />
        </Field>
        <Field label="To">
          <DateTimeInput value={win.endAt} onChange={(v) => setWin({ ...win, endAt: v })} />
        </Field>
        <Field label="Slot (min)">
          <input type="number" min={5} max={120} value={win.slotMinutes} onChange={(e) => setWin({ ...win, slotMinutes: Number(e.target.value) })} />
        </Field>
      </div>
      <button
        className="primary"
        disabled={busy || !win.startAt || win.endAt <= win.startAt}
        onClick={() =>
          run<{ created: number }>("POST", `${base}/mentors/${mentor.uid}/availability`, { windows: [{ startAt: win.startAt, endAt: win.endAt }], slotMinutes: win.slotMinutes }, (r) => `${r.created} slots added`)
        }
      >
        Create slots
      </button>
    </Dialog>
  );
}

function MentorCalendar({ mentorUid }: { mentorUid?: string }) {
  const { base } = useEvent();
  const slots = useApi<{ items: Slot[] }>(base ? `${base}/mentor-slots${mentorUid ? `?mentorUid=${mentorUid}` : ""}` : null);
  const [note, setNote] = useState<Slot | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const now = useNow(60_000);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data?.items ?? []) {
      const d = new Date(s.startAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [slots.data]);
  const upcoming = (slots.data?.items ?? []).filter((s) => s.status === "booked" && new Date(s.endAt).getTime() > now);

  return (
    <Loader query={slots}>
      {() => (
        <div>
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <h4>{day}</h4>
              <div className="slot-grid">
                {list.map((s) => (
                  <button key={s.id} className={`slot ${s.status}`} onClick={() => s.teamId && setNote(s)} title={s.notes ?? ""}>
                    <b>{fmtTime(s.startAt)}</b>
                    <small>{s.teamId ?? s.status}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {byDay.size === 0 && <p className="hint">No slots yet.</p>}
          {upcoming.length > 0 && (
            <>
              <h4>Upcoming bookings</h4>
              <ul className="member-list">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <span>
                      <b>{fmtDate(s.startAt)}</b> team {s.teamId}
                    </span>
                    <span className="button-row">
                      <button className="text-button" onClick={() => setTeam(s.teamId!)}>
                        Progress
                      </button>
                      <button className="text-button" onClick={() => setNote(s)}>
                        Notes
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {note && <NoteDialog slot={note} onClose={() => setNote(null)} onProgress={() => setTeam(note.teamId!)} />}
          {team && <TeamProgress teamId={team} onClose={() => setTeam(null)} />}
        </div>
      )}
    </Loader>
  );
}

function NoteDialog({ slot, onClose, onProgress }: { slot: Slot; onClose: () => void; onProgress: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const [notes, setNotes] = useState(slot.notes ?? "");
  return (
    <Dialog title={`Team ${slot.teamId} · ${fmtDate(slot.startAt)}`} onClose={onClose}>
      <Field label="Your notes for this team">
        <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button className="secondary" onClick={onProgress}>
          Team progress
        </button>
        <button className="primary" disabled={busy} onClick={async () => (await run("PATCH", `${base}/mentor-slots/${slot.id}/notes`, { notes }, "Notes saved")) && onClose()}>
          Save notes
        </button>
      </div>
    </Dialog>
  );
}

function TeamProgress({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { base } = useEvent();
  const q = useApi<{ progress: { id: string; text: string; createdAt: string }[]; mentorNotes: { slotId: string; startAt: string; notes: string; mentorUid: string }[] }>(`${base}/teams/${teamId}/progress`);
  return (
    <Dialog title={`Team ${teamId}: progress`} onClose={onClose}>
      <Loader query={q}>
        {(d) => (
          <>
            <h4>Updates from the team</h4>
            {d.progress.length === 0 && <p className="hint">No updates yet (participants post them during the event).</p>}
            <ul className="audit-list">
              {d.progress.map((p) => (
                <li key={p.id}>
                  <span className="muted">{fmtDate(p.createdAt)}</span> {p.text}
                </li>
              ))}
            </ul>
            <h4>Mentor notes</h4>
            {d.mentorNotes.length === 0 && <p className="hint">None yet.</p>}
            <ul className="audit-list">
              {d.mentorNotes.map((n) => (
                <li key={n.slotId}>
                  <span className="muted">{fmtDate(n.startAt)}</span> {n.notes}
                </li>
              ))}
            </ul>
          </>
        )}
      </Loader>
    </Dialog>
  );
}

/** The mentor's own home screen. */
export function MyMentoring() {
  const { user } = useSession();
  return (
    <div>
      <PageIntro eyebrow="MENTOR" title={`Hi ${user?.displayName ?? ""}`} subtitle="Your 15-minute slots. Tap a booked slot for notes and the team's progress." />
      <Panel>
        <MentorCalendar />
      </Panel>
      <p className="hint">
        <Status value="booked" /> booked · <Status value="open" /> free
      </p>
    </div>
  );
}
