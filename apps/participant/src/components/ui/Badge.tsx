import type { ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

export type PillTone = 'green' | 'amber' | 'rose' | 'indigo' | 'blue' | 'slate' | 'violet' | 'teal'
const tones: Record<PillTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  teal: 'bg-teal-50 text-teal-700 ring-teal-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  indigo: 'bg-brand-50 text-brand-700 ring-brand-100',
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}
const dots: Record<PillTone, string> = {
  green: 'bg-emerald-500', teal: 'bg-teal-500', amber: 'bg-amber-500', rose: 'bg-rose-500',
  indigo: 'bg-brand-500', blue: 'bg-blue-500', violet: 'bg-violet-500', slate: 'bg-slate-400',
}

export function Pill({ tone = 'slate', dot = true, children, className }: { tone?: PillTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  )
}

/** Maps common status words to a pill tone */
export function statusTone(status: string): PillTone {
  const s = status.toLowerCase()
  if (['approved', 'eligible', 'complete', 'completed', 'confirmed', 'active', 'valid', 'on time', 'delivered', 'checked in', 'locked', 'available', 'sent', 'healthy', 'accepted', 'scored', 'arrived'].includes(s)) return 'green'
  if (['pending', 'pending review', 'flagged', 'looking for members', 'in progress', 'busy', 'manual', 'scheduled', 'invited', 'offered', 'partial', 'degraded', 'review'].includes(s)) return 'amber'
  if (['rejected', 'late', 'duplicate', 'incomplete', 'withdrawn', 'failed', 'declined', 'no-show', 'expired', 'offline', 'full'].includes(s)) return 'rose'
  if (['waitlisted', 'draft', 'upcoming', 'not started', 'away'].includes(s)) return 'slate'
  return 'indigo'
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{tr(status)}</Pill>
}

export function Trend({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-600">
      <ArrowUp size={12} strokeWidth={2.6} /> {value}
    </span>
  )
}
