// Display helpers. The API sends dates as ISO strings.

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" });

export function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : dateTime.format(d);
}

export function fmtTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : timeOnly.format(d);
}

/** ISO → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: unknown): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value → ISO with offset, as the API expects. */
export function fromLocalInput(v: string): string {
  return v ? new Date(v).toISOString() : "";
}

export const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const label = (s: string) => s.replace(/_/g, " ");
