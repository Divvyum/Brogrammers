// Notification preferences (student app → Profile & settings). Stored on
// users/{uid}.notifications as `${category}_${channel}` → boolean, e.g.
// "announcements_WhatsApp": false. A missing key means "send".

export type PrefCategory = "urgent" | "team" | "schedule" | "announcements" | "results";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", push: "Push", email: "Email" };

const BY_TEMPLATE: Record<string, PrefCategory> = {
  replacement_invite: "team",
  replacement_accepted: "team",
  replacement_approved: "team",
  waitlist_offer: "team",
  team_locked: "team",
  schedule_changed: "schedule",
  schedule_cancelled: "schedule",
  slot_booked: "schedule",
  problem_released: "schedule",
  announcement: "announcements",
  results_published: "results",
  certificate_ready: "results",
  reward_status: "results",
  reward_overdue: "results",
  complaint_response: "results",
  complaint_escalated: "results",
};

/**
 * Which preference a message falls under, or null when it must always be sent:
 * sign-in codes, enrollment links, receipts, replies to WhatsApp commands,
 * staff reminders, and anything sent at emergency priority (0).
 */
export function prefCategory(template: string, priority: number): PrefCategory | null {
  if (priority === 0) return null;
  return BY_TEMPLATE[template] ?? null;
}

/** False when the person turned this kind of message off for this channel. */
export function wantsMessage(notifications: Record<string, boolean> | undefined, template: string, priority: number, channel: string) {
  const category = prefCategory(template, priority);
  if (!category || category === "urgent" || !notifications) return true;
  return notifications[`${category}_${CHANNEL[channel] ?? channel}`] !== false;
}
