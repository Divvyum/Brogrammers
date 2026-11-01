import { cn } from '../../lib/cn'

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white bg-white/70 p-1.5 shadow-soft', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition',
            value === t.id ? 'bg-gradient-to-r from-[#5b5cf0] to-[#8b6cff] text-white shadow-btn' : 'text-muted hover:bg-brand-50 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn('rounded-full px-1.5 text-[11px] font-bold', value === t.id ? 'bg-white/25 text-white' : 'bg-brand-50 text-brand-600')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
