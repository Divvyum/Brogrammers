import { z } from "zod";
import {
  AudienceType,
  CertificateType,
  Channel,
  CheckinMethod,
  CheckinRejectReason,
  CheckinResult,
  ComplaintStatus,
  ConnectionStatus,
  DuplicateMatchType,
  DuplicateStatus,
  EligibilityResult,
  EnrollmentStatus,
  EventMode,
  MentorSlotStatus,
  OutboxStatus,
  ParticipantStatus,
  Priority,
  ReplacementStatus,
  RequestStatus,
  RewardStatus,
  Role,
  TaskStatus,
  TeamChangeType,
  TeamStatus,
  TicketStatus,
  WaConnectionState,
  WaitlistStatus,
} from "./enums.js";

// Firestore document shapes (plan 4.2). Document IDs are not part of the shape.

/**
 * Matches a Timestamp from both the web SDK and firebase-admin, which are
 * different classes with the same shape.
 */
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}
export const FirestoreTimestamp = z.custom<TimestampLike>(
  (v) => typeof v === "object" && v !== null && typeof (v as TimestampLike).toMillis === "function",
  { message: "Expected a Firestore Timestamp" },
);

const id = z.string().min(1);
const url = z.url();

// ---------- top level ----------

export const User = z.object({
  name: z.string(),
  emailHash: z.string().optional(),
  emailEnc: z.string().optional(),
  phoneHash: z.string().optional(),
  phoneEnc: z.string().optional(),
  college: z.string().optional(),
  year: z.number().int().optional(),
  city: z.string().optional(),
  skills: z.array(z.string()).default([]),
  githubUsername: z.string().optional(),
  role: Role,
  photoUrl: url.optional(),
  /** Staff and participants belong to one event; the super admin has "*". */
  eventId: z.string().optional(),
  disabled: z.boolean().optional(),
  /** Doc ID of the volunteer's current PIN in events/{id}/volunteerPins. */
  pinKey: z.string().optional(),
});
export type User = z.infer<typeof User>;

/** Doc ID is `${type}_${hash}`, so a second account with the same phone/email fails to create. */
export const UniqueKey = z.object({ uid: id, createdAt: FirestoreTimestamp });
export type UniqueKey = z.infer<typeof UniqueKey>;

/** Outbox message (plan 4.4). Doc ID is deterministic: `${reason}_${refId}_${uid}`. */
export const OutboxMessage = z.object({
  channel: Channel,
  to: z.object({ uid: id }),
  template: z.string(),
  vars: z.record(z.string(), z.string()),
  priority: Priority,
  status: OutboxStatus,
  attempts: z.number().int(),
  lastError: z.string().optional(),
  lockedBy: z.string().optional(),
  lockedAt: FirestoreTimestamp.optional(),
  createdAt: FirestoreTimestamp,
  sentAt: FirestoreTimestamp.optional(),
});
export type OutboxMessage = z.infer<typeof OutboxMessage>;

export const InboxMessage = z.object({
  from: z.string(),
  text: z.string(),
  receivedAt: FirestoreTimestamp,
  processed: z.boolean(),
  command: z.string().optional(),
});
export type InboxMessage = z.infer<typeof InboxMessage>;

export const WaSession = z.object({ data: z.string() });
export type WaSession = z.infer<typeof WaSession>;

export const WaStatus = z.object({
  state: WaConnectionState,
  lastConnectedAt: FirestoreTimestamp.optional(),
  queued: z.number().int(),
  sentToday: z.number().int(),
  failedToday: z.number().int(),
});
export type WaStatus = z.infer<typeof WaStatus>;

export const Certificate = z.object({
  uid: id,
  eventId: id,
  type: CertificateType,
  issuedAt: FirestoreTimestamp,
});
export type Certificate = z.infer<typeof Certificate>;

/** Message template; body uses {{var}} placeholders. */
export const Template = z.object({ channel: Channel, body: z.string() });
export type Template = z.infer<typeof Template>;

// ---------- events/{eventId} ----------

export const EligibilityRules = z.object({
  allowedYears: z.array(z.number().int()).optional(),
  allowedColleges: z.array(z.string()).optional(),
  requiredFields: z.array(z.string()).default([]),
});
export type EligibilityRules = z.infer<typeof EligibilityRules>;

export const Round = z.object({ id, name: z.string(), startAt: FirestoreTimestamp, endAt: FirestoreTimestamp });

export const Event = z.object({
  name: z.string(),
  /** Short code volunteers type with their PIN on the scanner login. */
  code: z.string(),
  mode: EventMode,
  startAt: FirestoreTimestamp,
  endAt: FirestoreTimestamp,
  teamMin: z.number().int().min(1),
  teamMax: z.number().int().min(1),
  tracks: z.array(z.string()),
  rounds: z.array(Round),
  eligibilityRules: EligibilityRules,
  deadlines: z.object({ teamLock: FirestoreTimestamp, submission: FirestoreTimestamp }),
  leaderboardVisible: z.boolean(),
  rosterVersion: z.number().int(),
  /** Set when the team-lock job has run. */
  teamsLockedAt: FirestoreTimestamp.optional(),
});
export type Event = z.infer<typeof Event>;

export const Participant = z.object({
  // Copied from users/{uid} so the admin list can filter and show them without extra reads.
  name: z.string(),
  college: z.string().optional(),
  registeredAt: FirestoreTimestamp,
  status: ParticipantStatus,
  eligibility: z
    .object({
      result: EligibilityResult,
      reason: z.string(),
      /** True after a manual override; re-running the rules leaves it alone. */
      override: z.boolean().optional(),
    })
    .optional(),
  teamId: id.optional(),
  track: z.string().optional(),
  slotId: id.optional(),
  roomId: id.optional(),
  seat: z.string().optional(),
  checkedInAt: FirestoreTimestamp.optional(),
  /** ID of the official check-in (events/{id}/checkins/{checkinId}). */
  checkinId: z.string().optional(),
  enrollment: z
    .object({ status: EnrollmentStatus, devicePubKey: z.string().optional() })
    .optional(),
  openToReplacement: z
    .object({ on: z.boolean(), skills: z.array(z.string()), availability: z.string() })
    .optional(),
  /** SHA-256 of the backup code; the plain code is only shown on the participant's ID card. */
  backupCode: z.string().optional(),
  /** Event rosterVersion when this record last changed; the roster endpoint sends records newer than ?since. */
  rosterVersion: z.number().int(),
  /** Set when this record was merged into another as a duplicate. */
  mergedInto: id.optional(),
  /** Set when the participant withdrew from their team (plan D11). */
  withdrawnAt: FirestoreTimestamp.optional(),
});
export type Participant = z.infer<typeof Participant>;

export const Team = z.object({
  name: z.string(),
  inviteCode: z.string(),
  leaderUid: id,
  memberUids: z.array(id),
  track: z.string().optional(),
  status: TeamStatus,
  repoUrl: url.optional(),
});
export type Team = z.infer<typeof Team>;

export const TeamChangeRequest = z.object({
  type: TeamChangeType,
  uid: id,
  teamId: id,
  status: RequestStatus,
  reason: z.string().optional(),
});
export type TeamChangeRequest = z.infer<typeof TeamChangeRequest>;

export const Duplicate = z.object({
  uidA: id,
  uidB: id,
  matchType: DuplicateMatchType,
  score: z.number(),
  status: DuplicateStatus,
});
export type Duplicate = z.infer<typeof Duplicate>;

export const WaitlistEntry = z.object({
  position: z.number().int(),
  eligible: z.boolean(),
  offeredAt: FirestoreTimestamp.optional(),
  status: WaitlistStatus,
  registeredAt: FirestoreTimestamp,
  offerExpiresAt: FirestoreTimestamp.optional(),
  /** Set when the replacement chain made the offer; that chain also expires it. */
  replacementId: id.optional(),
});
export type WaitlistEntry = z.infer<typeof WaitlistEntry>;

export const Replacement = z.object({
  teamId: id,
  vacantUid: id,
  candidates: z.array(id),
  currentCandidate: id.optional(),
  inviteExpiresAt: FirestoreTimestamp.optional(),
  /** Candidates who declined or let the invitation expire. */
  passed: z.array(id).default([]),
  /** Set when the candidate accepts; the admin approves after. */
  acceptedUid: id.optional(),
  status: ReplacementStatus,
  createdAt: FirestoreTimestamp,
});
export type Replacement = z.infer<typeof Replacement>;

export const Slot = z.object({
  startAt: FirestoreTimestamp,
  endAt: FirestoreTimestamp,
  capacity: z.number().int().min(0),
  booked: z.number().int().min(0),
  /** Set when the post-slot rebalance has run. */
  rebalancedAt: FirestoreTimestamp.optional(),
});
export type Slot = z.infer<typeof Slot>;

export const Room = z.object({
  name: z.string(),
  floor: z.string(),
  capacity: z.number().int().min(0),
  track: z.string().optional(),
  occupied: z.number().int().min(0),
  mentorDesk: z.boolean(),
});
export type Room = z.infer<typeof Room>;

/** Doc ID is the SHA-256 of the token; the plain token is only in the enrollment link. */
export const EnrollToken = z.object({ uid: id, expiresAt: FirestoreTimestamp, used: z.boolean() });
export type EnrollToken = z.infer<typeof EnrollToken>;

/** Doc ID is the UUID from the volunteer device. Hash fields follow crypto.ChainEntryBody. */
export const Checkin = z.object({
  participantId: id,
  deviceId: id,
  volunteerUid: id,
  ts: z.string(), // ISO time from the volunteer device; part of the hash
  method: CheckinMethod,
  result: CheckinResult,
  rejectReason: CheckinRejectReason.optional(),
  overrideNote: z.string().optional(),
  prevHash: z.string(),
  entryHash: z.string(),
  processed: z.boolean(),
  flagged: z.boolean(),
  chain: z.enum(["ok", "broken"]).optional(), // set by the server processor
  /**
   * The server's verdict. Kept apart from `result`, which is the device's own
   * record and part of the hash, so the chain still verifies after processing.
   */
  serverResult: z.enum(["official", "duplicate", "rejected", "broken"]).optional(),
  /** Organizer resolution of a flagged check-in. */
  resolution: z
    .object({ action: z.enum(["dismissed", "made_official"]), by: id, reason: z.string() })
    .optional(),
});
export type Checkin = z.infer<typeof Checkin>;

/** events/{id}/stats/live. Server-written only. */
export const LiveStats = z.object({
  registrations: z.number().int(),
  eligible: z.number().int(),
  flagged: z.number().int(),
  teams: z.number().int(),
  enrolled: z.number().int(),
  checkedIn: z.number().int(),
  arrivedBySlot: z.record(z.string(), z.object({ expected: z.number(), arrived: z.number() })),
  roomOccupancy: z.record(z.string(), z.object({ capacity: z.number(), occupied: z.number() })),
  submissions: z.number().int(),
  outbox: z.object({ queued: z.number(), sent: z.number(), failed: z.number() }),
  openTickets: z.number().int(),
  updatedAt: FirestoreTimestamp,
});
export type LiveStats = z.infer<typeof LiveStats>;

export const Audience = z.object({ type: AudienceType, ids: z.array(z.string()).default([]) });
export type Audience = z.infer<typeof Audience>;

export const ScheduleItem = z.object({
  title: z.string(),
  startAt: FirestoreTimestamp,
  endAt: FirestoreTimestamp,
  location: z.string().optional(),
  audience: Audience,
});
export type ScheduleItem = z.infer<typeof ScheduleItem>;

export const Problem = z.object({
  track: z.string(),
  title: z.string(),
  body: z.string(),
  releaseAt: FirestoreTimestamp,
  released: z.boolean(),
});
export type Problem = z.infer<typeof Problem>;

export const Announcement = z.object({
  title: z.string(),
  body: z.string(),
  audience: Audience,
  emergency: z.boolean(),
  createdBy: id,
  sentAt: FirestoreTimestamp.optional(),
  seenCount: z.number().int(),
});
export type Announcement = z.infer<typeof Announcement>;

export const AnnouncementSeen = z.object({ seenAt: FirestoreTimestamp });

export const MentorSlot = z.object({
  mentorUid: id,
  startAt: FirestoreTimestamp,
  teamId: id.optional(),
  status: MentorSlotStatus,
  notes: z.string().optional(),
});
export type MentorSlot = z.infer<typeof MentorSlot>;

export const ProgressUpdate = z.object({ teamId: id, text: z.string(), createdAt: FirestoreTimestamp });
export type ProgressUpdate = z.infer<typeof ProgressUpdate>;

export const Ticket = z.object({
  createdBy: id,
  roomId: id.optional(),
  text: z.string(),
  assignedTo: id.optional(),
  status: TicketStatus,
});
export type Ticket = z.infer<typeof Ticket>;

export const Task = z.object({
  title: z.string(),
  assignedTo: id.optional(),
  shift: z.string().optional(),
  dueAt: FirestoreTimestamp.optional(),
  status: TaskStatus,
});
export type Task = z.infer<typeof Task>;

/** Doc ID is `${uid}_${mealId}`, so a second claim of the same meal fails to create. */
export const FoodClaim = z.object({ claimedAt: FirestoreTimestamp, counter: z.string() });
export type FoodClaim = z.infer<typeof FoodClaim>;

export const TravelPlan = z.object({
  city: z.string(),
  route: z.string(),
  mode: z.string(),
  departAt: FirestoreTimestamp,
  arriveAt: FirestoreTimestamp,
});
export type TravelPlan = z.infer<typeof TravelPlan>;

export const Circle = z.object({
  members: z.array(id),
  route: z.string(),
  meetupPoint: z.string().optional(),
  carpool: z.boolean().default(false),
});
export type Circle = z.infer<typeof Circle>;

export const CircleMessage = z.object({ uid: id, text: z.string(), sentAt: FirestoreTimestamp });

export const RubricCriterion = z.object({
  id,
  name: z.string(),
  weight: z.number().min(0).max(100),
  max: z.number().positive(),
});
export const Rubric = z
  .object({ criteria: z.array(RubricCriterion).min(1) })
  .refine((r) => r.criteria.reduce((sum, c) => sum + c.weight, 0) === 100, {
    message: "Criteria weights must total 100",
  });
export type Rubric = z.infer<typeof Rubric>;

export const JudgeAssignment = z.object({ teamIds: z.array(id) });
export type JudgeAssignment = z.infer<typeof JudgeAssignment>;

export const GithubInsights = z.object({
  commits: z.number().int(),
  contributors: z.array(z.object({ login: z.string(), commits: z.number().int(), uid: id.optional() })),
  flags: z.array(z.object({ sha: z.string(), reason: z.enum(["before_start", "after_deadline"]) })),
  fetchedAt: FirestoreTimestamp.optional(),
});
export type GithubInsights = z.infer<typeof GithubInsights>;

/** submissions/{teamId} holds the latest version; submissions/{teamId}/versions/{n} holds each one. */
export const Submission = z.object({
  pptUrl: url.optional(),
  videoUrl: url.optional(),
  repoUrl: url.optional(),
  submittedAt: FirestoreTimestamp, // server time
  version: z.number().int().min(1),
  receiptId: z.string(),
  github: GithubInsights.optional(),
  aiSummary: z.string().optional(),
});
export type Submission = z.infer<typeof Submission>;

/** Doc ID is `${judgeUid}_${teamId}`. */
export const Score = z.object({
  criteria: z.record(z.string(), z.number()),
  total: z.number(),
  comment: z.string().optional(),
  locked: z.boolean(),
  lockedAt: FirestoreTimestamp.optional(),
});
export type Score = z.infer<typeof Score>;

/** events/{id}/leaderboard/current. Server-written only. */
export const Leaderboard = z.object({
  teams: z.array(
    z.object({
      teamId: id,
      rank: z.number().int(),
      total: z.number(),
      breakdown: z.record(z.string(), z.number()),
    }),
  ),
  computedAt: FirestoreTimestamp,
});
export type Leaderboard = z.infer<typeof Leaderboard>;

export const Reward = z.object({
  prize: z.string(),
  amount: z.number().optional(),
  type: z.string(),
  sponsor: z.string().optional(),
  winnerTeamId: id.optional(),
  dueAt: FirestoreTimestamp,
  status: RewardStatus,
  proofUrl: url.optional(),
  confirmedAt: FirestoreTimestamp.optional(),
});
export type Reward = z.infer<typeof Reward>;

export const Complaint = z.object({
  rewardId: id.optional(),
  uid: id,
  text: z.string(),
  evidenceUrls: z.array(url).default([]),
  status: ComplaintStatus,
  deadline: FirestoreTimestamp,
  history: z.array(z.object({ at: FirestoreTimestamp, by: id, note: z.string() })).default([]),
});
export type Complaint = z.infer<typeof Complaint>;

const ratingScore = z.number().int().min(1).max(5);
export const Rating = z.object({
  scores: z.object({
    organization: ratingScore,
    mentors: ratingScore,
    judging: ratingScore,
    comms: ratingScore,
    infra: ratingScore,
    rewards: ratingScore,
  }),
  text: z.string().optional(),
  response: z.string().optional(),
});
export type Rating = z.infer<typeof Rating>;

export const Connection = z.object({ fromUid: id, toUid: id, status: ConnectionStatus });
export type Connection = z.infer<typeof Connection>;

/** Create-only. Every admin mutation writes one (plan D3). */
export const AuditEntry = z.object({
  actor: id,
  action: z.string(),
  target: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().optional(),
  ts: FirestoreTimestamp,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Firebase Auth custom claims (plan 4.1). */
export const Claims = z.object({ role: Role, eventId: z.string() });
export type Claims = z.infer<typeof Claims>;
