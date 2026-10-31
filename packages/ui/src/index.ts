import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** Shared HACKOS palette and spacing, consumed by both web portals. */
export const tokens = {
  color: { ink: "#17251f", green: "#1f6a4b", lime: "#c9f36a", muted: "#78837c", line: "#e4e9e3", surface: "#ffffff", canvas: "#f4f6f2" },
  radius: { sm: "5px", md: "8px", lg: "12px" },
  space: { xs: "4px", sm: "8px", md: "12px", lg: "20px", xl: "32px" },
} as const;

export function Button({ variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button {...props} data-variant={variant} className={`hackos-button ${props.className || ""}`} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`hackos-input ${props.className || ""}`} />; }

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <span className={`hackos-badge ${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="hackos-empty"><strong>{title}</strong><p>{detail}</p></div>;
}

export function Skeleton({ width = "100%" }: { width?: string }) { return <span className="hackos-skeleton" style={{ width }} aria-hidden="true" />; }

export function StatusPill({ status }: { status: string }) { return <Badge tone={/eligible|valid|approved|enrolled|done/i.test(status) ? "good" : /reject|broken|revoked|failed/i.test(status) ? "danger" : /flag|pending|invited/i.test(status) ? "warning" : "neutral"}>{status}</Badge>; }
