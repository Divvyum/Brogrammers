import { useEffect, useState } from "react";
import { AudiencePicker, DateTimeInput, Dialog, Field, Loader, PageIntro, type Audience } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtTime } from "../lib/format";
import { api } from "../api/client";

// Schedule editor (plan A15): timeline view, create and edit sessions with an
// audience, and a "who will be notified" preview before saving.

interface Item {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  audience: Audience;
}

export function useRoomsAndTeams() {
  const { base } = useEvent();
  const rooms = useApi<{ items: { id: string; name: string }[] }>(base ? `${base}/rooms` : null);
  const teams = useApi<{ items: { id: string; name: string }[] }>(base ? `${base}/teams?limit=50` : null);
  return { rooms: rooms.data?.items ?? [], teams: teams.data?.items ?? [] };
}

export function audienceText(a: Audience) {
  return a.type === "all" ? "Everyone" : `${a.type}: ${a.ids.join(", ") || "none"}`;
}

export function AudienceCount({ audience, path }: { audience: Audience; path: string }) {
  const [count, setCount] = useState<number | null>(null);
  const empty = audience.type !== "all" && audience.ids.length === 0;
  useEffect(() => {
    if (empty) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ count: number }>(path, { method: "POST", body: { audience } })
        .then((r) => live && setCount(r.count))
        .catch(() => live && setCount(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [audience, path, empty]);
  const shown = empty ? 0 : count;
  return <span className="hint">{shown === null ? "Counting…" : `${shown} ${shown === 1 ? "person" : "people"} will be notified on WhatsApp.`}</span>;
}

export function Schedule() {
  const { base, event } = useEvent();
  const list = useApi<{ items: Item[] }>(base ? `${base}/schedule` : null);
  const [edit, setEdit] = useState<Partial<Item> | null>(null);

  const byDay = new Map<string, Item[]>();
  for (const i of list.data?.items ?? []) {
    const day = new Date(i.startAt).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
    byDay.set(day, [...(byDay.get(day) ?? []), i]);
  }

  return (
    <div>
      <PageIntro
        eyebrow="EVENT DAY"
        title="Schedule"
        subtitle="Changes notify only the people in the session's audience (old and new)."
        actions={
          <button className="primary" onClick={() => setEdit({ audience: { type: "all", ids: [] }, startAt: event?.startAt, endAt: event?.startAt })}>
            + Session
          </button>
        }
      />
      <Loader query={list}>
        {() => (
          <div className="timeline-days">
            {byDay.size === 0 && <p className="hint">No sessions yet.</p>}
            {[...byDay.entries()].map(([day, items]) => (
              <section key={day}>
                <h3 className="day-title">{day}</h3>
                {items.map((i) => (
                  <button key={i.id} className="session" onClick={() => setEdit(i)}>
                    <span className="session-time">
                      {fmtTime(i.startAt)}–{fmtTime(i.endAt)}
                    </span>
                    <span>
                      <b>{i.title}</b>
                      <small>
                        {i.location ?? "—"} · {audienceText(i.audience)}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </Loader>
      {edit && <SessionDialog item={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SessionDialog({ item, onClose }: { item: Partial<Item>; onClose: () => void }) {
  const { base } = useEvent();
  const { rooms, teams } = useRoomsAndTeams();
  const { run, busy } = useAction();
  const [s, setS] = useState({
    title: item.title ?? "",
    startAt: item.startAt ?? "",
    endAt: item.endAt ?? "",
    location: item.location ?? "",
    audience: item.audience ?? ({ type: "all", ids: [] } as Audience),
  });
  const body = { ...s, location: s.location || undefined };
  const save = async () => {
    const ok = item.id
      ? await run<{ notified: number }>("PATCH", `${base}/schedule/${item.id}`, body, (r) => `Saved · ${r.notified} people notified`)
      : await run<{ notified: number }>("POST", `${base}/schedule`, body, (r) => `Added · ${r.notified} people notified`);
    if (ok) onClose();
  };
  return (
    <Dialog title={item.id ? "Edit session" : "New session"} onClose={onClose}>
      <Field label="Title">
        <input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
      </Field>
      <div className="inline-row">
        <Field label="Starts">
          <DateTimeInput value={s.startAt} onChange={(v) => setS({ ...s, startAt: v })} />
        </Field>
        <Field label="Ends">
          <DateTimeInput value={s.endAt} onChange={(v) => setS({ ...s, endAt: v })} />
        </Field>
      </div>
      <Field label="Location">
        <input value={s.location} onChange={(e) => setS({ ...s, location: e.target.value })} />
      </Field>
      <Field label="Audience">
        <AudiencePicker value={s.audience} onChange={(audience) => setS({ ...s, audience })} rooms={rooms} teams={teams} />
      </Field>
      <AudienceCount audience={s.audience} path={`${base}/schedule/preview-audience`} />
      <div className="dialog-actions">
        {item.id && (
          <button className="secondary danger-text" disabled={busy} onClick={async () => (await run<{ notified: number }>("DELETE", `${base}/schedule/${item.id}`, undefined, (r) => `Cancelled · ${r.notified} people notified`)) && onClose()}>
            Cancel session
          </button>
        )}
        <button className="primary" disabled={busy || !s.title || !s.startAt || !s.endAt} onClick={save}>
          Save and notify
        </button>
      </div>
    </Dialog>
  );
}
