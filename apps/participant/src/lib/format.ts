// Dates as the design shows them. The API sends ISO strings.
import { currentLang, tr } from '../i18n/strings'

const locale = () => (currentLang() === 'hi' ? 'hi-IN' : 'en-IN')

const d = (v: unknown) => (v ? new Date(String(v)) : null)
const ok = (x: Date | null): x is Date => Boolean(x) && !Number.isNaN(x!.getTime())

/** "12 Oct 2026" */
export function fmtDate(v: unknown) {
  const x = d(v)
  return ok(x) ? x.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
/** "12 Oct" */
export function fmtDay(v: unknown) {
  const x = d(v)
  return ok(x) ? x.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '—'
}
/** "13:00" */
export function fmtTime(v: unknown) {
  const x = d(v)
  return ok(x) ? x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
}
/** "12 Oct, 13:00" */
export function fmtDT(v: unknown) {
  const x = d(v)
  return ok(x) ? `${fmtDay(x)}, ${fmtTime(x)}` : '—'
}
/** "12 – 14 Oct 2026" */
export function fmtRange(a: unknown, b: unknown) {
  const x = d(a)
  const y = d(b)
  if (!ok(x) || !ok(y)) return '—'
  const sameMonth = x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()
  return sameMonth ? `${x.getDate()} - ${y.getDate()} ${y.toLocaleDateString(locale(), { month: 'short', year: 'numeric' })}` : `${fmtDay(x)} - ${fmtDate(y)}`
}
/** "12 min ago", "Yesterday", "3 days ago" */
export function ago(v: unknown, now = Date.now()) {
  const x = d(v)
  if (!ok(x)) return ''
  const s = Math.round((now - x.getTime()) / 1000)
  if (s < 60) return tr('Just now')
  if (s < 3600) return `${Math.round(s / 60)} ${tr('min ago')}`
  if (s < 86400) return `${Math.round(s / 3600)} ${tr('h ago')}`
  if (s < 172800) return tr('Yesterday')
  return `${Math.round(s / 86400)} ${tr('days ago')}`
}
/** Time left as parts, for the countdowns. */
export function countdown(to: unknown, now = Date.now()) {
  const x = d(to)
  const ms = ok(x) ? Math.max(0, x.getTime() - now) : 0
  return {
    passed: ms === 0,
    days: String(Math.floor(ms / 86_400_000)),
    hours: String(Math.floor((ms % 86_400_000) / 3_600_000)),
    minutes: String(Math.floor((ms % 3_600_000) / 60_000)),
    clock: [Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000), Math.floor((ms % 60_000) / 1000)].map((n) => String(n).padStart(2, '0')).join(':'),
  }
}
export const initialsOf = (name?: string) =>
  (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
