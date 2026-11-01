import { describe, expect, it } from "vitest";
import { wantsMessage } from "../src/core/prefs.js";

describe("notification preferences", () => {
  it("sends when the person never set preferences", () => {
    expect(wantsMessage(undefined, "announcement", 1, "whatsapp")).toBe(true);
  });
  it("skips a category turned off for that channel only", () => {
    const prefs = { announcements_WhatsApp: false, announcements_Push: true };
    expect(wantsMessage(prefs, "announcement", 1, "whatsapp")).toBe(false);
    expect(wantsMessage(prefs, "announcement", 1, "push")).toBe(true);
  });
  it("always sends emergencies, codes, receipts and command replies", () => {
    const off = { announcements_WhatsApp: false, results_WhatsApp: false };
    expect(wantsMessage(off, "announcement", 0, "whatsapp")).toBe(true);
    expect(wantsMessage(off, "otp", 1, "whatsapp")).toBe(true);
    expect(wantsMessage(off, "submission_receipt", 1, "whatsapp")).toBe(true);
    expect(wantsMessage(off, "command_reply", 1, "whatsapp")).toBe(true);
  });
});
