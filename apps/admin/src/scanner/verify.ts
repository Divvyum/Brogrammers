import type { CheckinRejectReason } from "@hackos/shared";
import {
  CHALLENGE_TTL_MS,
  ChallengeResponse,
  verifyCredential,
  verifyDeviceResponse,
} from "@hackos/shared/crypto";

// The scanner's 8 checks (Samrat's guide 6.5), run fully offline, in this
// order, stopping at the first failure. Kept free of UI and storage so it can
// be unit-tested.

export interface RosterEntry {
  participantId: string;
  name: string;
  college: string | null;
  teamId: string | null;
  teamName: string | null;
  roomId: string | null;
  seat: string | null;
  photoUrl: string | null;
  devicePubKey: string | null;
  status: "invited" | "enrolled" | "revoked";
  backupCodeHash: string | null;
  checkedInAt: string | null;
  photo?: Blob;
}

export interface PendingChallenge {
  n: string;
  ts: number;
  vid: string;
  ev: string;
}

export interface VerifyContext {
  eventId: string;
  organizerPubKey: string;
  roster: Map<string, RosterEntry>;
  /** Live challenges by nonce. A matched challenge is deleted (single use). */
  pending: Map<string, PendingChallenge>;
  now: number;
  /** ISO time of an earlier valid check-in on this device or in the roster, if any. */
  firstCheckIn: (participantId: string) => string | null;
}

export type Verdict =
  | { result: "valid"; entry: RosterEntry }
  | { result: "duplicate"; entry: RosterEntry; firstAt: string }
  | { result: "rejected"; reason: CheckinRejectReason; entry?: RosterEntry; participantId?: string };

export const REJECT_TEXT: Record<CheckinRejectReason, string> = {
  BAD_QR: "That isn't a HACKOS ID response. Ask them to tap Check in and scan your code.",
  FORGED_ID: "Forged ID: the organizer's signature doesn't match.",
  WRONG_EVENT: "This ID is for a different event.",
  EXPIRED: "This ID has expired.",
  NOT_IN_ROSTER: "Not in the roster. Sync the roster, or use manual check-in.",
  REVOKED: "This ID was revoked. Send them to the help desk.",
  KEY_MISMATCH: "This ID is bound to a different phone.",
  STALE_CHALLENGE: "Old or reused code (screenshot?). Show a fresh code and scan again.",
  DEVICE_MISMATCH: "The phone couldn't prove it owns this ID (cloned or screenshotted).",
};

export async function verifyResponse(raw: string, ctx: VerifyContext): Promise<Verdict> {
  // 1. Parses and is a response.
  let parsed: ChallengeResponse & { n?: string };
  try {
    const json = JSON.parse(raw) as unknown;
    const r = ChallengeResponse.safeParse(json);
    if (!r.success) return { result: "rejected", reason: "BAD_QR" };
    parsed = { ...r.data, n: typeof (json as { n?: unknown }).n === "string" ? (json as { n: string }).n : undefined };
  } catch {
    return { result: "rejected", reason: "BAD_QR" };
  }
  const { cred } = parsed;
  const pid = cred.payload.participantId;

  // 2. Signed by the organizer.
  if (!(await verifyCredential(ctx.organizerPubKey, cred))) {
    return { result: "rejected", reason: "FORGED_ID", participantId: pid };
  }

  // 3. Right event, not expired.
  if (cred.payload.eventId !== ctx.eventId) return { result: "rejected", reason: "WRONG_EVENT", participantId: pid };
  if (new Date(cred.payload.expiresAt).getTime() <= ctx.now) return { result: "rejected", reason: "EXPIRED", participantId: pid };

  // 4. In the roster and not revoked.
  const entry = ctx.roster.get(pid);
  if (!entry) return { result: "rejected", reason: "NOT_IN_ROSTER", participantId: pid };
  if (entry.status === "revoked") return { result: "rejected", reason: "REVOKED", entry, participantId: pid };

  // 5. The credential's device key is the one the roster has for this person.
  if (!entry.devicePubKey || entry.devicePubKey !== cred.payload.devicePubKey) {
    return { result: "rejected", reason: "KEY_MISMATCH", entry, participantId: pid };
  }

  // 6. Answers a live challenge from this device. The response may name its
  // nonce; if not, every live challenge is a candidate.
  for (const [n, c] of ctx.pending) if (ctx.now - c.ts > CHALLENGE_TTL_MS) ctx.pending.delete(n);
  const candidates = parsed.n ? [ctx.pending.get(parsed.n)].filter((c): c is PendingChallenge => Boolean(c)) : [...ctx.pending.values()];
  if (!candidates.length) return { result: "rejected", reason: "STALE_CHALLENGE", entry, participantId: pid };

  // 7. Signed by the enrolled device. The matched challenge is used up.
  let matched: PendingChallenge | undefined;
  for (const c of candidates) {
    if (await verifyDeviceResponse(entry.devicePubKey, { n: c.n, vid: c.vid, ev: c.ev, pid }, parsed.sig)) {
      matched = c;
      break;
    }
  }
  if (!matched) return { result: "rejected", reason: "DEVICE_MISMATCH", entry, participantId: pid };
  ctx.pending.delete(matched.n);

  // 8. Not already checked in.
  const firstAt = ctx.firstCheckIn(pid);
  if (firstAt) return { result: "duplicate", entry, firstAt };
  return { result: "valid", entry };
}
