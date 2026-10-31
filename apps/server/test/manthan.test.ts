import { describe, expect, it } from "vitest";
import { otpDigest, otpMatches, OTP_MAX_ATTEMPTS, OTP_TTL_MS } from "../src/participant/auth.js";
import { inviteCode } from "../src/participant/team.js";
import { commandAllowed, normalizeCommand } from "../src/whatsapp/commands.js";
import { reconnectDelay } from "../src/whatsapp/client.js";
import { retryDelay, throttleDelay } from "../src/whatsapp/worker.js";

describe("M2 WhatsApp connection policy", () => {
  it("backs off reconnects and caps the delay", () => {
    expect(reconnectDelay(0)).toBe(1_000);
    expect(reconnectDelay(3)).toBe(8_000);
    expect(reconnectDelay(99)).toBe(60_000);
  });
});

describe("M3 outbox policy", () => {
  it("uses exponential retries and human-like throttling", () => {
    expect(retryDelay(1)).toBe(2_000);
    expect(retryDelay(5)).toBe(32_000);
    for (let i = 0; i < 100; i++) expect(throttleDelay()).toBeGreaterThanOrEqual(1_000);
    for (let i = 0; i < 100; i++) expect(throttleDelay()).toBeLessThanOrEqual(2_000);
  });
});

describe("M4 commands", () => {
  it("is case-insensitive and sends unknown input to HELP", () => {
    expect(normalizeCommand(" my   room ")).toBe("MY ROOM");
    expect(normalizeCommand("status")).toBe("STATUS");
    expect(normalizeCommand("hello bot")).toBe("HELP");
  });
  it("rate limits a sender", () => {
    for (let i = 0; i < 6; i++) expect(commandAllowed("919999999999", 1_000 + i)).toBe(true);
    expect(commandAllowed("919999999999", 1_010)).toBe(false);
    expect(commandAllowed("919999999999", 62_000)).toBe(true);
  });
});

describe("M5 OTP", () => {
  it("hashes codes with the phone and compares safely", () => {
    const digest = otpDigest("phone-hash", "123456");
    expect(otpMatches(digest, otpDigest("phone-hash", "123456"))).toBe(true);
    expect(otpMatches(digest, otpDigest("other-phone", "123456"))).toBe(false);
    expect(OTP_TTL_MS).toBe(300_000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});

describe("M7 teams", () => {
  it("generates usable invite codes", () => {
    const codes = new Set(Array.from({ length: 100 }, inviteCode));
    expect(codes.size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9_-]{8}$/);
  });
});
