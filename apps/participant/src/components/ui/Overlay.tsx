import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

/** Stack of open overlays so Escape only closes the top-most one. */
const escapeStack: symbol[] = []
function useEscape(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (!open) return
    const id = Symbol('overlay')
    escapeStack.push(id)
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && escapeStack[escapeStack.length - 1] === id) closeRef.current() }
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
      escapeStack.splice(escapeStack.indexOf(id), 1)
    }
  }, [open])
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1b1f4a]/30 p-3 backdrop sm:p-6-blur-[3px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={cn('anim-pop w-full rounded-[26px] bg-white shadow-pop', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div>
            <h2 className="text-xl font-bold text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-muted hover:bg-brand-50 hover:text-ink" aria-label={tr("Close")}><X size={18} /></button>
        </div>
        <div className="px-5 py-5 sm:px-7">{children}</div>
        {footer && <div className="flex justify-end gap-3 rounded-b-[26px] border-t border-line bg-surface-2 px-7 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'w-[540px] max-w-full' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 bg-[#1b1f4a]/25 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside className={cn('anim-slide absolute right-0 top-0 flex h-full flex-col bg-white shadow-pop', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-ink">{title}</h2>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-muted hover:bg-brand-50 hover:text-ink" aria-label={tr("Close")}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-line bg-surface-2 px-7 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}

/** Click-to-toggle popover anchored to its trigger; closes on outside click / Escape. */
export function Popover({ trigger, children, align = 'right', side = 'bottom', className }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; side?: 'bottom' | 'top'; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cn('anim-pop absolute z-40 rounded-2xl border border-white bg-white shadow-pop', align === 'right' ? 'right-0' : 'left-0', side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2', className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition', danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-2 hover:bg-brand-50')}>
      {icon}
      {children}
    </button>
  )
}
