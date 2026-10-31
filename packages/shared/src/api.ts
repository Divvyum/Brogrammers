import { z } from "zod";
import {
  AudienceType,
  Channel,
  CertificateType,
  ComplaintStatus,
  EligibilityResult,
  EventMode,
  OutboxStatus,
  ParticipantStatus,
  RewardStatus,
  StaffRole,
  TaskStatus,
} from "./enums.js";
import { EligibilityRules, RubricCriterion } from "./schemas.js";

// Request bodies and queries for /api/admin/* (plan 4.6). Dates are ISO strings
// over the wire; the server stores them as Firestore Timestamps and sends them
// back as ISO strings.

const iso = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)");

/** Cursor pagination: pass `next` from the previous page as `after`. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  after: z.string().optional(),
});

// ---------- D5 staff ----------

export const CreateStaffBody = z.object({
  email: z.email(),
  name: z.string().trim().min(1),
  role: StaffRole,
  /** Required unless the caller is an organizer (then it's their own event). */
  eventId: z.string().optional(),
});
export type CreateStaffBody = z.infer<typeof CreateStaffBody>;

export const ChangeRoleBody = z.object({ role: StaffRole, reason });
export const DisableStaffBody = z.object({ disabled: z.boolean().default(true), reason });

export const VolunteerLoginBody = z.object({
  eventCode: z.string().trim().min(1),
  pin: z.string().regex(/^\d{6}$/, "PIN is 6 digits"),
});
export type VolunteerLoginBody = z.infer<typeof VolunteerLoginBody>;

// ---------- D6 events ----------

export const EventBody = z
  .object({
    name: z.string().trim().min(1),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{4,12}$/, "4–12 capital letters or digits"),
    mode: EventMode,
    startAt: iso,
    endAt: iso,
    teamMin: z.number().int().min(1),
    teamMax: z.number().int().min(1),
    tracks: z.array(z.string().trim().min(1)).min(1),
    rounds: z
      .array(z.object({ id: z.string(), name: z.string(), startAt: iso, endAt: iso }))
      .default([]),
    eligibilityRules: EligibilityRules.default({ requiredFields: [] }),
    deadlines: z.object({ teamLock: iso, submission: iso }),
    leaderboardVisible: z.boolean().default(false),
  })
  .refine((e) => e.teamMin <= e.teamMax, { message: "teamMin must be ≤ teamMax", path: ["teamMin"] })
  .refine((e) => e.startAt < e.endAt, { message: "Event must end after it starts", path: ["endAt"] });
export type EventBody = z.infer<typeof EventBody>;

// PATCH: any subset; the server re-validates the merged result.
export const EventPatchBody = z.object({
  name: z.string().trim().min(1).optional(),
  mode: EventMode.optional(),
  startAt: iso.optional(),
  endAt: iso.optional(),
  teamMin: z.number().int().min(1).optional(),
  teamMax: z.number().int().min(1).optional(),
  tracks: z.array(z.string().trim().min(1)).min(1).optional(),
  eligibilityRules: EligibilityRules.optional(),
  deadlines: z.object({ teamLock: iso, submission: iso }).partial().optional(),
  leaderboardVisible: z.boolean().optional(),
});

// ---------- D8 registrations + duplicates ----------

export const ParticipantListQuery = PageQuery.extend({
  status: ParticipantStatus.optional(),
  college: z.string().optional(),
  track: z.string().optional(),
  teamId: z.string().optional(),
});

/** One CSV row. Column names match these keys; skills are separated by ";" or "|". */
export const RegistrationRow = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  phone: z.string().regex(/^\+?[\d\s-]{10,15}$/, "Invalid phone"),
  college: z.string().trim().optional(),
  year: z.coerce.number().int().min(1).max(6).optional(),
  city: z.string().trim().optional(),
  skills: z.string().optional(),
  githubUsername: z.string().trim().optional(),
  track: z.string().trim().optional(),
  teamName: z.string().trim().optional(),
});
export type RegistrationRow = z.infer<typeof RegistrationRow>;

export const ImportBody = z.object({ csv: z.string().min(1) });

export const DuplicateActionBody = z.object({ reason });

// ---------- D9 eligibility ----------

export const EligibilityRunBody = z.object({ uid: z.string().optional() });
export const EligibilityOverrideBody = z.object({ result: EligibilityResult, reason });

// ---------- D10 teams ----------

export const TeamRequestDecisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});
export const ForceMemberBody = z.object({ uid: z.string().min(1), reason });

// ---------- D11 waitlist + replacement ----------

export const WithdrawBody = z.object({ uid: z.string().min(1), reason });
export const ReplacementApproveBody = z.object({ reason: z.string().optional() });
export const AddWaitlistBody = z.object({ uids: z.array(z.string().min(1)).min(1).max(200) });

// ---------- D12 slots, rooms, allotment ----------

export const SlotBody = z
  .object({ startAt: iso, endAt: iso, capacity: z.number().int().min(0) })
  .refine((s) => s.startAt < s.endAt, { message: "Slot must end after it starts", path: ["endAt"] });
export const RoomBody = z.object({
  name: z.string().trim().min(1),
  floor: z.string().trim().default(""),
  capacity: z.number().int().min(0),
  track: z.string().optional(),
  mentorDesk: z.boolean().default(false),
});
export const MoveParticipantBody = z.object({ roomId: z.string().min(1), reason });

// ---------- D13 digital ID ----------

export const SendEnrollmentBody = z.object({
  /** Omit to send to every eligible participant who isn't enrolled yet. */
  uids: z.array(z.string()).optional(),
});
export const RevokeBody = z.object({ reason });
export const RosterQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

// ---------- D14 check-ins ----------

export const CheckinListQuery = PageQuery.extend({
  filter: z.enum(["all", "valid", "flagged", "rejected", "manual", "broken"]).default("all"),
});
export const ResolveCheckinBody = z.object({
  action: z.enum(["dismissed", "made_official"]),
  reason,
});

// ---------- shared ----------

export const AudienceBody = z.object({ type: AudienceType, ids: z.array(z.string()).default([]) });

// ---------- D16 schedule ----------

export const ScheduleBody = z
  .object({
    title: z.string().trim().min(1),
    startAt: iso,
    endAt: iso,
    location: z.string().trim().optional(),
    audience: AudienceBody,
  })
  .refine((s) => s.startAt < s.endAt, { message: "Must end after it starts", path: ["endAt"] });
export type ScheduleBody = z.infer<typeof ScheduleBody>;

// ---------- D17 problems ----------

export const ProblemBody = z.object({
  track: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  releaseAt: iso,
});
export type ProblemBody = z.infer<typeof ProblemBody>;

// ---------- D18 announcements ----------

export const AnnouncementBody = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  audience: AudienceBody,
  emergency: z.boolean().default(false),
});
export type AnnouncementBody = z.infer<typeof AnnouncementBody>;

export const AiDraftBody = z.object({
  notes: z.string().trim().min(3).max(2000),
  tone: z.enum(["friendly", "formal", "urgent"]).default("friendly"),
});

// ---------- D19 outbox ----------

export const TemplateBody = z.object({ channel: Channel, body: z.string().min(1).max(1000) });
export const OutboxQuery = PageQuery.extend({
  status: OutboxStatus.optional(),
  template: z.string().optional(),
  uid: z.string().optional(),
});

// ---------- D20 mentors ----------

export const MentorTracksBody = z.object({ tracks: z.array(z.string().min(1)) });
export const MentorAvailabilityBody = z.object({
  windows: z
    .array(z.object({ startAt: iso, endAt: iso }).refine((w) => w.startAt < w.endAt, "Window must end after it starts"))
    .min(1),
  slotMinutes: z.number().int().min(5).max(120).default(15),
});
export const MentorNoteBody = z.object({ notes: z.string().trim().max(2000) });

// ---------- D21 volunteer operations ----------

export const TaskBody = z.object({
  title: z.string().trim().min(1),
  assignedTo: z.string().optional(),
  shift: z.string().optional(),
  dueAt: iso.optional(),
});
export const TaskUpdateBody = z.object({
  status: TaskStatus.optional(),
  assignedTo: z.string().optional(),
  notes: z.string().optional(),
});
export const TicketAssignBody = z.object({ assignedTo: z.string().min(1) });
export const TicketResolveBody = z.object({ resolution: z.string().trim().min(1) });
export const MealsBody = z.object({
  meals: z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), name: z.string().min(1), startAt: iso, endAt: iso })),
  counters: z.array(z.string().min(1)).default([]),
});
export const FoodScanBody = z.object({
  token: z.string().min(10),
  mealId: z.string().min(1),
  counter: z.string().min(1),
});

// ---------- D22 judging setup ----------

export const RubricBody = z
  .object({ criteria: z.array(RubricCriterion).min(1) })
  .refine((r) => r.criteria.reduce((t, c) => t + c.weight, 0) === 100, {
    message: "Criteria weights must total 100",
    path: ["criteria"],
  })
  .refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, {
    message: "Criterion IDs must be unique",
    path: ["criteria"],
  });
export const JudgeAssignBody = z.object({ teamIds: z.array(z.string()) });
export const AutoAssignBody = z.object({ judgesPerTeam: z.number().int().min(1).max(10).default(2) });

// ---------- D23 submissions ----------

export const SubmissionSettingsBody = z.object({
  deadline: iso.optional(),
  locked: z.boolean().optional(),
});

// ---------- D24 scoring ----------

export const ScoreBody = z.object({
  criteria: z.record(z.string(), z.number().min(0)),
  comment: z.string().max(2000).optional(),
  /** true submits and locks the score. */
  submit: z.boolean().default(false),
  /** Required when changing a locked score. */
  reason: z.string().trim().min(3).optional(),
  round: z.string().default("current"),
});
export type ScoreBody = z.infer<typeof ScoreBody>;
export const VisibilityBody = z.object({ visible: z.boolean() });

// ---------- D25 certificates ----------

export const IssueCertificatesBody = z.object({
  type: CertificateType,
  /** Omit to issue to everyone who qualifies (checked in / top 3 teams / mentors). */
  uids: z.array(z.string()).optional(),
  /** Winner certificates: how many top teams. */
  topTeams: z.number().int().min(1).max(10).default(3),
});

// ---------- D26 rewards, complaints, ratings ----------

export const RewardBody = z.object({
  prize: z.string().trim().min(1),
  amount: z.number().min(0).optional(),
  type: z.string().trim().min(1),
  sponsor: z.string().trim().optional(),
  winnerTeamId: z.string().optional(),
  dueAt: iso,
});
export const RewardStatusBody = z.object({ status: RewardStatus, note: z.string().optional() });
export const RewardProofBody = z.object({ proofUrl: z.url() });
export const ComplaintRespondBody = z.object({ note: z.string().trim().min(1), status: ComplaintStatus.optional() });
export const RatingResponseBody = z.object({ response: z.string().trim().min(1) });
export const UploadSignatureBody = z.object({ folder: z.enum(["reward-proofs", "complaint-evidence"]) });
