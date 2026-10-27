import { describe, expect, it } from "vitest";
import { aiUsageLimits, getConfig } from "../../app/.server/lib/config";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
};

describe("getConfig", () => {
  it("accepts a valid environment and applies defaults", () => {
    const config = getConfig({ ...valid } as NodeJS.ProcessEnv);
    expect(config.NODE_ENV).toBe("development");
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("rejects a weak encryption key without echoing its value", () => {
    const weak = "k1:c2hvcnQ=";
    let message = "";
    try {
      getConfig({ ...valid, TOKEN_ENCRYPTION_KEYS: weak } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/TOKEN_ENCRYPTION_KEYS/);
    expect(message).not.toContain(weak);
  });

  it("requires DATABASE_URL", () => {
    expect(() =>
      getConfig({
        TOKEN_ENCRYPTION_KEYS: valid.TOKEN_ENCRYPTION_KEYS,
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("getConfig: background jobs and providers", () => {
  it("refuses the mock provider in production", () => {
    expect(() =>
      getConfig({ ...valid, NODE_ENV: "production", TRANSLATION_PROVIDER: "mock" } as NodeJS.ProcessEnv),
    ).toThrow(/TRANSLATION_PROVIDER/);
  });

  it("allows the mock provider in development and applies job defaults", () => {
    const config = getConfig({ ...valid, TRANSLATION_PROVIDER: "mock" } as NodeJS.ProcessEnv);
    expect(config.TRANSLATION_PROVIDER).toBe("mock");
    expect(config.WORKER_CONCURRENCY).toBe(5);
    expect(config.SHOPIFY_JOB_RESTORE_PER_SECOND).toBe(80);
  });
});

describe("getConfig: AI cost limits", () => {
  it("requires Redis in production so rate limits are shared", () => {
    expect(() => getConfig({ ...valid, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/REDIS_URL/);
    expect(() =>
      getConfig({ ...valid, NODE_ENV: "production", REDIS_URL: "redis://localhost:6379" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("never lets the daily cap exceed the monthly allowance", () => {
    const base = getConfig({ ...valid } as NodeJS.ProcessEnv);
    expect(aiUsageLimits(base)).toEqual({ limit: 20_000, dailyLimit: 20_000, platformDailyLimit: 100_000 });
    const custom = getConfig({ ...valid, AI_MONTHLY_CHAR_LIMIT: "5000", AI_DAILY_CHAR_LIMIT: "9000" } as NodeJS.ProcessEnv);
    expect(aiUsageLimits(custom).dailyLimit).toBe(5000);
    expect(() => getConfig({ ...valid, AI_USER_REQUESTS_PER_MINUTE: "0" } as NodeJS.ProcessEnv)).toThrow(
      /AI_USER_REQUESTS_PER_MINUTE/,
    );
  });
});
