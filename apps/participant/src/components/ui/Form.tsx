import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Input({ icon, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  if (!icon) return <input {...props} className={cn('input', className)} />
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint">{icon}</span>
      <input {...props} className={cn('input pl-10', className)} />
    </div>
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn('input appearance-none pr-9', className)}>{children}</select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input min-h-[96px] resize-y', className)} />
}

export function Toggle({ checked, onChange, label, description, tone = 'brand' }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; tone?: 'brand' | 'danger' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 text-left">
      {(label || description) && (
        <span>
          {label && <span className="block text-sm font-semibold text-ink">{label}</span>}
          {description && <span className="block text-xs text-muted">{description}</span>}
        </span>
      )}
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? (tone === 'danger' ? 'bg-rose-500' : 'bg-brand-500') : 'bg-slate-200')}>
        <span className={cn('absolute top-0.5 h-5 w-5 keep-white rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
      {label}
    </label>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-brand-50 p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className={cn('rounded-lg px-3.5 py-1.5 text-sm font-semibold transition', value === o.id ? 'bg-white text-brand-600 shadow-sm dark:bg-brand-200 dark:text-white' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1.5 text-[13px] font-semibold transition', active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-muted hover:border-brand-200 hover:text-ink')}>
      {children}
    </button>
  )
}
