/**
 * The Jobs pages' pure vocabulary (app/lib/job-view.ts): which failed items
 * a new try can fix (driven by classifyError itself, so the permanent codes
 * can't drift from app/.server/jobs/errors.ts), the stop causes' groups and
 * looks for every job error code, and where each cause is fixed, with the
 * way back to the stopped job.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GraphqlQueryError, HttpInternalError, HttpRequestError } from "@shopify/shopify-api";
import { describe, expect, it } from "vitest";
import { classifyError } from "../../app/.server/jobs/errors";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { QUOTA_CODES, QuotaExceededError } from "../../app/.server/usage/usage-ledger";
import { MESSAGES } from "../../app/i18n/messages";
import { ENGINE_IDS } from "../../app/lib/engines";
import {
  isItemPermanentCode,
  ITEM_PERMANENT_CODES,
  retryHelps,
  STOP_FIX_HREF,
  STOP_GROUPS,
  stopFixHref,
  stopGroup,
  stopLook,
  type StopGroup,
  type StopLook,
} from "../../app/lib/job-view";
import { ownKeyStopCode } from "../../app/lib/own-keys";

const ROOT = join(__dirname, "..", "..");
const http = { message: "x", code: 500, statusText: "x", body: {}, headers: {} };

/** Every error classifyError classes as item-permanent (an ItemPermanentError carries the code it is given). */
const PERMANENT_ERRORS: Error[] = [
  new TranslationProviderError("deepl", "invalid", "x"),
  new TranslationProviderError("azure", "unsupported" as never, "x"),
  new GraphqlQueryError({ message: "Access denied", response: {} as never, body: { errors: [{ message: "ACCESS_DENIED" }] } }),
  new GraphqlQueryError({ message: "Invalid id", response: {} as never, body: { errors: [{ message: "invalid id" }] } }),
  new QuotaExceededError(0, 25_000, 20_000, "daily"),
  new QuotaExceededError(0, 2_000_000, 1_200_000, "monthly"),
];
/** Errors a later try may get through: classifyError retries them (DEAD when the tries run out). */
const RETRYABLE_ERRORS: Error[] = [new TranslationProviderError("deepl", "retryable", "x"), new HttpInternalError(http), new HttpRequestError("socket hang up"), new Error("boom")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("retryHelps", () => {
  it("says no for exactly the codes classifyError gives item-permanent failures", () => {
    const codes = PERMANENT_ERRORS.map((error) => {
      const decision = classifyError(error);
      expect(decision.kind, String(error)).toBe("item-permanent");
      return decision.kind === "item-permanent" ? decision.code : "";
    });
    // Both ways: every permanent code is listed, and nothing else is.
    expect([...new Set(codes)].sort()).toEqual([...ITEM_PERMANENT_CODES].sort());
    for (const code of codes) {
      expect(retryHelps("FAILED", code), code).toBe(false);
      expect(isItemPermanentCode(code), code).toBe(true);
    }
  });

  it("can't drift: the app throws ItemPermanentError only with a listed code (none today)", () => {
    const thrown = sources(join(ROOT, "app")).flatMap((path) => [...readFileSync(path, "utf8").matchAll(/new ItemPermanentError\(\s*([^)]*)\)/g)].map((m) => `${path}: ${m[1]}`));
    for (const call of thrown) expect(ITEM_PERMANENT_CODES.some((code) => call.endsWith(`"${code}"`)), call).toBe(true);
  });

  it("says yes for DEAD items, failed items with a retryable code and failed items without a code", () => {
    for (const error of RETRYABLE_ERRORS) {
      const decision = classifyError(error);
      expect(decision.kind, String(error)).toBe("retryable");
      if (decision.kind === "retryable") expect(retryHelps("FAILED", decision.code), decision.code).toBe(true);
    }
    for (const code of ["PROVIDER_UNAVAILABLE", "SHOPIFY_UNAVAILABLE", "UNEXPECTED_ERROR", null, undefined, ""]) expect(retryHelps("FAILED", code), String(code)).toBe(true);
    // A retryable error that ran out of tries, whatever its code (a permanent code included).
    for (const code of ["PROVIDER_UNAVAILABLE", "SHOPIFY_UNAVAILABLE", "UNEXPECTED_ERROR", "PROVIDER_REJECTED", null]) expect(retryHelps("DEAD", code), String(code)).toBe(true);
  });

  it("says no for items that didn't fail: there is nothing to try again", () => {
    for (const status of ["PENDING", "RUNNING", "SUCCEEDED", "SKIPPED", "CANCELLED"]) {
      expect(retryHelps(status, null), status).toBe(false);
      expect(retryHelps(status, "UNEXPECTED_ERROR"), status).toBe(false);
    }
  });
});

/** The group and look of every common.jobError code; a new code must be added here (its texts, look and fix). */
const EXPECTED: Record<string, [StopGroup, StopLook | null]> = {
  QUOTA_EXCEEDED: ["QUOTA_EXCEEDED", "waits"],
  PLAN_REQUIRED: ["PLAN_REQUIRED", "needsYou"],
  DAILY_LIMIT: ["DAILY_LIMIT", "waits"],
  PLATFORM_LIMIT: ["PLATFORM_LIMIT", "waits"],
  CONSENT_REQUIRED: ["CONSENT_REQUIRED", "needsYou"],
  ENGINE_CONSENT: ["ENGINE_CONSENT", "needsYou"],
  AI_NOT_CONFIGURED: ["PROVIDER", "waits"],
  PROVIDER_QUOTA: ["PROVIDER", "waits"],
  PROVIDER_AUTH: ["PROVIDER", "waits"],
  SHOP_AUTH: ["SHOP_AUTH", "needsYou"],
  SHOP_INACTIVE: ["SHOP_INACTIVE", null],
  DISCOVERY_FAILED: ["DISCOVERY_FAILED", "waits"],
  PLAN_SMART: ["PLAN_SMART", "needsYou"],
  SMART_BUDGET_DAILY: ["SMART_BUDGET_DAILY", "waits"],
  SMART_BUDGET_MONTHLY: ["SMART_BUDGET_MONTHLY", "waits"],
  PRIMARY_LANGUAGE: ["PRIMARY_LANGUAGE", "needsYou"],
  OWN_KEY_MISSING: ["OWN_KEY_MISSING", "needsYou"],
  OWN_KEY_QUOTA: ["OWN_KEY_QUOTA", "needsYou"],
  OWN_KEY_AUTH: ["OWN_KEY_AUTH", "needsYou"],
  OWN_KEY_AUTH_DEEPL: ["OWN_KEY_AUTH", "needsYou"],
  OWN_KEY_AUTH_AZURE: ["OWN_KEY_AUTH", "needsYou"],
  OWN_KEY_AUTH_GOOGLE: ["OWN_KEY_AUTH", "needsYou"],
  // Reasons a job was cancelled by the system, never a stop: no stop group of their own.
  SHOP_UNINSTALLED: ["UNKNOWN", "waits"],
  AUTO_OFF: ["UNKNOWN", "waits"],
  SMART_OFF: ["UNKNOWN", "waits"],
};

describe("stopGroup and stopLook", () => {
  it("place every job error code of the catalogues, with its look", () => {
    const codes = Object.keys(MESSAGES.en).filter((key) => key.startsWith("common.jobError.")).map((key) => key.slice("common.jobError.".length));
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      expect(EXPECTED[code], `${code} needs its group in this test`).toBeDefined();
      const [group, look] = EXPECTED[code]!;
      expect(stopGroup(code), code).toBe(group);
      expect(stopLook(stopGroup(code)), code).toBe(look);
    }
  });

  it("group every engine's own-key codes, and nothing else by its prefix", () => {
    for (const engine of ENGINE_IDS) {
      expect(stopGroup(ownKeyStopCode("quota", engine))).toBe("OWN_KEY_QUOTA");
      expect(stopGroup(ownKeyStopCode("auth", engine))).toBe("OWN_KEY_AUTH");
    }
    for (const code of ["OWN_KEY_QUOTA_ACME", "OWN_KEY_AUTH_", "OWN_KEY_UNAVAILABLE", "own_key_missing"]) expect(stopGroup(code), code).toBe("UNKNOWN");
  });

  it("call no code or an unknown one UNKNOWN, which waits", () => {
    for (const code of [null, undefined, "", "SOMETHING_NEW", "JOB_CANCELLED"]) expect(stopGroup(code), String(code)).toBe("UNKNOWN");
    expect(stopLook("UNKNOWN")).toBe("waits");
  });

  it("know every code a stop can carry: the limits and every job stop classifyError reports", () => {
    for (const code of Object.values(QUOTA_CODES)) expect(stopGroup(code), code).not.toBe("UNKNOWN");
    for (const error of [new TranslationProviderError("deepl", "quota", "x"), new TranslationProviderError("deepl", "auth", "x"), new QuotaExceededError(1, 2, 2, "smartDaily")]) {
      const decision = classifyError(error);
      expect(decision.kind).toBe("job-stop");
      if (decision.kind === "job-stop") expect(stopGroup(decision.code), decision.code).not.toBe("UNKNOWN");
    }
  });

  it("reach every group from some code", () => {
    const reached = new Set([...Object.keys(EXPECTED), null].map((code) => stopGroup(code)));
    expect([...reached].sort()).toEqual([...STOP_GROUPS].sort());
  });
});

describe("where a stop is fixed", () => {
  it("names the Settings section, the smart page's card or the Plan page", () => {
    expect(STOP_FIX_HREF).toEqual({
      QUOTA_EXCEEDED: "/app/plan",
      CONSENT_REQUIRED: "/app/settings?section=ai",
      ENGINE_CONSENT: "/app/settings?section=ai",
      PLAN_REQUIRED: "/app/plan",
      PLAN_SMART: "/app/plan",
      SMART_BUDGET_DAILY: "/app/settings/automatic#smart-budgets",
      SMART_BUDGET_MONTHLY: "/app/settings/automatic#smart-budgets",
      PRIMARY_LANGUAGE: "/app/settings/automatic#smart-scope",
      OWN_KEY_MISSING: "/app/settings?section=keys",
      OWN_KEY_QUOTA: "/app/settings?section=keys",
      OWN_KEY_AUTH: "/app/settings?section=keys",
    });
    // Nothing to fix in the app: a reset to wait for, the operator's engines, reopening the app.
    for (const group of ["DAILY_LIMIT", "PLATFORM_LIMIT", "SHOP_AUTH", "DISCOVERY_FAILED", "PROVIDER", "SHOP_INACTIVE", "UNKNOWN"] as const) {
      expect(STOP_FIX_HREF[group], group).toBeUndefined();
      expect(stopFixHref(group, "7f3a2c10-0000-4000-8000-000000000010"), group).toBeNull();
    }
    // Every cause that needs the merchant has a place to go, except reopening the app.
    for (const group of STOP_GROUPS) if (stopLook(group) === "needsYou" && group !== "SHOP_AUTH") expect(STOP_FIX_HREF[group], group).toBeDefined();
  });

  it("never links an old #settings-* hash", () => {
    for (const href of Object.values(STOP_FIX_HREF)) expect(href).not.toContain("#settings-");
    const files = [join(ROOT, "app", "lib", "job-view.ts"), ...(existsSync(join(ROOT, "app", "components", "jobs")) ? sources(join(ROOT, "app", "components", "jobs")) : [])];
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toContain("#settings-");
  });

  it("carries the stopped job to the target, the query before the hash", () => {
    const id = "7f3a2c10-0000-4000-8000-000000000010";
    expect(stopFixHref("ENGINE_CONSENT", id)).toBe(`/app/settings?section=ai&job=${id}`);
    expect(stopFixHref("CONSENT_REQUIRED", id)).toBe(`/app/settings?section=ai&job=${id}`);
    expect(stopFixHref("OWN_KEY_AUTH", id)).toBe(`/app/settings?section=keys&job=${id}`);
    expect(stopFixHref("SMART_BUDGET_DAILY", id)).toBe(`/app/settings/automatic?job=${id}#smart-budgets`);
    expect(stopFixHref("PRIMARY_LANGUAGE", id)).toBe(`/app/settings/automatic?job=${id}#smart-scope`);
    expect(stopFixHref("PLAN_REQUIRED", id)).toBe(`/app/plan?job=${id}`);
    expect(stopFixHref("QUOTA_EXCEEDED", id)).toBe(`/app/plan?job=${id}`);
    // Whatever it is given stays one query value.
    expect(stopFixHref("PLAN_SMART", "a&b=c#d")).toBe("/app/plan?job=a%26b%3Dc%23d");
  });
});
