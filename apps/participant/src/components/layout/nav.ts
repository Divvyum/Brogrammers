import { Award, BadgeCheck, CalendarDays, CalendarRange, FileUp, Gift, Handshake, House, IdCard, Lightbulb, Megaphone, Route, Star, Ticket, UserRound, UsersRound, type LucideIcon } from 'lucide-react'
import type { StringKey } from '../../i18n/strings'

export interface NavItem { to: string; key: StringKey; icon: LucideIcon; badge?: number }
export interface NavSection { key: StringKey; items: NavItem[] }

export const navSections: NavSection[] = [
  { key: 'nav.overview', items: [
    { to: '/', key: 'nav.home', icon: House },
    { to: '/event', key: 'nav.event', icon: BadgeCheck },
  ] },
  { key: 'nav.prepare', items: [
    { to: '/team', key: 'nav.team', icon: UsersRound },
    { to: '/journey', key: 'nav.journey', icon: Route },
    { to: '/my-id', key: 'nav.myid', icon: IdCard },
  ] },
  { key: 'nav.hackathon', items: [
    { to: '/schedule', key: 'nav.schedule', icon: CalendarDays },
    { to: '/announcements', key: 'nav.announcements', icon: Megaphone },
    { to: '/problems', key: 'nav.problems', icon: Lightbulb },
    { to: '/mentors', key: 'nav.mentors', icon: CalendarRange },
    { to: '/event-day', key: 'nav.eventday', icon: Ticket },
    { to: '/submission', key: 'nav.submission', icon: FileUp },
  ] },
  { key: 'nav.after', items: [
    { to: '/results', key: 'nav.results', icon: Award },
    { to: '/rewards', key: 'nav.rewards', icon: Gift },
    { to: '/rating', key: 'nav.rating', icon: Star },
    { to: '/community', key: 'nav.community', icon: Handshake },
  ] },
]

export const profileItem: NavItem = { to: '/profile', key: 'nav.profile', icon: UserRound }
export const allNavItems: NavItem[] = [...navSections.flatMap((s) => s.items), profileItem]

/** Bottom navigation on phones (build plan S1: mobile-first with bottom nav). */
export const mobileTabs: NavItem[] = [
  allNavItems[0], // home
  allNavItems.find((i) => i.to === '/team')!,
  allNavItems.find((i) => i.to === '/my-id')!,
  allNavItems.find((i) => i.to === '/schedule')!,
]
