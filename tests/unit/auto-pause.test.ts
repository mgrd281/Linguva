/**
 * Pauses follow the payer (app/.server/settings/shop-settings.ts): on the Own
 * key plan only a pause for one of the merchant's keys holds automatic
 * translation, on every other plan only Linguva's reasons do, and a missing
 * key never pauses (no item is created without one).
 */
import { describe, expect, it } from "vitest";
import { AUTO_PAUSE_CODES, autoPauseApplies, autoTranslatePaused } from "../../app/.server/settings/shop-settings";
import { ENGINE_IDS } from "../../app/lib/engines";
import { ownKeyStopCode } from "../../app/lib/own-keys";

const NOW = new Date("2026-11-01T12:00:00Z");
const until = new Date("2026-11-01T13:00:00Z");
const paused = (reason: string | null) => ({ autoPausedUntil: until, autoPauseReason: reason });

describe("autoPauseApplies", () => {
  it("an own-key reason holds an Own key shop only", () => {
    for (const engine of ENGINE_IDS) {
      for (const kind of ["quota", "auth"] as const) {
        const settings = paused(ownKeyStopCode(kind, engine));
        expect(autoPauseApplies(settings, true, NOW)).toBe(true);
        expect(autoPauseApplies(settings, false, NOW)).toBe(false);
      }
    }
  });

  it("Linguva's reasons hold the other plans only", () => {
    for (const reason of ["QUOTA_EXCEEDED", "DAILY_LIMIT", "PLATFORM_LIMIT", "PROVIDER_AUTH", "PROVIDER_QUOTA", "AI_NOT_CONFIGURED"]) {
      expect(autoPauseApplies(paused(reason), false, NOW)).toBe(true);
      expect(autoPauseApplies(paused(reason), true, NOW)).toBe(false);
    }
  });

  it("a pause without a reason is the operator's; an ended or absent pause holds nobody", () => {
    expect(autoPauseApplies(paused(null), false, NOW)).toBe(true);
    expect(autoPauseApplies(paused(null), true, NOW)).toBe(false);
    for (const ownKeys of [true, false]) {
      expect(autoPauseApplies({ autoPausedUntil: null, autoPauseReason: null }, ownKeys, NOW)).toBe(false);
      expect(autoPauseApplies({ autoPausedUntil: new Date("2026-11-01T11:00:00Z"), autoPauseReason: "OWN_KEY_QUOTA_DEEPL" }, ownKeys, NOW)).toBe(false);
    }
  });

  it("keeps autoTranslatePaused's meaning (the webhook gate reads no billing)", () => {
    expect(autoTranslatePaused(paused("OWN_KEY_AUTH_GOOGLE"), NOW)).toBe(true);
    expect(autoTranslatePaused(paused("QUOTA_EXCEEDED"), NOW)).toBe(true);
  });
});

describe("own-key pauses", () => {
  it("pause for a refused or used-up key of every engine, never for a missing key", () => {
    for (const engine of ENGINE_IDS) {
      expect(AUTO_PAUSE_CODES).toContain(ownKeyStopCode("auth", engine));
      expect(AUTO_PAUSE_CODES).toContain(ownKeyStopCode("quota", engine));
    }
    expect(AUTO_PAUSE_CODES).not.toContain("OWN_KEY_MISSING");
    // Linguva's own pauses are still there, unchanged.
    for (const code of ["DAILY_LIMIT", "PLATFORM_LIMIT", "QUOTA_EXCEEDED", "AI_NOT_CONFIGURED", "PROVIDER_AUTH", "PROVIDER_QUOTA"]) expect(AUTO_PAUSE_CODES).toContain(code);
  });
});
