import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export const tokens = {
  color: { ink: "#17251f", accent: "#286b4d", surface: "#ffffff", canvas: "#f4f6f2", muted: "#68766d", line: "#e1e7e0" },
  radius: { small: "5px", medium: "8px" },
  spacing: { xs: "4px", sm: "8px", md: "12px", lg: "20px", xl: "32px" },
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" };
export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button {...props} className={`ui-button ${variant} ${className}`} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${props.className || ""}`} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const tone = /eligible|valid|approved|enrolled|done|official/i.test(status) ? "good" : /reject|broken|revoked|failed/i.test(status) ? "danger" : /flag|pending|invited|queued/i.test(status) ? "warning" : "neutral";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="ui-empty"><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="ui-error" role="alert"><strong>Could not load this view</strong><p>{message}</p>{retry && <Button variant="secondary" onClick={retry}>Try again</Button>}</div>;
}

export function Skeleton({ width = "100%" }: { width?: string }) {
  return <span className="ui-skeleton" style={{ width }} aria-hidden="true" />;
}

export function Table<T>({ rows, columns, rowKey, onRowClick }: {
  rows: T[];
  columns: { key: keyof T | string; label: string; render?: (row: T) => ReactNode }[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  if (!rows.length) return <EmptyState title="Nothing here yet" detail="No records match this view." />;
  return <div className="ui-table-wrap"><table className="ui-table"><thead><tr>{columns.map((c) => <th key={String(c.key)}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={rowKey(row)} onClick={() => onRowClick?.(row)}>{columns.map((c) => <td key={String(c.key)}>{c.render ? c.render(row) : String((row as Record<string, unknown>)[String(c.key)] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

export function Pagination({ page, hasNext, onPrevious, onNext }: { page: number; hasNext: boolean; onPrevious: () => void; onNext: () => void }) {
  return <div className="ui-pagination"><Button variant="secondary" disabled={page <= 1} onClick={onPrevious}>Previous</Button><span>Page {page}</span><Button variant="secondary" disabled={!hasNext} onClick={onNext}>Next</Button></div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="ui-backdrop" onMouseDown={onClose}><section className="ui-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}><header><h2>{title}</h2><Button variant="quiet" aria-label="Close" onClick={onClose}>×</Button></header>{children}</section></div>;
}

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="ui-backdrop" onMouseDown={onClose}><aside className="ui-drawer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}><header><h2>{title}</h2><Button variant="quiet" aria-label="Close" onClick={onClose}>×</Button></header>{children}</aside></div>;
}

export function Tabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return <div className="ui-tabs" role="tablist">{items.map((item) => <button key={item.id} role="tab" aria-selected={value === item.id} className={value === item.id ? "selected" : ""} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}

export function ConfirmDialog({ title, description, confirmLabel = "Confirm", onConfirm, onCancel, busy = false }: {
  title: string; description: string; confirmLabel?: string; onConfirm: (reason: string) => void; onCancel: () => void; busy?: boolean;
}) {
  const [reason, setReason] = useState("");
  return <Modal title={title} onClose={onCancel}><p>{description}</p><label className="ui-field">Reason (required)<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required /></label><footer className="ui-dialog-actions"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{busy ? "Saving…" : confirmLabel}</Button></footer></Modal>;
}

export function Toast({ message, tone = "info", onDismiss }: { message: string; tone?: "info" | "error" | "success"; onDismiss: () => void }) {
  return <div className={`ui-toast ${tone}`} role={tone === "error" ? "alert" : "status"}><span>{message}</span><button aria-label="Dismiss notification" onClick={onDismiss}>×</button></div>;
}
