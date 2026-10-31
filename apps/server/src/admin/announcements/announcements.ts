import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { AnnouncementBody } from "@hackos/shared";
import { generateText } from "../../core/ai.js";
import { writeAudit } from "../../core/audit.js";
import { audienceTopics, resolveAudience } from "../../core/audience.js";
import { col } from "../../core/events.js";
import { enqueueMany } from "../../core/outbox.js";
import { pushToTopics } from "../../core/push.js";

// Announcements (plan D18).

/**
 * Saves the announcement, then fans it out: one outbox message per recipient
 * (deterministic IDs, batched) and one FCM push per topic. Emergency messages
 * get priority 0, which the worker sends before everything else.
 */
export async function sendAnnouncement(eventId: string, body: AnnouncementBody, actor: string) {
  const ref = col(eventId, "announcements").doc();
  await ref.create({ ...body, createdBy: actor, seenCount: 0, createdAt: FieldValue.serverTimestamp() });

  const uids = await resolveAudience(eventId, body.audience);
  const queued = await enqueueMany(
    uids.map((uid) => ({
      channel: "whatsapp" as const,
      uid,
      template: "announcement",
      vars: { title: body.title, body: body.body },
      priority: body.emergency ? 0 : 1,
      dedupeKey: `announcement_${ref.id}`,
      eventId,
    })),
  );
  const pushed = await pushToTopics(audienceTopics(body.audience), {
    title: body.emergency ? `⚠ ${body.title}` : body.title,
    body: body.body,
    emergency: body.emergency,
  });
  await ref.update({ recipients: uids.length, sentAt: FieldValue.serverTimestamp() });
  await writeAudit({
    eventId,
    actor,
    action: body.emergency ? "announcement.emergency" : "announcement.send",
    target: ref.id,
    after: { audience: body.audience, recipients: uids.length },
  });
  return { id: ref.id, recipients: uids.length, queued, pushed };
}

const DRAFT_SYSTEM = `You write announcements for a college hackathon called HACKOS.
Turn the organizer's rough notes into a short, clear announcement for participants.
Keep every fact from the notes; never invent times, places or rules.
Reply with JSON only: {"title": "<max 60 characters>", "body": "<max 400 characters>"}`;

/** Turns rough notes into a clear announcement draft. The organizer edits it before sending. */
export async function draftAnnouncement(notes: string, tone: string) {
  const raw = await generateText(`Tone: ${tone}\nNotes:\n${notes}`, DRAFT_SYSTEM);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const parsed = JSON.parse(json) as { title?: string; body?: string };
    if (parsed.title && parsed.body) return { title: parsed.title.slice(0, 120), body: parsed.body.slice(0, 2000) };
  } catch {
    // Fall through: use the first line as the title.
  }
  const [first, ...rest] = raw.split("\n").filter((l) => l.trim());
  return { title: (first ?? "Announcement").replace(/^#+\s*/, "").slice(0, 120), body: rest.join("\n").slice(0, 2000) || raw };
}

/** Cron (every minute): refreshes seenCount for announcements from the last two days with count() queries. */
export async function updateSeenCounts(eventId: string, now = Date.now()) {
  const recent = await col(eventId, "announcements")
    .where("createdAt", ">=", Timestamp.fromMillis(now - 2 * 86_400_000))
    .get();
  let updated = 0;
  for (const a of recent.docs) {
    const seen = (await a.ref.collection("seen").count().get()).data().count;
    if (seen !== a.get("seenCount")) {
      await a.ref.update({ seenCount: seen });
      updated++;
    }
  }
  return updated;
}
