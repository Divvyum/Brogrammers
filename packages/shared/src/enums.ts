import { z } from "zod";

// Roles live in Firebase Auth custom claims: { role, eventId } (plan 4.1).
export const ROLES = ["superadmin", "organizer", "volunteer", "mentor", "judge", "participant"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const STAFF_ROLES = ["organizer", "volunteer", "mentor", "judge"] as const;
export const StaffRole = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRole>;

// Participant status flow (plan 4.3), in order.
export const PARTICIPANT_STATUSES = [
  "registered",
  "eligible",
  "flagged",
  "rejected",
  "team_locked",
  "travel_booked",
  "enrolled",
  "checked_in",
  "room_assigned",
  "submitted",
  "results",
  "reward_received",
] as const;
export const ParticipantStatus = z.enum(PARTICIPANT_STATUSES);
export type ParticipantStatus = z.infer<typeof ParticipantStatus>;

export const EligibilityResult = z.enum(["eligible", "flagged", "rejected"]);
export type EligibilityResult = z.infer<typeof EligibilityResult>;

export const EventMode = z.enum(["online", "offline", "hybrid"]);
export type EventMode = z.infer<typeof EventMode>;

export const EnrollmentStatus = z.enum(["invited", "enrolled", "revoked"]);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatus>;

export const TeamStatus = z.enum(["forming", "locked"]);
export const TeamChangeType = z.enum(["join", "leave", "replace"]);
export const RequestStatus = z.enum(["pending", "approved", "rejected"]);
export const DuplicateMatchType = z.enum(["phone", "email", "fuzzy"]);
export const DuplicateStatus = z.enum(["open", "merged", "dismissed"]);
export const WaitlistStatus = z.enum(["waiting", "offered", "accepted", "declined", "expired"]);
export const ReplacementStatus = z.enum([
  "searching",
  "invited",
  "accepted",
  "approved",
  "waitlist",
  "failed",
]);

// Check-ins (Samrat's guide 6.5). Reject reasons are listed in check order.
export const CHECKIN_REJECT_REASONS = [
  "BAD_QR",
  "FORGED_ID",
  "WRONG_EVENT",
  "EXPIRED",
  "NOT_IN_ROSTER",
  "REVOKED",
  "KEY_MISMATCH",
  "STALE_CHALLENGE",
  "DEVICE_MISMATCH",
] as const;
export const CheckinRejectReason = z.enum(CHECKIN_REJECT_REASONS);
export type CheckinRejectReason = z.infer<typeof CheckinRejectReason>;

export const CheckinMethod = z.enum(["qr", "manual", "code"]);
export type CheckinMethod = z.infer<typeof CheckinMethod>;
export const CheckinResult = z.enum(["valid", "duplicate", "rejected"]);
export type CheckinResult = z.infer<typeof CheckinResult>;

// Outbox (plan 4.4).
export const Channel = z.enum(["whatsapp", "email", "push"]);
export type Channel = z.infer<typeof Channel>;
/** "skipped": the recipient turned this kind of message off (notification preferences). */
export const OutboxStatus = z.enum(["queued", "sending", "sent", "failed", "skipped"]);
export type OutboxStatus = z.infer<typeof OutboxStatus>;
/** 0 = emergency, sent before everything else. */
export const Priority = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Priority = z.infer<typeof Priority>;

export const AudienceType = z.enum(["all", "track", "room", "team", "role"]);
export type AudienceType = z.infer<typeof AudienceType>;

export const MentorSlotStatus = z.enum(["open", "booked", "done", "cancelled"]);
/** Allowed reward status changes (plan D26). */
export const REWARD_TRANSITIONS: Record<string, readonly string[]> = {
  announced: ["verified", "disputed"],
  verified: ["processing", "disputed"],
  processing: ["delivered", "disputed"],
  disputed: ["processing", "verified"],
  delivered: ["disputed"],
};
export const TicketStatus = z.enum(["open", "assigned", "resolved"]);
export const TaskStatus = z.enum(["todo", "in_progress", "done"]);
export const CertificateType = z.enum(["participation", "winner", "mentor"]);
export const RewardStatus = z.enum(["announced", "verified", "processing", "delivered", "disputed"]);
export const ComplaintStatus = z.enum(["open", "responded", "escalated", "resolved"]);
export const ConnectionStatus = z.enum(["pending", "accepted", "declined"]);
export const WaConnectionState = z.enum(["disconnected", "connecting", "qr_required", "connected"]);
