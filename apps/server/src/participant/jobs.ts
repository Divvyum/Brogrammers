import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { col } from "../core/events.js";
import { enqueue } from "../core/outbox.js";

export async function matchTravelCircles(eventId: string) {
  const plans = await col(eventId, "travelPlans").get();
  const groups = new Map<string, string[]>();
  for (const p of plans.docs) { const day = (p.get("arriveAt") as Timestamp).toDate().toISOString().slice(0, 10); const city = String(p.get("city") ?? "").trim().toLowerCase().replace(/\s+/g, "-"); const route = String(p.get("route") ?? "").trim().toLowerCase().replace(/\s+/g, "-"); const key = `${city}:${route}|${p.get("mode")}|${day}`; groups.set(key, [...(groups.get(key) ?? []), p.id]); }
  for (const [key, members] of groups) { if (members.length < 2) continue; const [route, mode, day] = key.split("|"); const id = Buffer.from(key).toString("base64url").slice(0, 40); await col(eventId, "circles").doc(id).set({ route, mode, day, members, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); }
  return groups.size;
}

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
