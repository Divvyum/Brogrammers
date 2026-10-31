import type { Role } from "@hackos/shared";

// Which screens each role sees (plan A2: "each role sees only its own menu").

export interface NavItem {
  path: string;
  label: string;
  group: string;
}

const ORGANIZER: NavItem[] = [
  { path: "/dashboard", label: "Live dashboard", group: "Overview" },
  { path: "/event", label: "Event setup", group: "Overview" },
  { path: "/staff", label: "Staff", group: "Overview" },
  { path: "/participants", label: "Participants", group: "Registration" },
  { path: "/duplicates", label: "Duplicates", group: "Registration" },
  { path: "/eligibility", label: "Eligibility", group: "Registration" },
  { path: "/teams", label: "Teams", group: "Registration" },
  { path: "/waitlist", label: "Waitlist & rescue", group: "Registration" },
  { path: "/rooms", label: "Slots & rooms", group: "Arrival" },
  { path: "/ids", label: "Digital IDs", group: "Arrival" },
  { path: "/checkins", label: "Check-in monitor", group: "Arrival" },
  { path: "/scan", label: "Gate scanner", group: "Arrival" },
  { path: "/schedule", label: "Schedule", group: "Event day" },
  { path: "/problems", label: "Problem statements", group: "Event day" },
  { path: "/announcements", label: "Announcements", group: "Event day" },
  { path: "/whatsapp", label: "WhatsApp", group: "Event day" },
  { path: "/mentors", label: "Mentors", group: "Event day" },
  { path: "/operations", label: "Volunteer ops", group: "Event day" },
  { path: "/judging", label: "Judging setup", group: "Judging" },
  { path: "/judge", label: "Judge panel", group: "Judging" },
  { path: "/results", label: "Results", group: "Judging" },
  { path: "/rewards", label: "Rewards & feedback", group: "After the event" },
  { path: "/exports", label: "Exports & analytics", group: "After the event" },
  { path: "/audit", label: "Audit log", group: "After the event" },
];

const BY_ROLE: Record<string, NavItem[]> = {
  superadmin: ORGANIZER,
  organizer: ORGANIZER,
  volunteer: [
    { path: "/scan", label: "Gate scanner", group: "Volunteer" },
    { path: "/my-work", label: "Tasks & help desk", group: "Volunteer" },
    { path: "/food", label: "Food counter", group: "Volunteer" },
    { path: "/participants", label: "Participant lookup", group: "Volunteer" },
  ],
  mentor: [{ path: "/mentor", label: "My mentoring", group: "Mentor" }],
  judge: [{ path: "/judge", label: "Judge panel", group: "Judge" }],
};

export const navFor = (role: Role | null): NavItem[] => (role ? (BY_ROLE[role] ?? []) : []);

/** Where each role lands after signing in. */
export const homeFor = (role: Role | null): string =>
  role === "volunteer" ? "/scan" : role === "mentor" ? "/mentor" : role === "judge" ? "/judge" : "/dashboard";

export const canSee = (role: Role | null, path: string) => navFor(role).some((n) => path === n.path || path.startsWith(`${n.path}/`));
