import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "../../app/.server/providers/retry";
import { isRateLimit, TranslationProviderError } from "../../app/.server/providers/types";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

describe("parseRetryAfter", () => {
  it("reads delta-seconds, decimals included", () => {
    expect(parseRetryAfter("7", NOW)).toBe(7000);
    expect(parseRetryAfter(" 1.5 ", NOW)).toBe(1500);
    expect(parseRetryAfter("0", NOW)).toBe(0);
  });

  it("reads an HTTP date relative to now, and a date in the past as 0", () => {
    expect(parseRetryAfter("Sun, 01 Nov 2026 12:00:30 GMT", NOW)).toBe(30_000);
    expect(parseRetryAfter("Sunday, 01-Nov-26 12:01:00 GMT", NOW)).toBe(60_000);
    expect(parseRetryAfter("Sat, 31 Oct 2026 12:00:00 GMT", NOW)).toBe(0);
  });

  it("is undefined when absent or unreadable, never negative", () => {
    for (const value of [null, "", "  ", "soon", "-5", "1e3", "7s", "Mon, 99 Foo 2026"]) {
      expect(parseRetryAfter(value, NOW)).toBeUndefined();
    }
  });
});

describe("isRateLimit", () => {
  it("is true for DeepL 429/529 and any rate-limited reason, not for other errors", () => {
    expect(isRateLimit(new TranslationProviderError("deepl", "retryable", "HTTP 429", 429))).toBe(true);
    expect(isRateLimit(new TranslationProviderError("deepl", "retryable", "HTTP 529", 529))).toBe(true);
    const google = new TranslationProviderError("google", "retryable", "HTTP 403 PERMISSION_DENIED rateLimitExceeded", 403);
    google.reason = "RATE_LIMITED";
    expect(isRateLimit(google)).toBe(true);
    expect(isRateLimit(new TranslationProviderError("azure", "retryable", "HTTP 503", 503))).toBe(false);
    expect(isRateLimit(new TranslationProviderError("deepl", "quota", "HTTP 456", 456))).toBe(false);
  });

  it("is false for Google's used-up quota answered with HTTP 429 (it rests the engine and fails over)", () => {
    expect(isRateLimit(new TranslationProviderError("google", "quota", "HTTP 429 RESOURCE_EXHAUSTED RESOURCE_QUOTA_EXCEEDED", 429))).toBe(false);
    expect(isRateLimit(new TranslationProviderError("google", "quota", "HTTP 429 RESOURCE_EXHAUSTED DefaultPerDayPerProject", 429))).toBe(false);
  });
});
