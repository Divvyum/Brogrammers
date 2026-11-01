import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

export type Tone = 'indigo' | 'violet' | 'blue' | 'teal' | 'green' | 'pink' | 'amber' | 'rose' | 'slate'

export const toneStyles: Record<Tone, { tile: string; icon: string; dot: string; text: string; soft: string }> = {
  indigo: { tile: 'from-[#efedff] to-[#dedcff] dark:from-indigo-500/30 dark:to-indigo-500/10', icon: 'text-brand-600', dot: 'bg-brand-500', text: 'text-brand-600', soft: 'bg-brand-50 text-brand-700' },
  violet: { tile: 'from-[#f3edff] to-[#e4d9ff] dark:from-violet-500/30 dark:to-violet-500/10', icon: 'text-violet-600', dot: 'bg-violet-500', text: 'text-violet-600', soft: 'bg-violet-50 text-violet-700' },
  blue: { tile: 'from-[#e8f2ff] to-[#d5e5ff] dark:from-blue-500/30 dark:to-blue-500/10', icon: 'text-blue-600', dot: 'bg-blue-500', text: 'text-blue-600', soft: 'bg-blue-50 text-blue-700' },
  teal: { tile: 'from-[#e3f8f4] to-[#caf0e7] dark:from-teal-500/30 dark:to-teal-500/10', icon: 'text-teal-600', dot: 'bg-teal-500', text: 'text-teal-600', soft: 'bg-teal-50 text-teal-700' },
  green: { tile: 'from-[#e3f9ee] to-[#c9f0da] dark:from-emerald-500/30 dark:to-emerald-500/10', icon: 'text-emerald-600', dot: 'bg-emerald-500', text: 'text-emerald-600', soft: 'bg-emerald-50 text-emerald-700' },
  pink: { tile: 'from-[#ffeaf5] to-[#ffd6ea] dark:from-pink-500/30 dark:to-pink-500/10', icon: 'text-pink-600', dot: 'bg-pink-500', text: 'text-pink-600', soft: 'bg-pink-50 text-pink-700' },
  amber: { tile: 'from-[#fff4e1] to-[#ffe6bd] dark:from-amber-500/30 dark:to-amber-500/10', icon: 'text-amber-500', dot: 'bg-amber-500', text: 'text-amber-600', soft: 'bg-amber-50 text-amber-700' },
  rose: { tile: 'from-[#ffebee] to-[#ffd5db] dark:from-rose-500/30 dark:to-rose-500/10', icon: 'text-rose-600', dot: 'bg-rose-500', text: 'text-rose-600', soft: 'bg-rose-50 text-rose-700' },
  slate: { tile: 'from-[#f1f2f8] to-[#e2e5f0] dark:from-slate-500/30 dark:to-slate-500/10', icon: 'text-slate-600', dot: 'bg-slate-400', text: 'text-slate-600', soft: 'bg-slate-100 text-slate-700' },
}

export function IconTile({ icon: Icon, tone = 'indigo', size = 'md', className }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'lg' ? 'h-[68px] w-[68px] rounded-[20px]' : size === 'md' ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl'
  const i = size === 'lg' ? 30 : size === 'md' ? 22 : 17
  return (
    <div className={cn('grid shrink-0 place-items-center bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_10px_20px_-10px_rgba(80,80,200,.45)] dark:shadow-none', toneStyles[tone].tile, s, className)}>
      <Icon size={i} strokeWidth={1.9} className={toneStyles[tone].icon} />
    </div>
  )
}
