import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, CircleHelp, Languages, LogOut, Megaphone, Moon, Search, Sun, UserRound, WifiOff } from 'lucide-react'
import { MenuItem, Popover } from '../ui/Overlay'
import { AuraLogo } from '../ui/Misc'
import { allNavItems } from './nav'
import { useConfig } from '../../config'
import { useContent } from '../../content'
import { useTheme } from '../../lib/theme'
import { openWhatsApp, useOffline } from '../../lib/offline'
import { useSession } from '../../lib/session'
import { useFeed, useMentors, useSchedule, useTeam } from '../../lib/live'
import { ago, fmtDT } from '../../lib/format'
import { useNow } from '../../lib/data'
import { useLang } from '../../i18n/strings'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

const roundBtn = 'grid h-11 w-11 place-items-center rounded-full border border-white bg-white/90 text-ink shadow-card transition hover:bg-white sm:h-[50px] sm:w-[50px]'

function SearchBox() {
  const { t } = useLang()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement>(null)
  const { items: schedule } = useSchedule()
  const { items: announcements } = useFeed()
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const m = (v: string) => !s || v.toLowerCase().includes(s)
    return {
      pages: allNavItems.filter((n) => m(t(n.key))).slice(0, s ? 5 : 4),
      schedule: s ? schedule.filter((x) => m(x.title) || m(x.location)).slice(0, 3) : [],
      announcements: s ? announcements.filter((x) => m(x.title) || m(x.body)).slice(0, 3) : [],
    }
  }, [q, t, schedule, announcements])
  const empty = !results.pages.length && !results.schedule.length && !results.announcements.length
  const go = (to: string) => { setOpen(false); setQ(''); navigate(to) }
  return (
    <div ref={boxRef} className="relative hidden w-full max-w-[460px] md:block" onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <Search size={19} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-icon" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setOpen(false))}
        placeholder={t('common.search')}
        className="h-[50px] w-full rounded-full border border-white bg-white/90 pl-13 pr-5 text-[15px] text-ink shadow-card outline-none placeholder:text-muted focus:ring-4 focus:ring-brand-100"
      />
      {open && (
        <div className="anim-pop absolute left-0 right-0 top-full z-40 mt-2 max-h-[440px] overflow-y-auto rounded-2xl border border-white bg-white p-2 shadow-pop">
          {empty && <p className="px-3 py-8 text-center text-sm text-muted">{tr("No results for “")}{q}”</p>}
          {results.pages.length > 0 && <Group label={q ? tr("Pages") : tr("Jump to")} />}
          {results.pages.map((p) => <Row key={p.to} icon={<p.icon size={16} />} title={t(p.key)} sub={p.to} onClick={() => go(p.to)} />)}
          {results.schedule.length > 0 && <Group label={tr("Schedule")} />}
          {results.schedule.map((s) => <Row key={s.id} icon={<CalendarDays size={16} />} title={s.title} sub={`${s.day} · ${s.start} · ${s.location}`} onClick={() => go('/schedule')} />)}
          {results.announcements.length > 0 && <Group label={tr("Announcements")} />}
          {results.announcements.map((a) => <Row key={a.id} icon={<Megaphone size={16} />} title={a.title} sub={a.time} onClick={() => go('/announcements')} />)}
        </div>
      )}
    </div>
  )
}
function Group({ label }: { label: string }) {
  return <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-faint">{label}</p>
}
function Row({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-brand-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
    </button>
  )
}

const READ_KEY = 'aura-notifications-read'

/** Recent announcements, upcoming mentor sessions and teammates who still have to enroll. */
function useNotifications() {
  const { items: feed } = useFeed()
  const { data: mentors } = useMentors()
  const { data: team } = useTeam()
  const now = useNow(60_000)
  const list: Array<{ id: string; title: string; time: string; tone: string; to: string; at: number }> = []
  for (const a of feed.slice(0, 6)) list.push({ id: `a_${a.id}`, title: a.emergency ? `${tr("Emergency:")} ${a.title}` : a.title, time: a.time, tone: a.emergency ? 'rose' : 'slate', to: '/announcements', at: new Date(a.createdAt).getTime() })
  for (const b of mentors?.bookings ?? []) if (new Date(b.startAt).getTime() > now) list.push({ id: `m_${b.id}`, title: `${tr("Mentor session")} ${fmtDT(b.startAt)} with ${b.mentorName ?? 'a mentor'}`, time: ago(b.startAt) || 'Upcoming', tone: 'indigo', to: '/mentors', at: now })
  for (const m of team?.team?.members ?? []) if (!m.isMe && m.enrollment !== 'enrolled') list.push({ id: `e_${m.uid}`, title: `${m.name?.split(' ')[0] ?? 'A teammate'} ${tr("hasn’t enrolled their ID yet")}`, time: 'Team', tone: 'amber', to: '/team', at: now - 1 })
  return list.sort((a, b) => b.at - a.at)
}

function NotificationBell() {
  const navigate = useNavigate()
  const all = useNotifications()
  const [read, setRead] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[] } catch { return [] } })
  const markRead = (ids: string[]) => { const next = [...new Set([...read, ...ids])]; setRead(next); try { localStorage.setItem(READ_KEY, JSON.stringify(next.slice(-200))) } catch { /* ignore */ } }
  const items = all.map((n) => ({ ...n, unread: !read.includes(n.id) }))
  const unread = items.filter((n) => n.unread).length
  const dot: Record<string, string> = { rose: 'bg-rose-500', amber: 'bg-amber-500', indigo: 'bg-brand-500', green: 'bg-emerald-500', slate: 'bg-slate-400' }
  return (
    <Popover
      trigger={({ toggle, open }) => (
        <button onClick={toggle} aria-label={tr("Notifications")} className={cn(roundBtn, 'relative', open && 'ring-4 ring-brand-100')}>
          <Bell size={21} strokeWidth={1.9} />
          {unread > 0 && <span className="absolute right-[9px] top-[8px] h-3 w-3 rounded-full border-2 border-white bg-rose-500 sm:right-[11px] sm:top-[9px] dark:border-[#161a38]" />}
        </button>
      )}
      className="w-[min(380px,calc(100vw-24px))] max-sm:-right-14"
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <p className="text-base font-bold text-ink">{tr("Notifications")} {unread > 0 && <span className="ml-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">{unread} {tr("new")}</span>}</p>
            <button onClick={() => markRead(items.map((n) => n.id))} className="text-xs font-semibold text-brand-600 hover:underline">{tr("Mark all as read")}</button>
          </div>
          <div className="max-h-[360px] overflow-y-auto px-2">
            {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">{tr("You’re all caught up")}</p>}
            {items.map((n) => (
              <button key={n.id} onClick={() => { close(); markRead([n.id]); navigate(n.to) }} className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-brand-50', n.unread && 'bg-surface-2')}>
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot[n.tone])} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', n.unread ? 'font-semibold text-ink' : 'text-ink-2')}>{n.title}</span>
                  <span className="block text-xs text-muted">{n.time}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-line p-2">
            <button onClick={() => { close(); navigate('/announcements') }} className="w-full rounded-xl py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">{tr("See all announcements")}</button>
          </div>
        </div>
      )}
    </Popover>
  )
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button onClick={toggle} aria-label={dark ? tr("Switch to light theme") : tr("Switch to dark theme")} title={dark ? tr("Light theme") : tr("Dark theme")} className={roundBtn}>
      {dark ? <Sun size={20} strokeWidth={1.9} /> : <Moon size={20} strokeWidth={1.9} />}
    </button>
  )
}

function AccountMenu() {
  const navigate = useNavigate()
  const { offline } = useOffline()
  const { lang, setLang } = useLang()
  const config = useConfig()
  const { signOut } = useSession()
  const { whatsappNumber } = useContent()
  const initials = config.initials
  return (
    <Popover
      trigger={({ toggle, open }) => (
        <button onClick={toggle} aria-label={tr("Account menu")} title={config.studentName} className={cn(roundBtn, open && 'ring-4 ring-brand-100')}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#a5a8fb] to-[#7c74f2] text-sm font-semibold text-white sm:h-10 sm:w-10 sm:text-base">{initials[0]}</span>
        </button>
      )}
      className="w-[270px] p-2"
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#a5a8fb] to-[#7c74f2] text-sm font-semibold text-white">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{config.studentName}</p>
              <p className="truncate text-xs text-muted">{config.studentEmail}</p>
              <p className="truncate text-xs font-medium text-brand-600">{config.eventName}</p>
            </div>
          </div>
          <div className="mb-1 h-px bg-line" />
          <MenuItem icon={<UserRound size={17} />} onClick={() => { close(); navigate('/profile') }}>{tr("Profile & settings")}</MenuItem>
          <MenuItem icon={<Languages size={17} />} onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
            <span className="flex flex-1 items-center justify-between">{tr("Language")} <span className="text-xs font-bold text-brand-600">{lang === 'en' ? 'English' : 'हिन्दी'}</span></span>
          </MenuItem>
          <MenuItem icon={<WifiOff size={17} />} onClick={() => undefined}>
            <span className="flex flex-1 items-center justify-between">{tr("Connection")} <span className={cn('text-xs font-bold', offline ? 'text-amber-600' : 'text-emerald-600')}>{offline ? tr("Offline") : tr("Online")}</span></span>
          </MenuItem>
          <MenuItem icon={<CircleHelp size={17} />} onClick={() => { close(); openWhatsApp(whatsappNumber, 'HELP') }}>{tr("Help (WhatsApp HELP)")}</MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem danger icon={<LogOut size={17} />} onClick={() => { close(); void signOut().then(() => navigate('/login')) }}>{tr("Sign out")}</MenuItem>
        </>
      )}
    </Popover>
  )
}

export function TopBar() {
  return (
    <header className="flex items-center justify-between gap-3 pb-2 pt-4 sm:gap-6 sm:pt-5">
      <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label={tr("AURA home")}>
        <AuraLogo size={34} />
        <span className="bg-gradient-to-r from-[#4338ca] to-[#6d5cf5] bg-clip-text text-xl font-extrabold tracking-tight text-transparent dark:from-[#a5a8ff] dark:to-[#c4b5fd]">AURA</span>
      </Link>
      <SearchBox />
      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  )
}
