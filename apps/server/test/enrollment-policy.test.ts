import { describe, expect, it } from "vitest";
import { assertEnrollmentApproved } from "../src/admin/digital-id/enrollment-policy.js";

describe("participant enrollment approval", () => {
  it("allows an active participant approved by eligibility", () => {
    expect(() =>
      assertEnrollmentApproved({ status: "eligible", eligibility: { result: "eligible" } }),
    ).not.toThrow();
  });

  it("rejects a participant who has not been approved", () => {
    expect(() =>
      assertEnrollmentApproved({ status: "registered", eligibility: { result: "flagged" } }),
    ).toThrowError(/approve/i);
  });

  it("rejects an approved participant whose registration was withdrawn", () => {
    expect(() =>
      assertEnrollmentApproved({
        status: "eligible",
        eligibility: { result: "eligible" },
        withdrawnAt: "now",
      }),
    ).toThrowError(/active/i);
  });
});
