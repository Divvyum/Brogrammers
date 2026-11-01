import type { ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

/**
 * Design-only switch that shows the other states of a screen (e.g. eligible /
 * flagged / rejected). In the real app the state comes from the backend.
 */
export function StatePreview<T extends string>({ options, value, onChange, className }: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-dashed border-brand-200 bg-white/60 p-1 no-scrollbar', className)}>
      <span className="flex shrink-0 items-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-faint"><Eye size={13} /> {tr("Preview")}</span>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className={cn('shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition', value === o.id ? 'bg-brand-500 text-white shadow-btn' : 'text-muted hover:bg-brand-50 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Fixed sample countdown boxes, e.g. 3d 14h 22m (not ticking). */
export function Countdown({ parts, tone = 'brand', size = 'md' }: { parts: Array<[string, string]>; tone?: 'brand' | 'rose' | 'amber'; size?: 'sm' | 'md' }) {
  const box = tone === 'rose' ? 'from-[#ffe9ee] to-[#ffdfe6] text-[#e5294f] dark:from-rose-100 dark:to-rose-50 dark:text-rose-400' : tone === 'amber' ? 'from-[#fff4e1] to-[#ffe6bd] text-amber-600 dark:from-amber-100 dark:to-amber-50' : 'from-[#efedff] to-[#dedcff] text-brand-600 dark:from-brand-100 dark:to-brand-50'
  return (
    <div className="flex items-center gap-2">
      {parts.map(([v, l]) => (
        <div key={l} className={cn('flex flex-col items-center justify-center rounded-2xl bg-gradient-to-b', box, size === 'sm' ? 'h-14 w-14' : 'h-[74px] w-[66px]')}>
          <span className={cn('font-bold leading-none', size === 'sm' ? 'text-xl' : 'text-[26px]')}>{v}</span>
          <span className={cn('mt-1 font-medium opacity-90', size === 'sm' ? 'text-[10px]' : 'text-xs')}>{l}</span>
        </div>
      ))}
    </div>
  )
}

export function InfoNote({ children, tone = 'indigo', icon }: { children: ReactNode; tone?: 'indigo' | 'amber' | 'rose' | 'green'; icon?: ReactNode }) {
  const c = { indigo: 'bg-brand-50 text-brand-700', amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-700', green: 'bg-emerald-50 text-emerald-700' }[tone]
  return <div className={cn('flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed', c)}>{icon && <span className="mt-0.5 shrink-0">{icon}</span>}<div>{children}</div></div>
}
