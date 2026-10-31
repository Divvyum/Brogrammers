import { FieldValue } from "firebase-admin/firestore";
import { col } from "../core/events.js";
import { hashPhone, normalizePhone } from "../core/crypto.js";
import { db } from "../core/firebase.js";
import { enqueue } from "../core/outbox.js";

export const COMMANDS = ["STATUS", "MY TEAM", "MY ROOM", "SCHEDULE", "MENTOR", "SUBMISSION", "HELP"] as const;
export function normalizeCommand(text: string): (typeof COMMANDS)[number] {
  const value = text.trim().replace(/\s+/g, " ").toUpperCase();
  return (COMMANDS as readonly string[]).includes(value) ? value as (typeof COMMANDS)[number] : "HELP";
}

const recent = new Map<string, number[]>();
export function commandAllowed(sender: string, now = Date.now()): boolean {
  const hits = (recent.get(sender) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 6) return false;
  hits.push(now); recent.set(sender, hits); return true;
}

export async function handleCommand(from: string, text: string, messageId: string) {
  const command = normalizeCommand(text);
  const normalized = normalizePhone(from.split("@")[0] ?? from);
  const user = await db.collection("users").where("phoneHash", "==", hashPhone(normalized)).limit(1).get();
  const u = user.docs[0];
  const inbox = db.collection("inbox").doc(messageId);
  await inbox.set({ from: normalized, text, command, receivedAt: FieldValue.serverTimestamp(), processed: false }, { merge: true });
  if (!u || u.get("role") !== "participant") { await inbox.update({ processed: true, error: "UNKNOWN_SENDER" }); return; }
  if (!commandAllowed(normalized)) { await inbox.update({ processed: true, error: "RATE_LIMITED" }); return; }
  const eventId = u.get("eventId") as string;
  const p = await col(eventId, "participants").doc(u.id).get();
  let reply = "Commands: STATUS, MY TEAM, MY ROOM, SCHEDULE, MENTOR, SUBMISSION, HELP";
  if (command === "STATUS") reply = `Status: ${p.get("status") ?? "not registered"}. Eligibility: ${p.get("eligibility.result") ?? "pending"}.`;
  if (command === "MY ROOM") reply = p.get("roomId") ? `Room: ${p.get("roomId")}, seat: ${p.get("seat") ?? "pending"}.` : "Your room is not allotted yet.";
  if (command === "MY TEAM") { const teamId = p.get("teamId"); if (teamId) { const t = await col(eventId, "teams").doc(teamId).get(); reply = `${t.get("name")}: ${((t.get("memberUids") as string[]) ?? []).length} member(s).`; } else reply = "You are not in a team yet."; }
  if (command === "SCHEDULE") { const s = await col(eventId, "schedule").where("startAt", ">=", new Date()).orderBy("startAt").limit(3).get(); reply = s.empty ? "No upcoming schedule items." : s.docs.map((d) => `${d.get("title")} — ${d.get("location") ?? "TBA"}`).join("\n"); }
  if (command === "MENTOR") { const s = await col(eventId, "mentorSlots").where("teamId", "==", p.get("teamId") ?? "_").limit(1).get(); reply = s.empty ? "No mentor slot booked." : `Mentor slot booked for ${s.docs[0]!.get("startAt").toDate().toLocaleString("en-IN")}.`; }
  if (command === "SUBMISSION") { const teamId = p.get("teamId"); const s = teamId ? await col(eventId, "submissions").doc(teamId).get() : null; reply = s?.exists ? `Submission v${s.get("version")} received. Receipt: ${s.get("receiptId")}.` : "No submission received yet."; }
  await enqueue({ channel: "whatsapp", uid: u.id, template: "command_reply", vars: { reply }, priority: 0, dedupeKey: `reply_${messageId}`, eventId });
  await inbox.update({ processed: true, processedAt: FieldValue.serverTimestamp() });
}
