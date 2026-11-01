import type { Role } from "@hackos/shared";
import {
  Activity, BadgeCheck, CalendarDays, ClipboardList, Copy, Download, Gauge, Gift, Hourglass, IdCard, Lightbulb,
  Megaphone, MessageCircle, ScanLine, ScrollText, Search, Settings2, Smartphone, Trophy, UserCog, UsersRound, UtensilsCrossed,
  Warehouse, Wrench, GraduationCap, Gavel, type LucideIcon,
} from "lucide-react";

// Which screens each role sees (plan A2: "each role sees only its own menu").

export interface NavItem {
  path: string;
  label: string;
  group: string;
  icon: LucideIcon;
}

const ORGANIZER: NavItem[] = [
  { path: "/dashboard", label: "Live dashboard", group: "Overview", icon: Gauge },
  { path: "/event", label: "Event setup", group: "Overview", icon: Settings2 },
  { path: "/content", label: "Participant page", group: "Overview", icon: Smartphone },
  { path: "/staff", label: "Staff", group: "Overview", icon: UserCog },
  { path: "/participants", label: "Participants", group: "Registration", icon: UsersRound },
  { path: "/duplicates", label: "Duplicates", group: "Registration", icon: Copy },
  { path: "/eligibility", label: "Eligibility", group: "Registration", icon: BadgeCheck },
  { path: "/teams", label: "Teams", group: "Registration", icon: UsersRound },
  { path: "/waitlist", label: "Waitlist & rescue", group: "Registration", icon: Hourglass },
  { path: "/rooms", label: "Slots & rooms", group: "Arrival", icon: Warehouse },
  { path: "/ids", label: "Digital IDs", group: "Arrival", icon: IdCard },
  { path: "/checkins", label: "Check-in monitor", group: "Arrival", icon: Activity },
  { path: "/scan", label: "Gate scanner", group: "Arrival", icon: ScanLine },
  { path: "/schedule", label: "Schedule", group: "Event day", icon: CalendarDays },
  { path: "/problems", label: "Problem statements", group: "Event day", icon: Lightbulb },
  { path: "/announcements", label: "Announcements", group: "Event day", icon: Megaphone },
  { path: "/whatsapp", label: "WhatsApp", group: "Event day", icon: MessageCircle },
  { path: "/mentors", label: "Mentors", group: "Event day", icon: GraduationCap },
  { path: "/operations", label: "Volunteer ops", group: "Event day", icon: Wrench },
  { path: "/judging", label: "Judging setup", group: "Judging", icon: ClipboardList },
  { path: "/judge", label: "Judge panel", group: "Judging", icon: Gavel },
  { path: "/results", label: "Results", group: "Judging", icon: Trophy },
  { path: "/rewards", label: "Rewards & feedback", group: "After the event", icon: Gift },
  { path: "/exports", label: "Exports & analytics", group: "After the event", icon: Download },
  { path: "/audit", label: "Audit log", group: "After the event", icon: ScrollText },
];

const BY_ROLE: Record<string, NavItem[]> = {
  superadmin: ORGANIZER,
  organizer: ORGANIZER,
  volunteer: [
    { path: "/scan", label: "Gate scanner", group: "Volunteer", icon: ScanLine },
    { path: "/my-work", label: "Tasks & help desk", group: "Volunteer", icon: ClipboardList },
    { path: "/food", label: "Food counter", group: "Volunteer", icon: UtensilsCrossed },
    { path: "/participants", label: "Participant lookup", group: "Volunteer", icon: Search },
  ],
  mentor: [{ path: "/mentor", label: "My mentoring", group: "Mentor", icon: GraduationCap }],
  judge: [{ path: "/judge", label: "Judge panel", group: "Judge", icon: Gavel }],
};

export const navFor = (role: Role | null): NavItem[] => (role ? (BY_ROLE[role] ?? []) : []);

/** Where each role lands after signing in. */
export const homeFor = (role: Role | null): string =>
  role === "volunteer" ? "/scan" : role === "mentor" ? "/mentor" : role === "judge" ? "/judge" : "/dashboard";

export const canSee = (role: Role | null, path: string) => navFor(role).some((n) => path === n.path || path.startsWith(`${n.path}/`));
