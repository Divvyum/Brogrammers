import { FieldValue } from "firebase-admin/firestore";
import { COL, type Channel } from "@hackos/shared";
import { db } from "./firebase.js";

// Default message templates for every message the server queues (plan D19).
// {{var}} placeholders are filled from the outbox message's vars by Manthan's
// worker using render(). Organizers can edit them; defaults never overwrite edits.

export const DEFAULT_TEMPLATES: Record<string, { channel: Channel; body: string }> = {
  eligibility_eligible: { channel: "whatsapp", body: "You're in! Your HACKOS registration is confirmed. Next: form or join a team." },
  eligibility_flagged: { channel: "whatsapp", body: "Your HACKOS registration needs a quick review: {{reason}}. An organizer will contact you." },
  eligibility_rejected: { channel: "whatsapp", body: "Sorry, your HACKOS registration could not be accepted: {{reason}}." },
  team_locked: { channel: "whatsapp", body: "Teams are now locked. Your team is final. See you at the event!" },
  replacement_invite: { channel: "whatsapp", body: "A team needs someone with your skills! Open HACKOS to accept the invite before {{expiresAt}}." },
  waitlist_offer: { channel: "whatsapp", body: "A seat opened up at HACKOS! Open the app to accept before {{expiresAt}}." },
  replacement_accepted: { channel: "whatsapp", body: "A replacement accepted your team's invite. An organizer will confirm shortly." },
  replacement_approved: { channel: "whatsapp", body: "You're officially on the team! Open HACKOS to meet your teammates." },
  enrollment_link: { channel: "whatsapp", body: "Set up your HACKOS digital ID (one time, needs internet): {{link}}" },
  checkin_welcome: { channel: "whatsapp", body: "Welcome to HACKOS! Your room is {{room}}, seat {{seat}}." },
  schedule_changed: { channel: "whatsapp", body: "Schedule update: {{title}} is now {{when}}{{location}}." },
  schedule_cancelled: { channel: "whatsapp", body: "Schedule update: {{title}} has been cancelled." },
  problem_released: { channel: "whatsapp", body: "The {{track}} problem statement is live: {{title}}. Open HACKOS to read it." },
  announcement: { channel: "whatsapp", body: "{{title}}\n\n{{body}}" },
  task_reminder: { channel: "whatsapp", body: "Reminder: \"{{title}}\" is due at {{dueAt}}." },
  results_published: { channel: "whatsapp", body: "HACKOS results are out! Open the app to see the leaderboard and your scores." },
  certificate_ready: { channel: "whatsapp", body: "Your HACKOS {{type}} certificate is ready: {{link}}" },
  reward_overdue: { channel: "whatsapp", body: "Reward overdue: \"{{prize}}\" was due {{dueAt}} and isn't delivered yet." },
  reward_status: { channel: "whatsapp", body: "Your reward \"{{prize}}\" is now {{status}}." },
  complaint_escalated: { channel: "whatsapp", body: "Complaint escalated: no resolution before the deadline ({{complaintId}})." },
  complaint_response: { channel: "whatsapp", body: "There's an update on your HACKOS complaint: {{note}}" },
};

export function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Creates any missing default templates. Returns how many were created. */
export async function ensureDefaultTemplates(): Promise<number> {
  const refs = Object.keys(DEFAULT_TEMPLATES).map((id) => db.collection(COL.templates).doc(id));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  let created = 0;
  existing.forEach((snap, i) => {
    if (snap.exists) return;
    const id = refs[i]!.id;
    batch.create(refs[i]!, { ...DEFAULT_TEMPLATES[id], updatedAt: FieldValue.serverTimestamp() });
    created++;
  });
  if (created) await batch.commit();
  return created;
}
