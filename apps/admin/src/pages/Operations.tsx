import { useState } from "react";
import { DataTable, DateTimeInput, Dialog, Field, Loader, PageIntro, Panel, StatCard, Status } from "../components/common";
import { QrCamera } from "../components/Qr";
import { useSession } from "../auth/Session";
import { api, ApiError } from "../api/client";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate, fmtTime } from "../lib/format";

// Volunteer operations (plan A20). Organizers: task board (assign, shifts),
// tickets, meals. Volunteers: my tasks, help-desk tickets, the food counter.

interface Task extends Record<string, unknown> {
  id: string;
  title: string;
  assignedTo?: string;
  shift?: string;
  dueAt?: string;
  status: "todo" | "in_progress" | "done";
  notes?: string;
}
interface Ticket extends Record<string, unknown> {
  id: string;
  createdBy: string;
  roomId?: string;
  text: string;
  assignedTo?: string;
  status: string;
  createdAt?: string;
  resolution?: string;
}

const COLUMNS: Task["status"][] = ["todo", "in_progress", "done"];

function TaskBoard({ tasks, canAssign, volunteers }: { tasks: Task[]; canAssign: boolean; volunteers: { uid: string; name: string }[] }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const name = (uid?: string) => volunteers.find((v) => v.uid === uid)?.name ?? uid ?? "Unassigned";
  return (
    <div className="board">
      {COLUMNS.map((col) => (
        <div key={col} className="board-col">
          <h4>
            {col.replace("_", " ")} <small>{tasks.filter((t) => t.status === col).length}</small>
          </h4>
          {tasks
            .filter((t) => t.status === col)
            .map((t) => (
              <div key={t.id} className="task-card">
                <b>{t.title}</b>
                <small className="muted">
                  {t.shift ? `${t.shift} · ` : ""}
                  {t.dueAt ? `due ${fmtTime(t.dueAt)}` : "no due time"}
                </small>
                {canAssign ? (
                  <select value={t.assignedTo ?? ""} onChange={(e) => run("PATCH", `${base}/tasks/${t.id}`, { assignedTo: e.target.value }, "Assigned")}>
                    <option value="">Unassigned</option>
                    {volunteers.map((v) => (
                      <option key={v.uid} value={v.uid}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <small>{name(t.assignedTo)}</small>
                )}
                <div className="button-row">
                  {COLUMNS.filter((c) => c !== col).map((c) => (
                    <button key={c} className="text-button" disabled={busy} onClick={() => run("PATCH", `${base}/tasks/${t.id}`, { status: c })}>
                      → {c.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Tickets({ volunteerUid }: { volunteerUid?: string }) {
  const { base } = useEvent();
  const [status, setStatus] = useState("open");
  const list = useApi<{ items: Ticket[] }>(base ? `${base}/tickets${status ? `?status=${status}` : ""}` : null, { refetchInterval: 30_000 });
  const { run, busy } = useAction();
  const [resolve, setResolve] = useState<Ticket | null>(null);
  const [text, setText] = useState("");
  return (
    <Panel
      title="Help desk"
      actions={
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="assigned">Claimed</option>
          <option value="resolved">Resolved</option>
          <option value="">All</option>
        </select>
      }
    >
      <Loader query={list}>
        {(d) => (
          <DataTable
            rows={d.items}
            empty="No tickets."
            columns={[
              { key: "createdAt", label: "Raised", render: (r) => fmtDate(r.createdAt) },
              { key: "text", label: "Problem" },
              { key: "roomId", label: "Room" },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
              {
                key: "act",
                label: "",
                render: (r) => (
                  <div className="button-row">
                    {r.status === "open" && volunteerUid && (
                      <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/tickets/${r.id}/assign`, { assignedTo: volunteerUid }, "Claimed")}>
                        Claim
                      </button>
                    )}
                    {r.status === "assigned" && (!volunteerUid || r.assignedTo === volunteerUid) && (
                      <button className="primary" onClick={() => setResolve(r)}>
                        Resolve
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Loader>
      {resolve && (
        <Dialog title="Resolve ticket" onClose={() => setResolve(null)}>
          <p className="muted">{resolve.text}</p>
          <Field label="What was done">
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="dialog-actions">
            <button className="primary" disabled={busy || !text.trim()} onClick={async () => (await run("POST", `${base}/tickets/${resolve.id}/resolve`, { resolution: text }, "Resolved")) && (setResolve(null), setText(""))}>
              Mark resolved
            </button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

/** Organizer: task board, new tasks, tickets, meals. */
export function Operations() {
  const { base, event } = useEvent();
  const tasks = useApi<{ items: Task[] }>(base ? `${base}/tasks` : null);
  const staff = useApi<{ items: { uid: string; name: string; role: string }[] }>(event ? `/staff?eventId=${event.id}` : null);
  const { run, busy } = useAction();
  const [t, setT] = useState({ title: "", assignedTo: "", shift: "", dueAt: "" });
  const [meals, setMeals] = useState(false);
  const volunteers = (staff.data?.items ?? []).filter((s) => s.role === "volunteer");

  return (
    <div>
      <PageIntro
        eyebrow="EVENT DAY"
        title="Volunteer operations"
        subtitle="Volunteers get a WhatsApp reminder 30 minutes before a task is due."
        actions={
          <button className="secondary" onClick={() => setMeals(true)}>
            Meals & counters
          </button>
        }
      />
      <Panel title="New task">
        <form
          className="form-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("POST", `${base}/tasks`, { title: t.title, assignedTo: t.assignedTo || undefined, shift: t.shift || undefined, dueAt: t.dueAt || undefined }, "Task added");
            if (ok) setT({ title: "", assignedTo: "", shift: "", dueAt: "" });
          }}
        >
          <Field label="Task">
            <input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} required />
          </Field>
          <Field label="Volunteer">
            <select value={t.assignedTo} onChange={(e) => setT({ ...t, assignedTo: e.target.value })}>
              <option value="">Unassigned</option>
              {volunteers.map((v) => (
                <option key={v.uid} value={v.uid}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift">
            <input value={t.shift} onChange={(e) => setT({ ...t, shift: e.target.value })} placeholder="Morning" />
          </Field>
          <Field label="Due">
            <DateTimeInput value={t.dueAt} onChange={(v) => setT({ ...t, dueAt: v })} />
          </Field>
          <button className="primary" disabled={busy}>
            Add
          </button>
        </form>
      </Panel>
      <Loader query={tasks}>{(d) => <TaskBoard tasks={d.items} canAssign volunteers={volunteers} />}</Loader>
      <Tickets />
      <FoodStats />
      {meals && <MealsDialog onClose={() => setMeals(false)} />}
    </div>
  );
}

function FoodStats() {
  const { base } = useEvent();
  const stats = useApi<{ items: { mealId: string; name: string; claimed: number }[] }>(base ? `${base}/food/stats` : null, { refetchInterval: 30_000 });
  return (
    <Panel title="Food counter">
      <Loader query={stats}>
        {(d) => (
          <div className="stat-grid">
            {d.items.map((m) => (
              <StatCard key={m.mealId} label={m.name} value={m.claimed} foot="served" />
            ))}
            {d.items.length === 0 && <p className="hint">No meals configured.</p>}
          </div>
        )}
      </Loader>
    </Panel>
  );
}

function MealsDialog({ onClose }: { onClose: () => void }) {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const [meals, setMeals] = useState(event?.meals ?? []);
  const [counters, setCounters] = useState((event?.counters ?? []).join(", "));
  return (
    <Dialog title="Meals & counters" onClose={onClose}>
      {meals.map((m, i) => (
        <div key={i} className="inline-row">
          <input value={m.id} placeholder="id e.g. lunch-1" onChange={(e) => setMeals(meals.map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase() } : x)))} />
          <input value={m.name} placeholder="Name" onChange={(e) => setMeals(meals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <DateTimeInput value={m.startAt} onChange={(v) => setMeals(meals.map((x, j) => (j === i ? { ...x, startAt: v } : x)))} />
          <DateTimeInput value={m.endAt} onChange={(v) => setMeals(meals.map((x, j) => (j === i ? { ...x, endAt: v } : x)))} />
          <button className="text-button" onClick={() => setMeals(meals.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="secondary" onClick={() => setMeals([...meals, { id: "", name: "", startAt: event?.startAt ?? "", endAt: event?.startAt ?? "" }])}>
        + Meal
      </button>
      <Field label="Counters (comma separated)">
        <input value={counters} onChange={(e) => setCounters(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={async () =>
            (await run("PUT", `${base}/food/config`, { meals, counters: counters.split(",").map((s) => s.trim()).filter(Boolean) }, "Meals saved")) && onClose()
          }
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

/** Volunteer: my tasks and the help desk. */
export function MyWork() {
  const { base } = useEvent();
  const { user } = useSession();
  const tasks = useApi<{ items: Task[] }>(base ? `${base}/tasks` : null);
  return (
    <div>
      <PageIntro eyebrow="VOLUNTEER" title="Tasks & help desk" subtitle="Move your tasks along as you go. Claim a ticket before you head over." />
      <Loader query={tasks}>{(d) => <TaskBoard tasks={d.items} canAssign={false} volunteers={[]} />}</Loader>
      <Tickets volunteerUid={user?.uid} />
    </div>
  );
}

/** Volunteer: food counter scanner (rejects a second claim of the same meal). */
export function FoodCounter() {
  const { base, event } = useEvent();
  const meals = event?.meals ?? [];
  const [mealId, setMealId] = useState(() => {
    const now = Date.now();
    const current = meals.find((m) => new Date(m.startAt).getTime() - 30 * 60_000 <= now && now <= new Date(m.endAt).getTime() + 30 * 60_000);
    return current?.id ?? meals[0]?.id ?? "";
  });
  const [counter, setCounter] = useState(event?.counters?.[0] ?? "Counter");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async (token: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ name: string; meal: string }>(`${base}/food/scan`, { method: "POST", body: { token, mealId, counter } });
      setResult({ ok: true, text: `${r.name}: ${r.meal}. Enjoy!` });
      navigator.vibrate?.(80);
    } catch (e) {
      const err = e as ApiError;
      const when = (err.details as { claimedAt?: string; counter?: string } | undefined)?.claimedAt;
      setResult({ ok: false, text: `${err.message}${when ? ` (at ${fmtTime(when)}, ${(err.details as { counter?: string }).counter})` : ""}` });
      navigator.vibrate?.([60, 60, 60]);
    } finally {
      setBusy(false);
      setTimeout(() => setResult(null), 3500);
    }
  };

  return (
    <div className="food-counter">
      <PageIntro eyebrow="VOLUNTEER" title="Food counter" subtitle="Scan the food pass QR in the participant's app." />
      <div className="inline-row">
        <select value={mealId} onChange={(e) => setMealId(e.target.value)}>
          {meals.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={counter} onChange={(e) => setCounter(e.target.value)}>
          {(event?.counters?.length ? event.counters : ["Counter"]).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {!meals.length ? (
        <p className="hint">No meals configured yet. Ask an organizer.</p>
      ) : (
        <QrCamera onScan={scan} paused={busy || Boolean(result)} hint="Point at the food pass" />
      )}
      {result && <div className={`big-result ${result.ok ? "ok" : "bad"}`}>{result.ok ? "✓" : "✕"} {result.text}</div>}
    </div>
  );
}
