import { describe, expect, it } from "vitest";
import { aiUsageLimits, configWarnings, getConfig, logConfigWarnings } from "../../app/.server/lib/config";

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

describe("getConfig: values pasted into a hosting dashboard", () => {
  it("trims a DeepL key, drops quotes and treats an empty one as not set", () => {
    expect(getConfig({ ...valid, DEEPL_API_KEY: "  abc-123:fx\n" } as NodeJS.ProcessEnv).DEEPL_API_KEY).toBe("abc-123:fx");
    expect(getConfig({ ...valid, DEEPL_API_KEY: '"abc-123:fx"' } as NodeJS.ProcessEnv).DEEPL_API_KEY).toBe("abc-123:fx");
    expect(getConfig({ ...valid, DEEPL_API_KEY: "" } as NodeJS.ProcessEnv).DEEPL_API_KEY).toBeUndefined();
    expect(getConfig({ ...valid, DEEPL_API_KEY: "   " } as NodeJS.ProcessEnv).DEEPL_API_KEY).toBeUndefined();
  });

  it("accepts DeepL's address with /v2 or a trailing slash (the client adds /v2)", () => {
    for (const url of ["https://api-free.deepl.com", "https://api-free.deepl.com/", "https://api-free.deepl.com/v2", "https://api-free.deepl.com/v2/ "]) {
      expect(getConfig({ ...valid, DEEPL_API_URL: url } as NodeJS.ProcessEnv).DEEPL_API_URL).toBe("https://api-free.deepl.com");
    }
    expect(getConfig({ ...valid, DEEPL_API_URL: "" } as NodeJS.ProcessEnv).DEEPL_API_URL).toBeUndefined();
  });

  it("accepts DeepL's address only over https (the API key travels in a header), naming the variable, not the value", () => {
    expect(getConfig({ ...valid, DEEPL_API_URL: "HTTPS://api.deepl.com/v2/" } as NodeJS.ProcessEnv).DEEPL_API_URL).toBe("HTTPS://api.deepl.com");
    for (const url of ["http://deepl-relay.example", "ws://deepl-relay.example", "ftp://deepl-relay.example", "file:///deepl-relay/key", "javascript:deepl-relay", "deepl-relay.example"]) {
      let message = "";
      try {
        getConfig({ ...valid, DEEPL_API_URL: url } as NodeJS.ProcessEnv);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, url).toMatch(/DEEPL_API_URL/);
      expect(message, url).not.toContain("deepl-relay");
    }
  });

  it("reads character limits with thousands separators, never 450.000 as 450", () => {
    for (const value of ["450000", "450.000", "450,000", "450 000", " 450000 "]) {
      expect(getConfig({ ...valid, AI_MONTHLY_CHAR_LIMIT: value } as NodeJS.ProcessEnv).AI_MONTHLY_CHAR_LIMIT).toBe(450_000);
    }
    const config = getConfig({ ...valid, AI_DAILY_CHAR_LIMIT: "100.000", AI_PLATFORM_DAILY_CHAR_LIMIT: "1.200.000" } as NodeJS.ProcessEnv);
    expect([config.AI_DAILY_CHAR_LIMIT, config.AI_PLATFORM_DAILY_CHAR_LIMIT]).toEqual([100_000, 1_200_000]);
    // Empty: the default.
    expect(getConfig({ ...valid, AI_MONTHLY_CHAR_LIMIT: "" } as NodeJS.ProcessEnv).AI_MONTHLY_CHAR_LIMIT).toBe(20_000);
    // Ambiguous: refused with the variable's name, not guessed.
    expect(() => getConfig({ ...valid, AI_MONTHLY_CHAR_LIMIT: "1.5" } as NodeJS.ProcessEnv)).toThrow(/AI_MONTHLY_CHAR_LIMIT/);
  });
});

describe("configuration warnings at start", () => {
  const billing = { SHOPIFY_PARTNER_ORG_ID: "1", SHOPIFY_PARTNER_API_TOKEN: "prtapi_test_token", SHOPIFY_APP_GID: "gid://shopify/App/1", SHOPIFY_APP_HANDLE: "linguva" };

  it("warns when plans are required while the platform cap is below 1,000,000 a day", () => {
    const warnings = configWarnings(getConfig({ ...valid, ...billing, BILLING_REQUIRED: "true" } as NodeJS.ProcessEnv));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/AI_PLATFORM_DAILY_CHAR_LIMIT/);
    expect(configWarnings(getConfig({ ...valid, ...billing, BILLING_REQUIRED: "true", AI_PLATFORM_DAILY_CHAR_LIMIT: "3000000" } as NodeJS.ProcessEnv))).toEqual([]);
    // Without required plans (development, billing off), the safe default stays quiet.
    expect(configWarnings(getConfig({ ...valid } as NodeJS.ProcessEnv))).toEqual([]);
  });

  it("only logs, and never stops the start, even with an invalid configuration", () => {
    const logged: string[] = [];
    logConfigWarnings((message) => logged.push(message), { ...valid, ...billing, BILLING_REQUIRED: "true" } as NodeJS.ProcessEnv);
    expect(logged).toHaveLength(1);
    expect(() => logConfigWarnings((message) => logged.push(message), {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(logged).toHaveLength(1);
  });
});

describe("getConfig: the Own key plan", () => {
  const billing = { SHOPIFY_PARTNER_ORG_ID: "1", SHOPIFY_PARTNER_API_TOKEN: "prtapi_test_token", SHOPIFY_APP_GID: "gid://shopify/App/1", SHOPIFY_APP_HANDLE: "linguva" };

  it("hides the plan by default and accepts only on or off", () => {
    expect(getConfig({ ...valid } as NodeJS.ProcessEnv).OWN_KEY_PLAN_VISIBLE).toBe("off");
    expect(getConfig({ ...valid, OWN_KEY_PLAN_VISIBLE: "on" } as NodeJS.ProcessEnv).OWN_KEY_PLAN_VISIBLE).toBe("on");
    expect(getConfig({ ...valid, OWN_KEY_PLAN_VISIBLE: "off" } as NodeJS.ProcessEnv).OWN_KEY_PLAN_VISIBLE).toBe("off");
    for (const value of ["yes", "true", "ON", "1"]) {
      expect(() => getConfig({ ...valid, OWN_KEY_PLAN_VISIBLE: value } as NodeJS.ProcessEnv), value).toThrow(/OWN_KEY_PLAN_VISIBLE/);
    }
  });

  it("allows 3 key checks a minute per staff member by default", () => {
    expect(getConfig({ ...valid } as NodeJS.ProcessEnv).OWN_KEY_CHECKS_PER_MINUTE).toBe(3);
    expect(getConfig({ ...valid, OWN_KEY_CHECKS_PER_MINUTE: "5" } as NodeJS.ProcessEnv).OWN_KEY_CHECKS_PER_MINUTE).toBe(5);
    for (const value of ["0", "-1", "1.5", "many"]) {
      expect(() => getConfig({ ...valid, OWN_KEY_CHECKS_PER_MINUTE: value } as NodeJS.ProcessEnv), value).toThrow(/OWN_KEY_CHECKS_PER_MINUTE/);
    }
  });

  it("warns (never stops the start) when the plan is shown while billing is off outside production", () => {
    const warning = "OWN_KEY_PLAN_VISIBLE=on: the Own key plan is shown, but billing is off: no store can be on it";
    expect(configWarnings(getConfig({ ...valid, OWN_KEY_PLAN_VISIBLE: "on" } as NodeJS.ProcessEnv))).toEqual([warning]);
    expect(configWarnings(getConfig({ ...valid, ...billing, OWN_KEY_PLAN_VISIBLE: "on" } as NodeJS.ProcessEnv))).toEqual([]);
    expect(configWarnings(getConfig({ ...valid, OWN_KEY_PLAN_VISIBLE: "off" } as NodeJS.ProcessEnv))).toEqual([]);
    // Billing is on only with every Partner setting partnerApiSettings needs.
    const withoutToken = Object.fromEntries(Object.entries(billing).filter(([name]) => name !== "SHOPIFY_PARTNER_API_TOKEN"));
    expect(configWarnings(getConfig({ ...valid, ...withoutToken, OWN_KEY_PLAN_VISIBLE: "on" } as NodeJS.ProcessEnv))).toEqual([warning]);
    const logged: string[] = [];
    logConfigWarnings((message) => logged.push(message), { ...valid, OWN_KEY_PLAN_VISIBLE: "on" } as NodeJS.ProcessEnv);
    expect(logged).toEqual([warning]);
  });
});
