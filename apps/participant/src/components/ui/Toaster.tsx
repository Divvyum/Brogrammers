import { CheckCircle2, Info, Plug, TriangleAlert, X, XCircle } from 'lucide-react'
import { dismissToast, useToasts } from '../../lib/toast'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

const icons = {
  info: <Info size={18} className="text-brand-500" />,
  success: <CheckCircle2 size={18} className="text-emerald-500" />,
  warning: <TriangleAlert size={18} className="text-amber-500" />,
  error: <XCircle size={18} className="text-rose-500" />,
  design: <Plug size={18} className="text-violet-500" />,
}

export function Toaster() {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-24 left-4 right-4 z-[60] flex flex-col gap-2.5 sm:left-auto sm:w-[360px] lg:bottom-6 lg:right-6 flex-col gap-2.5">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cn('anim-toast pointer-events-auto flex items-start gap-3 rounded-2xl border border-white bg-white px-4 py-3.5 shadow-pop', t.kind === 'design' && 'border-l-4 border-l-violet-400')}>
          <span className="mt-0.5">{icons[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{t.title}</p>
            {t.description && <p className={cn('mt-0.5 text-xs text-muted', t.kind === 'design' && 'font-mono')}>{t.description}</p>}
          </div>
          <button onClick={() => dismissToast(t.id)} className="text-faint hover:text-ink" aria-label={tr("Dismiss")}><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}
