import { Timestamp } from "firebase-admin/firestore";
import { col } from "../core/events.js";
import { enqueue } from "../core/outbox.js";

// Circle matching moved to circles.ts (nearby cities, arrival window).
export { matchTravelCircles } from "./circles.js";

export async function sendMentorReminders(eventId: string, now = Date.now()) {
  const slots = await col(eventId, "mentorSlots").where("status", "==", "booked").where("startAt", ">=", Timestamp.fromMillis(now + 9 * 60_000)).where("startAt", "<=", Timestamp.fromMillis(now + 11 * 60_000)).get();
  for (const s of slots.docs) { const team = await col(eventId, "teams").doc(s.get("teamId")).get(); for (const uid of (team.get("memberUids") as string[]) ?? []) await enqueue({ channel: "whatsapp", uid, template: "command_reply", vars: { reply: "Your mentor session starts in 10 minutes." }, dedupeKey: `mentor_reminder_${s.id}`, eventId }); }
  return slots.size;
}

export async function sendProgressReminders(eventId: string) {
  const teams = await col(eventId, "teams").get();
  for (const t of teams.docs) for (const uid of (t.get("memberUids") as string[]) ?? []) await enqueue({ channel: "push", uid, template: "command_reply", vars: { reply: "Please post your team progress update." }, dedupeKey: `progress_${t.id}_${Math.floor(Date.now() / 10_800_000)}`, eventId });
  return teams.size;
}
