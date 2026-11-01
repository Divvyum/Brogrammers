import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { StepState } from '../../lib/live'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

/** Horizontal status tracker (plan 4.3). Scrolls sideways on narrow screens. */
export function StepTracker({ steps }: { steps: Array<{ id: string; label: string; detail: string; state: StepState; to: string }> }) {
  return (
    <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-[880px]">
        {steps.map((s, i) => (
          <li key={s.id} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span className={cn('absolute right-1/2 top-[17px] h-[3px] w-full -translate-y-1/2', s.state === 'upcoming' ? 'bg-track' : 'bg-gradient-to-r from-emerald-400 to-emerald-500', s.state === 'current' && 'from-emerald-400 to-brand-500')} />}
            <Link to={s.to} className="group relative z-10 flex flex-col items-center px-1" aria-label={`${tr(s.label)}: ${s.state}`}>
              <span className={cn('grid h-[34px] w-[34px] place-items-center rounded-full border-[3px] transition group-hover:scale-110',
                s.state === 'done' && 'border-emerald-100 bg-emerald-500 text-white',
                s.state === 'current' && 'pulse-ring border-brand-100 bg-brand-500 text-white',
                s.state === 'upcoming' && 'border-white bg-track text-faint dark:border-[#161a38]')}>
                {s.state === 'done' ? <Check size={16} strokeWidth={3} /> : <span className="text-xs font-bold">{i + 1}</span>}
              </span>
              <span className={cn('mt-2.5 text-[13px] font-bold leading-tight', s.state === 'upcoming' ? 'text-muted' : 'text-ink')}>{tr(s.label)}</span>
              <span className={cn('mt-0.5 text-[11.5px] font-medium', s.state === 'done' ? 'text-emerald-600' : s.state === 'current' ? 'text-brand-600' : 'text-faint')}>{s.state === 'current' ? tr("Up next") : tr(s.detail)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
