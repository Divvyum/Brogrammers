import { useState } from "react";
import { DataTable, DateTimeInput, Dialog, Field, Loader, PageIntro, Pager } from "../components/common";
import { useEvent } from "../lib/event";
import { usePaged } from "../lib/hooks";
import { fmtDate } from "../lib/format";

// Audit log viewer (plan A26): filters (actor, action, target, date) and a
// before/after diff.

interface Entry extends Record<string, unknown> {
  id: string;
  actor: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ts: string;
}

/** Flattens nested objects to "a.b.c" keys for the diff. */
function flatten(v: unknown, prefix = "", out: Record<string, string> = {}) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = v === undefined ? "" : JSON.stringify(v);
  }
  return out;
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  if (!keys.length) return <p className="hint">No details recorded.</p>;
  return (
    <table className="diff">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className={b[k] === a[k] ? "" : "changed"}>
            <td>{k}</td>
            <td className="old">{b[k] ?? ""}</td>
            <td className="new">{a[k] ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditLog() {
  const { base } = useEvent();
  const [f, setF] = useState({ actor: "", action: "", target: "", from: "", to: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const list = usePaged<Entry>(base ? `${base}/audit${qs ? `?${qs}` : ""}` : null, 50);
  const [open, setOpen] = useState<Entry | null>(null);
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v });
    list.reset();
  };

  return (
    <div>
      <PageIntro eyebrow="AFTER THE EVENT" title="Audit log" subtitle="Every admin change, who made it, and why. Entries can't be edited or deleted." />
      <div className="toolbar wrap">
        <input placeholder="Actor uid (or system)" value={f.actor} onChange={(e) => set("actor", e.target.value.trim())} />
        <input placeholder="Action, e.g. duplicate.merge" value={f.action} onChange={(e) => set("action", e.target.value.trim())} />
        <input placeholder="Target ID" value={f.target} onChange={(e) => set("target", e.target.value.trim())} />
        <Field label="From">
          <DateTimeInput value={f.from} onChange={(v) => set("from", v)} />
        </Field>
        <Field label="To">
          <DateTimeInput value={f.to} onChange={(v) => set("to", v)} />
        </Field>
      </div>
      <Loader query={list}>
        {(d) => (
          <>
            <DataTable
              rows={d.items}
              onRow={setOpen}
              columns={[
                { key: "ts", label: "When", render: (r) => fmtDate(r.ts) },
                { key: "actor", label: "Who" },
                { key: "action", label: "Action" },
                { key: "target", label: "Target" },
                { key: "reason", label: "Reason" },
              ]}
            />
            <Pager page={list.page} hasNext={list.hasNext} next={list.next} previous={list.previous} />
          </>
        )}
      </Loader>
      {open && (
        <Dialog title={open.action} onClose={() => setOpen(null)}>
          <p className="muted">
            {fmtDate(open.ts)} · by {open.actor} · on {open.target}
          </p>
          {open.reason && <p>Reason: “{open.reason}”</p>}
          <Diff before={open.before} after={open.after} />
        </Dialog>
      )}
    </div>
  );
}
