import { useState, type ReactNode } from "react";
import { ConfirmDialog, EmptyState, ErrorState, Modal, Skeleton, StatusPill } from "@hackos/ui";
import { useEvent } from "../lib/event";
import { errorMessage } from "../lib/hooks";
import { fromLocalInput, label, toLocalInput } from "../lib/format";

// Building blocks shared by the admin screens. Styles come from style.css (Aman's
// design) and app.css.

export function PageIntro({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-intro page-intro-row">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="intro-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, actions, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-heading">
          {title && <h3>{title}</h3>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  width?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  onRow,
  rowKey = (r) => String(r.id ?? r.uid ?? JSON.stringify(r)),
  empty = "Nothing here yet.",
  selected,
}: {
  rows: T[];
  columns: Column<T>[];
  onRow?: (row: T) => void;
  rowKey?: (row: T) => string;
  empty?: string;
  selected?: string | null;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="empty-cell" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={`${onRow ? "click-row" : ""} ${selected && selected === rowKey(r) ? "row-selected" : ""}`}
              onClick={onRow ? () => onRow(r) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(r) : display(r[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function display(v: unknown): ReactNode {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const Status = ({ value }: { value?: string | null }) => (value ? <StatusPill status={value} /> : <span className="muted">—</span>);

export function Pager({ page, hasNext, next, previous }: { page: number; hasNext: boolean; next: () => void; previous: () => void }) {
  if (page === 1 && !hasNext) return null;
  return (
    <div className="pager">
      <button className="secondary" disabled={page <= 1} onClick={previous}>
        ← Previous
      </button>
      <span>Page {page}</span>
      <button className="secondary" disabled={!hasNext} onClick={next}>
        Next →
      </button>
    </div>
  );
}

/** Loading / error / content in one place. */
export function Loader<T>({ query, children }: { query: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (query.isLoading) {
    return (
      <div className="skeleton-stack">
        <Skeleton />
        <Skeleton width="80%" />
        <Skeleton width="60%" />
      </div>
    );
  }
  if (query.error) return <ErrorState message={errorMessage(query.error)} retry={() => query.refetch()} />;
  if (query.data === undefined) return <EmptyState title="Nothing to show" detail="No data yet." />;
  return <>{children(query.data)}</>;
}

/** Every change that needs a reason goes through this (plan: "reason required"). */
export function ReasonDialog({ title, description, confirmLabel, onConfirm, onClose, busy }: {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => unknown;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <ConfirmDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      busy={busy}
      onCancel={onClose}
      onConfirm={async (reason) => {
        await onConfirm(reason);
        onClose();
      }}
    />
  );
}

/** A yes/no confirmation for actions the server doesn't record a reason for. */
export function Confirm({ title, description, confirmLabel = "Confirm", danger, onConfirm, onClose, busy }: {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => unknown;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{description}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className={danger ? "primary danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            await onConfirm();
            onClose();
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="dialog-body">{children}</div>
    </Modal>
  );
}

// ---------- form fields ----------

export function Field({ label: text, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{text}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function DateTimeInput({ value, onChange, required }: { value: string; onChange: (iso: string) => void; required?: boolean }) {
  return <input type="datetime-local" required={required} value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />;
}

/** Comma-separated list ↔ string[] */
export function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

export type Audience = { type: "all" | "track" | "room" | "team" | "role"; ids: string[] };

/** Audience picker for schedule items and announcements. */
export function AudiencePicker({ value, onChange, rooms = [], teams = [] }: {
  value: Audience;
  onChange: (a: Audience) => void;
  rooms?: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
}) {
  const { event } = useEvent();
  const options: Record<Audience["type"], { id: string; name: string }[]> = {
    all: [],
    track: (event?.tracks ?? []).map((t) => ({ id: t, name: t })),
    room: rooms,
    team: teams,
    role: ["participant", "volunteer", "mentor", "judge", "organizer"].map((r) => ({ id: r, name: label(r) })),
  };
  const list = options[value.type];
  return (
    <div className="audience-picker">
      <select value={value.type} onChange={(e) => onChange({ type: e.target.value as Audience["type"], ids: [] })}>
        <option value="all">Everyone</option>
        <option value="track">Tracks</option>
        <option value="room">Rooms</option>
        <option value="team">Teams</option>
        <option value="role">Roles</option>
      </select>
      {value.type !== "all" && (
        <div className="chip-list">
          {list.length === 0 && <span className="hint">No options.</span>}
          {list.map((o) => {
            const on = value.ids.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                className={on ? "chip on" : "chip"}
                onClick={() => onChange({ ...value, ids: on ? value.ids.filter((x) => x !== o.id) : [...value.ids, o.id] })}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StatCard({ label: text, value, foot, index }: { label: string; value: ReactNode; foot?: string; index?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{text}</span>
        {index && <small>{index}</small>}
      </div>
      <strong>{value}</strong>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
