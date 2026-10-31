import { z } from "zod";
import {
  AudienceType,
  EligibilityResult,
  EventMode,
  ParticipantStatus,
  StaffRole,
} from "./enums.js";
import { EligibilityRules } from "./schemas.js";

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
