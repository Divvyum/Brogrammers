import { HttpError } from "../../core/http.js";

type ParticipantApproval = {
  eligibility?: { result?: string };
  status?: string;
  mergedInto?: string;
  withdrawnAt?: unknown;
};

/** Only an active participant explicitly approved by eligibility may bind a device. */
export function assertEnrollmentApproved(participant: ParticipantApproval) {
  if (participant.mergedInto || participant.withdrawnAt) {
    throw new HttpError(409, "INACTIVE_REGISTRATION", "This registration is no longer active");
  }
  if (participant.status === "rejected" || participant.eligibility?.result !== "eligible") {
    throw new HttpError(
      403,
      "APPROVAL_REQUIRED",
      "An organizer must approve this participant before device enrollment",
    );
  }
}
