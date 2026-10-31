import { z } from "zod";
import { CheckinMethod, CheckinRejectReason, CheckinResult } from "../enums.js";

// Credential payload, signed by the organizer key (Samrat's guide 5.2).
// Holds IDs only: no name, photo or email, so a photographed QR leaks nothing.
export const CredentialPayload = z.object({
  v: z.literal(1),
  eventId: z.string(),
  participantId: z.string(),
  teamId: z.string().optional(),
  devicePubKey: z.string(), // base64url, raw 65-byte P-256 point
  issuedAt: z.string(), // ISO
  expiresAt: z.string(), // ISO
});
export type CredentialPayload = z.infer<typeof CredentialPayload>;

export const SignedCredential = z.object({
  payload: CredentialPayload,
  sig: z.string(), // base64url of canonical(payload), raw 64-byte P1363
});
export type SignedCredential = z.infer<typeof SignedCredential>;

/** Challenge QR shown by the volunteer device. */
export const Challenge = z.object({
  t: z.literal("chal"),
  n: z.string(), // 16 random bytes, base64url
  ts: z.number(), // Date.now() on the volunteer device
  vid: z.string(), // volunteer device ID
  ev: z.string(), // event ID
});
export type Challenge = z.infer<typeof Challenge>;

/** Response QR shown by the participant device. */
export const ChallengeResponse = z.object({
  t: z.literal("resp"),
  cred: SignedCredential,
  sig: z.string(), // device signature over challengeMessage(), base64url
});
export type ChallengeResponse = z.infer<typeof ChallengeResponse>;

export const CHALLENGE_TTL_MS = 60_000;
export const CHAIN_GENESIS = "GENESIS";

/**
 * The fields of a check-in that go into its hash. The scanner hashes this on the
 * device and the server recomputes it on sync (plan D14), so both must use the
 * same function: entryHash = sha256Hex(canonical(body)).
 */
export const ChainEntryBody = z.object({
  id: z.string(), // UUID created on the volunteer device
  eventId: z.string(),
  participantId: z.string(),
  deviceId: z.string(),
  volunteerUid: z.string(),
  ts: z.string(), // ISO time from the volunteer device
  method: CheckinMethod,
  result: CheckinResult,
  rejectReason: CheckinRejectReason.optional(),
  overrideNote: z.string().optional(),
  prevHash: z.string(),
});
export type ChainEntryBody = z.infer<typeof ChainEntryBody>;
