/**
 * The staging stage (docs/RAILWAY_STAGING.md): a production build that only
 * serves its listed test stores, with the mock provider and no AI key, and
 * never one of the operator's production stores.
 */
import { describe, expect, it } from "vitest";
import { getConfig, isShopAllowed } from "../../app/.server/lib/config";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  NODE_ENV: "production",
  REDIS_URL: "redis://localhost:6379",
};
const staging = { ...base, LINGUVA_STAGE: "staging", TRANSLATION_PROVIDER: "mock", ALLOWED_SHOPS: "linguva-test-lab.myshopify.com" };
const config = (env: Record<string, string>) => getConfig(env as NodeJS.ProcessEnv);

describe("staging configuration", () => {
  it("accepts a production build with the mock provider and a test-store list", () => {
    expect(config(staging)).toMatchObject({ LINGUVA_STAGE: "staging", TRANSLATION_PROVIDER: "mock" });
  });

  it("refuses DeepL (paid) and requires the mock provider", () => {
    expect(() => config({ ...staging, TRANSLATION_PROVIDER: "deepl" })).toThrow(/TRANSLATION_PROVIDER: must be mock in staging/);
    expect(() => config({ ...staging, DEEPL_API_KEY: "secret-value:fx" })).toThrow(/DEEPL_API_KEY: must not be set in staging/);
    expect(() => config({ ...staging, DEEPL_API_KEYS: "secret-value:fx,other:fx" })).toThrow(/DEEPL_API_KEYS: must not be set in staging/);
  });

  it("names the variable but never echoes a key's value", () => {
    let message = "";
    try {
      config({ ...staging, DEEPL_API_KEY: "secret-value:fx" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("secret-value");
  });

  it("requires the list of test stores", () => {
    expect(() => config({ ...staging, ALLOWED_SHOPS: "" })).toThrow(/ALLOWED_SHOPS: is required in staging/);
    expect(() => config({ ...staging, ALLOWED_SHOPS: "linguva-test-lab.com" })).toThrow(/myshopify\.com/);
  });

  it("refuses a production store in the staging list", () => {
    expect(() => config({ ...staging, ALLOWED_SHOPS: "linguva-test-lab.myshopify.com,karinex.myshopify.com" })).toThrow(/production store/);
    expect(() => config({ ...staging, ALLOWED_SHOPS: "softwarefach-de.myshopify.com" })).toThrow(/production store/);
    // KARINEX's real *.myshopify.com domain doesn't contain its name.
    expect(() => config({ ...staging, ALLOWED_SHOPS: "45dv93-bk.myshopify.com" })).toThrow(/production store/);
  });

  it("keeps refusing the mock provider in production", () => {
    expect(() => config({ ...base, TRANSLATION_PROVIDER: "mock" })).toThrow(/TRANSLATION_PROVIDER/);
    expect(() => config({ ...base, LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes", TRANSLATION_PROVIDER: "mock" })).toThrow(/TRANSLATION_PROVIDER/);
  });
});

describe("Railway environments", () => {
  it("runs staging only in the environment named staging", () => {
    expect(config({ ...staging, RAILWAY_ENVIRONMENT_NAME: "staging" }).LINGUVA_STAGE).toBe("staging");
    expect(() => config({ ...staging, RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/LINGUVA_STAGE: must match the Railway environment's name/);
  });

  it("refuses to start on Railway without a stage", () => {
    expect(() => config({ ...base, RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/LINGUVA_STAGE: must be set on Railway/);
  });

  it("starts production only with the owner's approval", () => {
    const production = { ...base, LINGUVA_STAGE: "production", RAILWAY_ENVIRONMENT_NAME: "production" };
    expect(() => config(production)).toThrow(/LINGUVA_PRODUCTION_APPROVED=yes/);
    expect(() => config({ ...production, LINGUVA_PRODUCTION_APPROVED: "true" })).toThrow(/LINGUVA_PRODUCTION_APPROVED/);
    expect(config({ ...production, LINGUVA_PRODUCTION_APPROVED: "yes" }).LINGUVA_STAGE).toBe("production");
  });
});

describe("which shops a deployment serves", () => {
  it("serves only listed shops, case-insensitively", () => {
    const c = config(staging);
    expect(isShopAllowed("linguva-test-lab.myshopify.com", c)).toBe(true);
    expect(isShopAllowed("Linguva-Test-Lab.myshopify.com", c)).toBe(true);
    expect(isShopAllowed("other-dev-store.myshopify.com", c)).toBe(false);
    expect(isShopAllowed("", c)).toBe(false);
    expect(isShopAllowed(null, c)).toBe(false);
  });

  it("never serves a production store from staging, even without a list match check", () => {
    const c = { ...config(staging), ALLOWED_SHOPS: "karinex.myshopify.com" };
    expect(isShopAllowed("karinex.myshopify.com", c)).toBe(false);
    expect(isShopAllowed("45dv93-bk.myshopify.com", { ...c, ALLOWED_SHOPS: "45dv93-bk.myshopify.com" })).toBe(false);
  });

  it("serves every shop when no list is set (development, production before a list)", () => {
    const c = config({ ...base, LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes" });
    expect(isShopAllowed("karinex.myshopify.com", c)).toBe(true);
    expect(isShopAllowed("shop.example.com", c)).toBe(true);
  });

  it("limits production to its listed stores when a list is set", () => {
    const c = config({ ...base, LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes", ALLOWED_SHOPS: "karinex.myshopify.com" });
    expect(isShopAllowed("karinex.myshopify.com", c)).toBe(true);
    expect(isShopAllowed("linguva-test-lab.myshopify.com", c)).toBe(false);
  });
});
