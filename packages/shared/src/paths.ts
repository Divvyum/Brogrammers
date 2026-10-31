// Firestore collection paths (plan 4.2). Use these instead of typing paths by hand.

export const COL = {
  users: "users",
  uniqueKeys: "uniqueKeys",
  outbox: "outbox",
  inbox: "inbox",
  waSession: "waSession",
  waStatus: "waStatus",
  certificates: "certificates",
  templates: "templates",
  events: "events",
} as const;

export const EVENT_SUBCOLLECTIONS = [
  "participants",
  "teams",
  "teamChangeRequests",
  "duplicates",
  "waitlist",
  "replacements",
  "slots",
  "rooms",
  "enrollTokens",
  "checkins",
  "stats",
  "schedule",
  "problems",
  "announcements",
  "mentorSlots",
  "progress",
  "tickets",
  "tasks",
  "food",
  "travelPlans",
  "circles",
  "rubric",
  "judgeAssignments",
  "submissions",
  "scores",
  "leaderboard",
  "rewards",
  "complaints",
  "ratings",
  "connections",
  "audit",
  // Server-only: doc ID is a keyed hash of the volunteer's scanner PIN (plan D5).
  "volunteerPins",
] as const;
export type EventSubcollection = (typeof EVENT_SUBCOLLECTIONS)[number];

/** `eventPath("e1", "teams")` → `"events/e1/teams"` */
export function eventPath(eventId: string, sub?: EventSubcollection): string {
  return sub ? `events/${eventId}/${sub}` : `events/${eventId}`;
}

export const DOC = {
  waStatus: "waStatus/current",
  liveStats: (eventId: string) => `events/${eventId}/stats/live`,
  rubric: (eventId: string) => `events/${eventId}/rubric/current`,
  leaderboard: (eventId: string) => `events/${eventId}/leaderboard/current`,
  uniqueKey: (type: "phone" | "email", hash: string) => `uniqueKeys/${type}_${hash}`,
  food: (eventId: string, uid: string, mealId: string) => `events/${eventId}/food/${uid}_${mealId}`,
  score: (eventId: string, judgeUid: string, teamId: string) =>
    `events/${eventId}/scores/${judgeUid}_${teamId}`,
} as const;
