import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { AuraLogo } from '../ui/Misc'
import { Tooltip } from '../ui/Tooltip'
import { navSections, profileItem, type NavItem } from './nav'
import { useSidebar } from '../../lib/theme'
import { useLang } from '../../i18n/strings'
import { useConfig } from '../../config'
import { useFeed } from '../../lib/live'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

function Item({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useLang()
  const { to, icon: Icon } = item
  const { items: feed } = useFeed()
  const badge = to === '/announcements' ? feed.filter((a) => !a.seen).length : item.badge
  const label = t(item.key)
  return (
    <Tooltip label={label} disabled={!collapsed}>
      <NavLink
        to={to}
        end={to === '/'}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          cn(
            'relative flex h-[42px] items-center whitespace-nowrap rounded-2xl text-[14.5px] font-medium transition',
            collapsed ? 'w-[46px] justify-center' : 'gap-3.5 px-3.5',
            isActive
              ? 'bg-gradient-to-r from-[#e2e5ff] to-[#d9dcfd] font-semibold text-brand-600 shadow-[0_8px_20px_-10px_rgba(80,80,220,.45),inset_0_1px_0_rgba(255,255,255,.9)] ring-1 ring-white dark:from-brand-100 dark:to-brand-200 dark:shadow-none dark:ring-brand-200'
              : 'text-ink-2 hover:bg-white/60 hover:text-ink dark:hover:bg-white/5',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} className={cn('shrink-0', isActive ? 'text-brand-600' : 'text-icon')} />
            {!collapsed && <span className="flex-1 truncate">{label}</span>}
            {badge ? (
              collapsed
                ? <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500 dark:border-[#161a38]" />
                : <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-[18px] text-white">{badge}</span>
            ) : null}
          </>
        )}
      </NavLink>
    </Tooltip>
  )
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebar()
  const { t } = useLang()
  const config = useConfig()
  const started = config.countdown.days === '0' && config.countdown.hours === '0' && config.countdown.minutes === '0'
  return (
    <aside
      className={cn(
        'sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-white/70 bg-white/35 pb-5 pt-6 backdrop-blur-md transition-[width] duration-200 lg:flex dark:border-white/5 dark:bg-white/[0.02]',
        collapsed ? 'w-[88px] px-[21px]' : 'w-[256px] px-4',
      )}
    >
      <button
        onClick={toggle}
        aria-label={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")}
        title={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")}
        className="absolute -right-3.5 top-[38px] z-10 grid h-7 w-7 place-items-center rounded-full border border-line bg-white text-icon shadow-soft transition hover:bg-brand-50 hover:text-brand-600"
      >
        {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
      </button>

      <NavLink to="/" aria-label={tr("AURA home")} className={cn('mb-6 flex h-[44px] shrink-0 items-center', collapsed ? 'justify-center' : 'gap-3 px-3')}>
        <AuraLogo size={collapsed ? 40 : 44} />
        {!collapsed && (
          <span className="leading-none">
            <span className="block bg-gradient-to-r from-[#4338ca] to-[#6d5cf5] bg-clip-text text-[26px] font-extrabold tracking-tight text-transparent dark:from-[#a5a8ff] dark:to-[#c4b5fd]">AURA</span>
            <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">{tr("Student")}</span>
          </span>
        )}
      </NavLink>

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 no-scrollbar">
        {navSections.map((s, i) => (
          <div key={s.key} className={i > 0 ? 'mt-4' : ''}>
            {collapsed
              ? i > 0 && <div className="mx-auto mb-4 h-px w-8 bg-track" />
              : <p className="mb-1.5 px-3.5 text-[11px] font-bold uppercase tracking-wider text-faint">{t(s.key)}</p>}
            <nav className="flex flex-col gap-1">
              {s.items.map((n) => <Item key={n.to} item={n} collapsed={collapsed} />)}
            </nav>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-track pt-4">
        <Item item={profileItem} collapsed={collapsed} />
        {!collapsed && (
          <div className="mt-3 rounded-[18px] border border-white bg-white/85 p-3.5 shadow-card">
            <p className="text-[13px] font-bold text-ink">{config.eventName}</p>
            <p className="text-xs text-muted">{config.eventDates}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-600"><span className="h-2 w-2 rounded-full bg-brand-500" /> {started ? tr("Event has started") : `${tr("Starts in")} ${config.countdown.days}d ${config.countdown.hours}h ${config.countdown.minutes}m`}</p>
          </div>
        )}
      </div>
    </aside>
  )
}
