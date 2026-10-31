import type { Audience } from "@hackos/shared";
import { COL } from "@hackos/shared";
import { col } from "./events.js";
import { db } from "./firebase.js";

// Who an announcement or schedule change reaches (plan D16, D18).
// Participants who were merged away or withdrew are never included.

const PARTICIPANT_FIELD = { track: "track", room: "roomId", team: "teamId" } as const;

export async function resolveAudience(eventId: string, audience: Audience): Promise<string[]> {
  const participants = col(eventId, "participants");
  const uids = new Set<string>();

  if (audience.type === "all") {
    const snap = await participants.select("mergedInto", "withdrawnAt").get();
    for (const p of snap.docs) if (!p.get("mergedInto") && !p.get("withdrawnAt")) uids.add(p.id);
    return [...uids];
  }

  if (audience.type === "role") {
    for (const role of audience.ids) {
      if (role === "participant") {
        for (const uid of await resolveAudience(eventId, { type: "all", ids: [] })) uids.add(uid);
        continue;
      }
      const staff = await db.collection(COL.users).where("eventId", "==", eventId).where("role", "==", role).select().get();
      for (const s of staff.docs) uids.add(s.id);
    }
    return [...uids];
  }

  const field = PARTICIPANT_FIELD[audience.type];
  // Firestore "in" takes at most 30 values.
  for (let i = 0; i < audience.ids.length; i += 30) {
    const snap = await participants
      .where(field, "in", audience.ids.slice(i, i + 30))
      .select("mergedInto", "withdrawnAt")
      .get();
    for (const p of snap.docs) if (!p.get("mergedInto") && !p.get("withdrawnAt")) uids.add(p.id);
  }
  return [...uids];
}

/** FCM topics for an audience (participants subscribe to all, track_x, room_y, team_z). */
export function audienceTopics(audience: Audience): string[] {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_.~%]/g, "_");
  if (audience.type === "all") return ["all"];
  if (audience.type === "role") return audience.ids.map((r) => `role_${safe(r)}`);
  return audience.ids.map((id) => `${audience.type}_${safe(id)}`);
}
