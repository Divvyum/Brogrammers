import { useEffect, useId, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-track', className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/5 [animation:shimmer_1.4s_infinite]" />
    </div>
  )
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-500">{icon ?? <Inbox size={28} />}</div>
      <h4 className="text-base font-bold text-ink">{title}</h4>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Pagination({ page, pages, onChange, total, perPage }: { page: number; pages: number; onChange: (p: number) => void; total: number; perPage: number }) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(total, page * perPage)
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
      <p className="text-sm text-muted">{tr("Showing")} <b className="text-ink">{from}–{to}</b> {tr("of")} <b className="text-ink">{total.toLocaleString()}</b></p>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="btn-ghost px-2" aria-label={tr("Previous page")}><ChevronLeft size={16} /></button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} onClick={() => onChange(p)} className={cn('h-8 min-w-8 rounded-lg px-2 text-sm font-semibold', p === page ? 'bg-brand-500 text-white shadow-btn' : 'text-muted hover:bg-brand-50')}>{p}</button>
        ))}
        <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="btn-ghost px-2" aria-label={tr("Next page")}><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

const avatarColors = ['from-indigo-400 to-violet-400', 'from-sky-400 to-blue-500', 'from-teal-400 to-emerald-500', 'from-pink-400 to-rose-400', 'from-amber-400 to-orange-400', 'from-violet-400 to-fuchsia-400']
export function Avatar({ name, size = 36, className, src }: { name: string; size?: number; className?: string; src?: string }) {
  if (src) return <img src={src} alt="" style={{ width: size, height: size }} className={cn('shrink-0 rounded-full object-cover', className)} />
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const c = avatarColors[name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % avatarColors.length]
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }} className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white', c, className)}>
      {initials}
    </div>
  )
}

export function GithubIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/** AURA brand mark: indigo "A" with a soft swoosh, as in the reference. */
export function AuraLogo({ size = 40 }: { size?: number }) {
  // unique gradient ids: a shared id breaks when the first logo sits in a hidden element
  const uid = useId().replace(/:/g, '')
  const a = `aura-a-${uid}`, b = `aura-b-${uid}`
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 60 48" aria-hidden>
      <defs>
        <linearGradient id={a} x1="0" y1="1" x2="1" y2="0"><stop offset="0" style={{ stopColor: "var(--logo-1)" }} /><stop offset="1" style={{ stopColor: "var(--logo-2)" }} /></linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c4b5fd" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
      </defs>
      <path d="M28.5 1.5c2.6 0 4.5 1.4 5.8 3.8l20.8 37.4c1.1 2-.4 4.3-2.6 4.3h-6.4c-1.5 0-2.8-.8-3.5-2.1L28.5 18.2 22 30.5h-9.3L22.7 5.3c1.3-2.4 3.2-3.8 5.8-3.8Z" fill={`url(#${a})`} />
      <path d="M12.5 28.5C6.5 28.5 2 33 2 38.3 2 43.2 5.9 47 10.8 47c4.4 0 6.8-2.6 8.6-6l3.9-7.4c-3.5-.1-6.4-5.1-10.8-5.1Z" fill={`url(#${b})`} />
    </svg>
  )
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={cn('mb-3 text-xs font-bold uppercase tracking-wider text-faint', className)}>{children}</h4>
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right font-semibold text-ink">{v}</span>
    </div>
  )
}

export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'green' | 'amber' | 'rose' }) {
  const bar = tone === 'green' ? 'from-teal-400 to-emerald-500' : tone === 'amber' ? 'from-amber-300 to-amber-500' : tone === 'rose' ? 'from-rose-300 to-rose-500' : 'from-[#5b5cf0] to-[#9a7bff]'
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-track', className)}>
      <div className={cn('h-full rounded-full bg-gradient-to-r', bar)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

/** A scannable QR code for `value`, drawn in the design's colours. */
export function QR({ value, size = 140 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    void QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141a46', light: '#ffffff' } }).then((x) => live && setSvg(x))
    return () => { live = false }
  }, [value])
  return <div style={{ width: size, height: size }} className="keep-white overflow-hidden rounded-lg bg-white [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Placeholder QR pattern (deterministic, not scannable) */
export function FakeQR({ size = 140, seed = 7 }: { size?: number; seed?: number }) {
  const n = 21
  const cells: boolean[] = []
  let x = seed * 9301 + 49297
  for (let i = 0; i < n * n; i++) { x = (x * 9301 + 49297) % 233280; cells.push(x / 233280 > 0.52) }
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
  const cs = size / n
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="keep-white rounded-lg bg-white">
      {cells.map((on, i) => {
        const r = Math.floor(i / n), c = i % n
        if (finder(r, c)) return null
        return on ? <rect key={i} x={c * cs} y={r * cs} width={cs} height={cs} fill="#141a46" /> : null
      })}
      {[[0, 0], [0, n - 7], [n - 7, 0]].map(([r, c]) => (
        <g key={`${r}-${c}`}>
          <rect x={c * cs} y={r * cs} width={7 * cs} height={7 * cs} fill="#141a46" rx={cs} />
          <rect x={(c + 1) * cs} y={(r + 1) * cs} width={5 * cs} height={5 * cs} fill="#fff" rx={cs * 0.6} />
          <rect x={(c + 2) * cs} y={(r + 2) * cs} width={3 * cs} height={3 * cs} fill="#5048e5" rx={cs * 0.4} />
        </g>
      ))}
    </svg>
  )
}
