import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Small label shown to the right of its child on hover/focus (used by the collapsed sidebar). */
export function Tooltip({ label, children, disabled }: { label: string; children: ReactNode; disabled?: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  if (disabled) return <>{children}</>
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setPos({ x: r.right + 12, y: r.top + r.height / 2 })
  }
  return (
    <div
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setPos(null)}
      onClick={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div role="tooltip" style={{ left: pos.x, top: pos.y }} className="anim-fade pointer-events-none fixed z-[70] -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#141a46] px-2.5 py-1.5 text-xs font-semibold text-white shadow-pop dark:bg-[#2b3170]">
          {label}
        </div>,
        document.body,
      )}
    </div>
  )
}
