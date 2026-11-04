/**
 * The Jobs pages' pure vocabulary (app/lib/job-view.ts): which failed items
 * a new try can fix (driven by classifyError itself, so the permanent codes
 * can't drift from app/.server/jobs/errors.ts), the stop causes' groups and
 * looks for every job error code, and where each cause is fixed, with the
 * way back to the stopped job. Then the rest of the pages' logic, with the
 * jobs of the UI fixture `jobs` (7f3a2c01 …): states, outcome groups, the
 * one figure, row results and metas, days and clusters, the attention card,
 * the hero by state, the stats, the list's address, and the plural texts,
 * rendered in English and German through translator().
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GraphqlQueryError, HttpInternalError, HttpRequestError } from "@shopify/shopify-api";
import { describe, expect, it } from "vitest";
import { AUTO_REQUESTED_BY, isJobResourceType, JOB_LIST_STATUSES, JOB_ORIGINS, JOB_SINCE, SUPPORTED_BULK_RESOURCE_TYPES } from "../../app/.server/jobs/bulk-jobs";
import { classifyError } from "../../app/.server/jobs/errors";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { QUOTA_CODES, QuotaExceededError } from "../../app/.server/usage/usage-ledger";
import { durationText } from "../../app/components/Coverage";
import { ringFigureSize as coverageRingFigureSize } from "../../app/components/CoverageRing";
import { translator, type AppLocale, type MessageVars } from "../../app/i18n/i18n";
import { itemOutcome } from "../../app/i18n/labels";
import { MESSAGES, type MessageKey } from "../../app/i18n/messages";
import { ENGINE_IDS } from "../../app/lib/engines";
import {
  attentionVerdict,
  AUTO_STARTER,
  cancelBody,
  clearedHref,
  clusters,
  dayGroups,
  DISPLAY_ORDER,
  displayParts,
  ENDED_WELL,
  filterCount,
  filterHref,
  finishTarget,
  FIX_GROUPS,
  heroModel,
  isItemPermanentCode,
  ITEM_PERMANENT_CODES,
  itemName,
  JOB_BY,
  JOB_FILTERS,
  JOB_PERIODS,
  JOB_TABS,
  JOB_TYPES,
  jobItems,
  jobKindLabel,
  jobName,
  jobOrigin,
  jobsFilter,
  jobsHref,
  jobState,
  jobText,
  jobValue,
  legend,
  NEEDS_YOU_CODES,
  outcomeGroups,
  parseJobsQuery,
  problemsHeading,
  RESUME_CHECK,
  resumeCheckDelay,
  retryHelps,
  ringFigure,
  ringFigureSize,
  rowCounts,
  rowMeta,
  rowResult,
  startedText,
  STATE_WORD,
  STOP_FIX_HREF,
  STOP_GROUPS,
  stopFixHref,
  stopGroup,
  stopLook,
  visibleStats,
  type AttentionInput,
  type AttentionStop,
  type HeroModel,
  type ItemOutcomes,
  type JobFields,
  type JobGroups,
  type JobState,
  type JobText,
  type JobTextI18n,
  type RowOutcomeCounts,
  type StopGroup,
  type StopLook,
  type TextValue,
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

  it("list every code whose stop needs the merchant, an own key's with each engine, for the server's count", () => {
    for (const code of NEEDS_YOU_CODES) expect(stopLook(stopGroup(code)), code).toBe("needsYou");
    for (const [code, [, look]] of Object.entries(EXPECTED)) expect(NEEDS_YOU_CODES.includes(code), code).toBe(look === "needsYou");
    for (const engine of ENGINE_IDS) {
      expect(NEEDS_YOU_CODES).toContain(ownKeyStopCode("quota", engine));
      expect(NEEDS_YOU_CODES).toContain(ownKeyStopCode("auth", engine));
    }
    expect(new Set(NEEDS_YOU_CODES).size).toBe(NEEDS_YOU_CODES.length);
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

// ─── The rest of the pages' logic, with the `jobs` UI fixture's jobs ─────────

const ZONE = "Europe/Berlin";
/** Monday, November 2, 2026, 14:09 in Berlin (UTC+1 since October 25). */
const NOW = "2026-11-02T13:09:00.000Z";
const ACTOR = "42";
const SMART = "system:smart";
/** The fixture's job ids (stable references 7f3a2c01 …). */
const id = (n: number) => `7f3a2c${String(n).padStart(2, "0")}-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
/** A Berlin wall-clock time on a day after the change to winter time (UTC+1). */
const berlin = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+01:00`).toISOString();
const today = (hhmm: string) => berlin("2026-11-02", hhmm);
const yesterday = (hhmm: string) => berlin("2026-11-01", hhmm);

function job(fields: Partial<JobFields> = {}): JobFields {
  return {
    id: id(1),
    resourceType: "PRODUCT",
    targetLocale: "fr",
    status: "COMPLETED",
    requestedBy: ACTOR,
    smartRunId: null,
    idempotencyKey: "form-key-1",
    discoveryDone: true,
    totalItems: 0,
    succeededItems: 0,
    skippedItems: 0,
    failedItems: 0,
    charsBilled: 0,
    charsSaved: 0,
    publishMode: "DRAFT",
    fieldScope: "ALL",
    errorCode: null,
    createdAt: today("14:02"),
    startedAt: today("14:02"),
    finishedAt: null,
    updatedAt: today("14:09"),
    ...fields,
  };
}
const outcomesOf = (o: Partial<RowOutcomeCounts> = {}): RowOutcomeCounts => ({ waiting: 0, partial: 0, rejected: 0, sourceChanged: 0, cancelled: 0, retryable: 0, ...o });

// 7f3a2c01: French · Products, running: 176 waiting (452 drafts), 30 kept, 2 partly, 4 failed (3 permanent, 1 DEAD), 128 open.
const J01 = job({ id: id(1), status: "RUNNING", totalItems: 340, succeededItems: 178, skippedItems: 30, failedItems: 4, charsBilled: 96_540, charsSaved: 18_200 });
const O01: ItemOutcomes[] = [
  { status: "SUCCEEDED", code: "DRAFTED", count: 176 },
  { status: "SUCCEEDED", code: "PARTIAL", count: 2 },
  { status: "SKIPPED", code: "UP_TO_DATE", count: 26 },
  { status: "SKIPPED", code: "PROTECTED", count: 4 },
  { status: "FAILED", code: "PROVIDER_REJECTED", count: 1 },
  { status: "FAILED", code: "TOO_LARGE_FOR_LIMIT", count: 1 },
  { status: "FAILED", code: "SHOPIFY_QUERY_ERROR", count: 1 },
  { status: "DEAD", code: "PROVIDER_UNAVAILABLE", count: 1 },
  { status: "PENDING", code: null, count: 125 },
  { status: "PENDING", code: "PROVIDER_UNAVAILABLE", count: 3 },
];
const P01 = { translations: 452, items: 176 };
const R01 = outcomesOf({ waiting: 176, partial: 2, retryable: 1 });
// 7f3a2c02: German · Image descriptions (products), a schedule check still finding (18 so far).
const J02 = job({ id: id(2), resourceType: "MEDIA_IMAGE", targetLocale: "de", status: "RUNNING", discoveryDone: false, requestedBy: SMART, smartRunId: "run-1", totalItems: 18, createdAt: today("14:00"), startedAt: today("14:00") });
// 7f3a2c03: German · Menu links, queued.
const J03 = job({ id: id(3), resourceType: "LINK", targetLocale: "de", status: "PENDING", discoveryDone: false, createdAt: today("14:08"), startedAt: null });
// 7f3a2c04: French · Collections, done, 14 waiting.
const J04 = job({ id: id(4), resourceType: "COLLECTION", totalItems: 14, succeededItems: 14, charsBilled: 8_200, createdAt: today("11:20"), finishedAt: today("11:31") });
const R04 = outcomesOf({ waiting: 14 });
// 7f3a2c05: Spanish · Products, cancelled by the merchant at 120 of 410.
const J05 = job({ id: id(5), targetLocale: "es", status: "CANCELLED", totalItems: 410, succeededItems: 120, skippedItems: 290, createdAt: today("08:40"), finishedAt: today("08:55") });
const R05 = outcomesOf({ cancelled: 290 });
// 7f3a2c06: German · Products, automatic: the day's changes from 06:10 to 13:45; 12 waiting, 34 kept.
const J06 = job({ id: id(6), targetLocale: "de", requestedBy: AUTO_STARTER, idempotencyKey: "auto-6", totalItems: 46, succeededItems: 12, skippedItems: 34, createdAt: today("06:10"), updatedAt: today("13:45") });
const R06 = outcomesOf({ waiting: 12 });
// 7f3a2c07: Italian · Products from the schedule's 03:00 check, done with errors: 89 = 52 waiting + 31 kept + 2 partly + 3 failed + 1 changed original.
const J07 = job({
  id: id(7),
  targetLocale: "it",
  requestedBy: SMART,
  smartRunId: "run-2",
  idempotencyKey: "smart:run-2:PRODUCT:it",
  totalItems: 89,
  succeededItems: 54,
  skippedItems: 32,
  failedItems: 3,
  charsBilled: 61_480,
  charsSaved: 9_870,
  createdAt: today("03:00"),
  startedAt: today("03:00"),
  finishedAt: today("03:09"),
  updatedAt: today("03:09"),
});
const O07: ItemOutcomes[] = [
  { status: "SUCCEEDED", code: "DRAFTED", count: 52 },
  { status: "SUCCEEDED", code: "PARTIAL", count: 2 },
  { status: "SKIPPED", code: "UP_TO_DATE", count: 27 },
  { status: "SKIPPED", code: "PROTECTED", count: 4 },
  { status: "SKIPPED", code: "SOURCE_CHANGED", count: 1 },
  { status: "FAILED", code: "PROVIDER_REJECTED", count: 1 },
  { status: "DEAD", code: "PROVIDER_UNAVAILABLE", count: 1 },
  { status: "FAILED", code: "SHOPIFY_QUERY_ERROR", count: 1 },
];
const P07 = { translations: 140, items: 52 };
const R07 = outcomesOf({ waiting: 52, partial: 2, sourceChanged: 1, retryable: 1 });
// 7f3a2c09: German · Blog posts from the same check, 4 published.
const J09 = job({ id: id(9), resourceType: "ARTICLE", targetLocale: "de", requestedBy: SMART, smartRunId: "run-2", idempotencyKey: "smart:run-2:ARTICLE:de", publishMode: "AUTO_PUBLISH", totalItems: 4, succeededItems: 4, createdAt: today("03:01") });
// 7f3a2c10: Italian · Collections, stopped yesterday at 22:14 (ENGINE_CONSENT): 9 waiting (27 drafts), 15 not reached.
const J10 = job({
  id: id(10),
  resourceType: "COLLECTION",
  targetLocale: "it",
  status: "FAILED",
  errorCode: "ENGINE_CONSENT",
  totalItems: 24,
  succeededItems: 9,
  skippedItems: 15,
  charsBilled: 8_940,
  charsSaved: 1_210,
  createdAt: yesterday("22:01"),
  startedAt: yesterday("22:01"),
  finishedAt: yesterday("22:14"),
  updatedAt: yesterday("22:14"),
});
const O10: ItemOutcomes[] = [
  { status: "SUCCEEDED", code: "DRAFTED", count: 9 },
  { status: "CANCELLED", code: "ENGINE_CONSENT", count: 15 },
];
const P10 = { translations: 27, items: 9 };
const R10 = outcomesOf({ waiting: 9, cancelled: 15 });
// 7f3a2c11: German · Pages, search listings only, 6 published.
const J11 = job({ id: id(11), resourceType: "PAGE", targetLocale: "de", fieldScope: "SEO", publishMode: "AUTO_PUBLISH", totalItems: 6, succeededItems: 6, createdAt: yesterday("16:30") });
// 7f3a2c12: German · Collections, automatic, cancelled because automatic translation was turned off (2 of 5).
const J12 = job({ id: id(12), resourceType: "COLLECTION", targetLocale: "de", status: "CANCELLED", errorCode: "AUTO_OFF", requestedBy: AUTO_STARTER, publishMode: "AUTO_PUBLISH", totalItems: 5, succeededItems: 2, skippedItems: 3, charsBilled: 1_860, createdAt: yesterday("09:12"), finishedAt: yesterday("09:21"), updatedAt: yesterday("09:21") });
const R12 = outcomesOf({ cancelled: 3 });
// 7f3a2c13: French · Products, automatic, all 23 already up to date.
const J13 = job({ id: id(13), requestedBy: AUTO_STARTER, totalItems: 23, skippedItems: 23, createdAt: yesterday("07:02"), updatedAt: yesterday("21:40") });
// 7f3a2c14: Italian · Shipping methods, 4 translated (drafts decided).
const J14 = job({ id: id(14), resourceType: "DELIVERY_METHOD_DEFINITION", targetLocale: "it", totalItems: 4, succeededItems: 4 });
// 7f3a2c15: French · Extra details (products) from a schedule check, 24 translated.
const J15 = job({ id: id(15), resourceType: "PRODUCT_METAFIELD", requestedBy: SMART, smartRunId: "run-3", totalItems: 24, succeededItems: 24 });
// 7f3a2c16: Spanish · Pages, done with gaps: 10 waiting + 2 partly translated, nothing failed.
const J16 = job({ id: id(16), resourceType: "PAGE", targetLocale: "es", totalItems: 12, succeededItems: 12, createdAt: yesterday("12:30") });
const R16 = outcomesOf({ waiting: 10, partial: 2 });

/** The page's I18n in the store's zone (the app route's loader names it): its own time, timeRef, at and dayMonth write every instant. */
const writer = (locale: AppLocale): JobTextI18n => translator(locale, { timeZone: ZONE });
const contextFor = (locale: AppLocale) => ({ now: NOW, duration: (ms: number) => durationText(translator(locale), ms) });
const say = (locale: AppLocale, text: JobText) => jobText(writer(locale), text, contextFor(locale));
const sayAll = (locale: AppLocale, texts: readonly JobText[]) => texts.map((text) => say(locale, text)).join(" ");
const valueText = (locale: AppLocale, value: TextValue) => jobValue(writer(locale), value, contextFor(locale));
const clock = (locale: AppLocale, iso: string) => writer(locale).time(iso);

function rowOf(j: JobFields, outcomes?: Partial<RowOutcomeCounts>, fixed: boolean | null = null) {
  const groups = rowCounts(j, outcomesOf(outcomes));
  return { job: j, groups, state: jobState(j, groups.counts.look, fixed) };
}

/** The same code for each stop group (the own keys' with an engine). */
const CODE_OF: Record<StopGroup, string | null> = {
  ...(Object.fromEntries(STOP_GROUPS.map((group) => [group, group])) as Record<StopGroup, string>),
  OWN_KEY_QUOTA: "OWN_KEY_QUOTA_DEEPL",
  OWN_KEY_AUTH: "OWN_KEY_AUTH_DEEPL",
  PROVIDER: "PROVIDER_QUOTA",
  UNKNOWN: null,
};

describe("instants inside the texts: the page's time helpers", () => {
  const cancelled: JobText = { key: "jobs.meta.cancelledAt", vars: { time: { timeRef: today("08:55") } } };
  // Stopped at 00:30 on Monday in Berlin: still Sunday, 23:30, in UTC.
  const stopped: JobText = { key: "jobs.attention.stopText", vars: { when: { at: "2026-11-01T23:30:00Z" }, done: 1, total: 10, count: 1 } };
  /** A store without a zone, or in UTC: the same texts, in UTC and saying so. */
  const inUtc = (locale: AppLocale, text: JobText) => jobText(translator(locale), text, contextFor(locale));

  it("writes times in the store's zone, the clock of the interface language, Spanish with its article", () => {
    expect(say("de", cancelled)).toBe("Abgebrochen um 08:55");
    expect(say("en", cancelled)).toBe("Cancelled at 8:55 AM");
    expect(say("es", cancelled)).toBe("Cancelada a las 8:55");
    expect(say("es", { key: "jobs.meta.cancelledAt", vars: { time: { timeRef: today("01:30") } } })).toBe("Cancelada a la 1:30");
    expect(valueText("de", { join: [{ time: today("06:10") }, { time: today("13:45") }], separator: "–" })).toBe("06:10–13:45");
  });

  it("names the day by the store's calendar day, as the day headings do", () => {
    expect(say("de", stopped)).toBe("Angehalten heute um 00:30, 1 von 10 ist fertig.");
    expect(say("en", stopped)).toBe("Stopped today at 12:30 AM; 1 of 10 is done.");
    expect(inUtc("de", stopped)).toBe("Angehalten gestern um 23:30 UTC, 1 von 10 ist fertig.");
    expect(writer("de").dayHeading("2026-11-01T23:30:00Z", NOW).title).toBe("Heute");
    expect(translator("de").dayHeading("2026-11-01T23:30:00Z", NOW).title).toBe("Gestern");
  });

  it("says UTC after every time when the store has no zone, or UTC", () => {
    expect(inUtc("en", cancelled)).toBe("Cancelled at 7:55 AM UTC");
    expect(inUtc("es", cancelled)).toBe("Cancelada a las 7:55 UTC");
    expect(jobText(translator("de", { timeZone: "Etc/UTC" }), cancelled, contextFor("de"))).toBe("Abgebrochen um 07:55 UTC");
  });
});

describe("names, kinds and counts", () => {
  it("name a job by its language and kind, the same everywhere", () => {
    expect(jobName(translator("de"), J01)).toBe("Französisch · Produkte");
    expect(jobName(translator("en"), J01)).toBe("French · Products");
    // French and Spanish write language names in lower case: a name starts with a capital.
    expect(jobName(translator("fr"), { targetLocale: "de", resourceType: "PRODUCT" })).toBe("Allemand · Produits");
    expect(jobName(translator("es"), { targetLocale: "it", resourceType: "COLLECTION" })).toBe("Italiano · Colecciones");
    expect(jobName(translator("de"), J02)).toBe("Deutsch · Bildbeschreibungen (Produkte)");
    expect(jobName(translator("de"), J03)).toBe("Deutsch · Menülinks");
    // English keeps Shopify's name of a language.
    expect(jobName(translator("en"), { targetLocale: "pt-BR", resourceType: "PAGE" }, { "pt-BR": "Portuguese (Brazil)" })).toBe("Portuguese (Brazil) · Pages");
  });

  it("give images and custom fields the language page's words, every other kind its label", () => {
    const de = translator("de");
    expect(jobKindLabel(de, "MEDIA_IMAGE")).toBe("Bildbeschreibungen (Produkte)");
    expect(jobKindLabel(de, "COLLECTION_IMAGE")).toBe("Bildbeschreibungen (Kollektionen)");
    expect(jobKindLabel(de, "ARTICLE_METAFIELD")).toBe("Zusatzinfos (Blogbeiträge)");
    expect(jobKindLabel(translator("en"), "PRODUCT_METAFIELD")).toBe("Extra details (products)");
    expect(jobKindLabel(de, "DELIVERY_METHOD_DEFINITION")).toBe("Versandarten");
    expect(jobKindLabel(de, "SOMETHING_NEW")).toBe("SOMETHING_NEW");
    for (const locale of ["en", "de", "fr", "es"] as const) for (const type of JOB_TYPES) expect(jobKindLabel(translator(locale), type), `${locale} ${type}`).not.toBe(type);
  });

  it("count items with the kind's noun, by the language's plural rule", () => {
    const de = translator("de");
    expect(jobItems(de, "PRODUCT", 1)).toBe("1 Produkt");
    expect(jobItems(de, "COLLECTION", 14)).toBe("14 Kollektionen");
    expect(jobItems(de, "COLLECTION", 1200)).toBe("1.200 Kollektionen");
    expect(jobItems(de, "MEDIA_IMAGE", 46)).toBe("46 Bildbeschreibungen");
    expect(jobItems(de, "ARTICLE_IMAGE", 1)).toBe("1 Bildbeschreibung");
    expect(jobItems(de, "PRODUCT_METAFIELD", 24)).toBe("24 Zusatzinfos");
    expect(jobItems(de, "SOMETHING_NEW", 3)).toBe("3 Einträge");
    expect(jobItems(de, "SOMETHING_NEW", 1)).toBe("1 Eintrag");
    expect(jobItems(translator("en"), "COLLECTION", 1200)).toBe("1,200 collections");
    expect(jobItems(translator("en"), "PRODUCT", 1)).toBe("1 product");
    expect(jobItems(translator("fr"), "PRODUCT", 2)).toBe("2 produits");
    // French counts 0 as one.
    expect(jobItems(translator("fr"), "PRODUCT", 0)).toBe("0 produit");
    expect(jobItems(translator("es"), "PAGE", 6)).toBe("6 páginas");
  });

  it("tell who started a job", () => {
    expect(jobOrigin({ requestedBy: ACTOR }, ACTOR)).toBe("you");
    expect(jobOrigin({ requestedBy: "77" }, ACTOR)).toBe("team");
    expect(jobOrigin({ requestedBy: null }, ACTOR)).toBe("hand");
    expect(jobOrigin({ requestedBy: AUTO_STARTER }, ACTOR)).toBe("auto");
    expect(jobOrigin({ requestedBy: SMART }, ACTOR)).toBe("smart");
    expect(AUTO_STARTER).toBe(AUTO_REQUESTED_BY);
  });
});

describe("jobState", () => {
  const state = (fields: Partial<JobFields>, look = 0, fixed: boolean | null = null) => jobState(job(fields), look, fixed);

  it("gives every state from the status, discovery, failures, incomplete items and the stop's look", () => {
    expect(state({ status: "PENDING" })).toBe("queued");
    expect(state({ status: "DISCOVERING" })).toBe("finding");
    expect(state({ status: "RUNNING", discoveryDone: false })).toBe("finding");
    expect(state({ status: "RUNNING", discoveryDone: true })).toBe("running");
    expect(state({ status: "COMPLETED" })).toBe("done");
    expect(state({ status: "COMPLETED" }, 2)).toBe("doneLook");
    expect(state({ status: "COMPLETED", failedItems: 3 }, 2)).toBe("doneErrors");
    expect(state({ status: "FAILED", errorCode: "ENGINE_CONSENT" })).toBe("stopped");
    expect(state({ status: "FAILED", errorCode: "DAILY_LIMIT" })).toBe("stoppedWait");
    expect(state({ status: "CANCELLED" })).toBe("cancelled");
    expect(rowOf(J16, R16).state).toBe("doneLook");
    expect(rowOf(J07, R07).state).toBe("doneErrors");
  });

  it("keeps a smart job done whose only problem is a changed original: the schedule translates it again", () => {
    const outcomes: ItemOutcomes[] = [
      { status: "SKIPPED", code: "UP_TO_DATE", count: 30 },
      { status: "SKIPPED", code: "SOURCE_CHANGED", count: 1 },
    ];
    const smart = job({ requestedBy: SMART, smartRunId: "run-4", totalItems: 31, skippedItems: 31 });
    const groups = outcomeGroups(outcomes, 0, smart);
    expect(groups.counts).toMatchObject({ kept: 30, notYet: 1, look: 0 });
    expect(jobState(smart, groups.counts.look)).toBe("done");
    // In a merchant's job the same change is left for the merchant.
    const own = job({ totalItems: 31, skippedItems: 31 });
    expect(jobState(own, outcomeGroups(outcomes, 0, own).counts.look)).toBe("doneLook");
  });

  it("calls a stop whose cause is fixed stoppedWait, whatever its group", () => {
    for (const group of STOP_GROUPS) {
      const stopped = job({ status: "FAILED", errorCode: CODE_OF[group] });
      expect(jobState(stopped, 0, true), group).toBe("stoppedWait");
      expect(jobState(stopped, 0, false), group).toBe(stopLook(group) === "needsYou" ? "stopped" : "stoppedWait");
      expect(jobState(stopped, 0, null), group).toBe(stopLook(group) === "needsYou" ? "stopped" : "stoppedWait");
    }
  });

  it("names each state with one word", () => {
    const de = translator("de");
    const words = (["queued", "finding", "running", "done", "doneLook", "doneErrors", "stopped", "stoppedWait", "cancelled"] as JobState[]).map((s) => de.t(STATE_WORD[s]));
    expect(words).toEqual(["In der Warteschlange", "Inhalte werden gesucht", "Wird übersetzt", "Abgeschlossen", "Abgeschlossen, teils unvollständig", "Abgeschlossen mit Fehlern", "Angehalten", "Angehalten", "Abgebrochen"]);
  });
});

describe("outcome groups", () => {
  it("put every item in exactly one group, adding up to the total", () => {
    const groups = outcomeGroups(O01, P01.items, J01);
    expect(groups.counts).toEqual({ translated: 0, waiting: 176, kept: 30, look: 2, failed: 4, notYet: 0, skipped: 0, open: 128 });
    expect(groups.total).toBe(340);
    expect(DISPLAY_ORDER.reduce((sum, group) => sum + groups.counts[group], 0)).toBe(groups.total);
    // Only the DEAD item can be tried again.
    expect(groups.retryable).toBe(1);
  });

  it("count a partly translated item as incomplete, never as waiting", () => {
    const groups = outcomeGroups(
      [
        { status: "SUCCEEDED", code: "PARTIAL", count: 2 },
        { status: "SUCCEEDED", code: "DRAFTED", count: 3 },
      ],
      5,
      job(),
    );
    expect(groups.counts).toMatchObject({ look: 2, waiting: 3, translated: 0 });
  });

  it("count a changed original as incomplete, and as not translated yet in a smart job", () => {
    const changed: ItemOutcomes[] = [{ status: "SKIPPED", code: "SOURCE_CHANGED", count: 1 }];
    expect(outcomeGroups(changed, 0, job()).counts).toMatchObject({ look: 1, notYet: 0 });
    const smart = outcomeGroups(changed, 0, job({ requestedBy: SMART, smartRunId: "run-2" }));
    expect(smart.counts).toMatchObject({ look: 0, notYet: 1 });
    expect(smart.selfResolving).toBe(1);
    // The schedule's real-time job translates a change again too.
    expect(outcomeGroups(changed, 0, job({ requestedBy: SMART })).counts.notYet).toBe(1);
    expect(outcomeGroups([{ status: "SKIPPED", code: "ALL_FIELDS_REJECTED", count: 2 }], 0, job({ requestedBy: SMART })).counts.look).toBe(2);
  });

  it("count cancelled items as not translated yet in a stopped job (resuming sends them), else as not translated", () => {
    const cancelled: ItemOutcomes[] = [{ status: "CANCELLED", code: "ENGINE_CONSENT", count: 15 }];
    expect(outcomeGroups(cancelled, 0, job({ status: "FAILED" })).counts).toMatchObject({ notYet: 15, skipped: 0 });
    for (const status of ["CANCELLED", "COMPLETED", "RUNNING"]) expect(outcomeGroups(cancelled, 0, job({ status })).counts, status).toMatchObject({ notYet: 0, skipped: 15 });
  });

  it("keep every other skipped item as already up to date, and split succeeded items into waiting and translated", () => {
    const kept = ["UP_TO_DATE", "PROTECTED", "TRANSLATION_CHANGED", "RESOURCE_GONE", "SAME_LANGUAGE", "EXCLUDED", "TAKEN_OVER", null].map((code) => ({ status: "SKIPPED", code, count: 1 }));
    expect(outcomeGroups(kept, 0, job()).counts.kept).toBe(8);
    expect(outcomeGroups([{ status: "SUCCEEDED", code: null, count: 10 }], 4, job()).counts).toMatchObject({ waiting: 4, translated: 6 });
    // Never more waiting items than succeeded ones.
    expect(outcomeGroups([{ status: "SUCCEEDED", code: null, count: 2 }], 9, job()).counts).toMatchObject({ waiting: 2, translated: 0 });
    expect(outcomeGroups([{ status: "RUNNING", code: null, count: 3 }], 0, job()).counts.open).toBe(3);
  });

  it("give a list row the same groups from its counters and its items' aggregate", () => {
    expect(rowCounts(J01, R01)).toEqual(outcomeGroups(O01, P01.items, J01));
    expect(rowCounts(J07, R07)).toEqual(outcomeGroups(O07, P07.items, J07));
    expect(rowCounts(J10, R10)).toEqual(outcomeGroups(O10, P10.items, J10));
  });

  it("leave cancelled and incomplete items out of what ended well", () => {
    // ok = succeeded + skipped − cancelled − partial − rejected − changed originals.
    const groups = rowCounts(job({ totalItems: 20, succeededItems: 10, skippedItems: 10 }), outcomesOf({ waiting: 4, partial: 1, rejected: 2, sourceChanged: 3, cancelled: 4 }));
    expect(groups.counts).toEqual({ translated: 5, waiting: 4, kept: 1, look: 6, failed: 0, notYet: 0, skipped: 4, open: 0 });
    expect(ENDED_WELL.reduce((sum, group) => sum + groups.counts[group], 0)).toBe(10 + 10 - 4 - 1 - 2 - 3);
    // A job without item rows (older jobs) counts from its counters alone.
    expect(rowCounts(job({ status: "RUNNING", totalItems: 10, succeededItems: 3, skippedItems: 2, failedItems: 1 })).counts).toEqual({
      translated: 3,
      waiting: 0,
      kept: 2,
      look: 0,
      failed: 1,
      notYet: 0,
      skipped: 0,
      open: 4,
    });
  });
});

describe("DISPLAY_ORDER", () => {
  it("is translated, waiting, kept, look, failed, notYet, skipped, open", () => {
    expect([...DISPLAY_ORDER]).toEqual(["translated", "waiting", "kept", "look", "failed", "notYet", "skipped", "open"]);
  });

  it("orders the legend, the bar and the ring alike: what ended well first and in one piece", () => {
    for (const groups of [outcomeGroups(O01, P01.items, J01), outcomeGroups(O07, P07.items, J07), rowCounts(J12, R12)]) {
      const parts = displayParts(groups).map((part) => part.group);
      expect(legend(groups, false).map((line) => line.group)).toEqual(parts);
      expect(parts).toEqual(DISPLAY_ORDER.filter((group) => parts.includes(group)));
      const firstProblem = parts.findIndex((group) => !ENDED_WELL.includes(group));
      if (firstProblem >= 0) expect(parts.slice(firstProblem).some((group) => ENDED_WELL.includes(group))).toBe(false);
    }
    expect(legend(outcomeGroups(O07, P07.items, J07), false).map((line) => say("de", line.text))).toEqual([
      "52 warten auf deine Freigabe",
      "31 waren schon aktuell",
      "2 unvollständig",
      "3 fehlgeschlagen",
      "1 noch nicht übersetzt",
    ]);
    expect(legend(rowCounts(J12, R12), true).map((line) => say("en", line.text))).toEqual(["2 translated and live", "3 not translated"]);
    expect(legend(rowCounts(J14), false).map((line) => say("en", line.text))).toEqual(["4 translated"]);
  });
});

describe("the ring's figure", () => {
  const share = (ok: number, total: number) => rowCounts(job({ totalItems: total, succeededItems: ok, status: "RUNNING" }));

  it("is what ended well, rounded down, the same while running and once completed", () => {
    const running = outcomeGroups(O01, P01.items, J01);
    expect(ringFigure(translator("en"), running)).toMatchObject({ percent: 60, figure: "60%", caption: "jobs.ring.finished" });
    expect(ringFigure(translator("de"), running).figure).toBe("60 %");
    // The same items once the job completed: the figure doesn't drop.
    expect(ringFigure(translator("de"), outcomeGroups(O01, P01.items, { ...J01, status: "COMPLETED" })).figure).toBe("60 %");
    expect(ringFigure(translator("de"), outcomeGroups(O07, P07.items, J07)).figure).toBe("93 %");
    // 995 of 1,000: never 100 % before every item ended well.
    expect(ringFigure(translator("de"), share(995, 1000)).figure).toBe("99 %");
    expect(ringFigure(translator("de"), share(1000, 1000)).figure).toBe("100 %");
  });

  it("says up to date when every item already was, and counts what was found while finding", () => {
    expect(ringFigure(translator("de"), rowCounts(J13))).toMatchObject({ percent: 100, caption: "jobs.ring.upToDate" });
    expect(translator("de").t(ringFigure(translator("de"), rowCounts(J13)).caption)).toBe("aktuell");
    expect(ringFigure(translator("de"), rowCounts(J02), { finding: true })).toMatchObject({ percent: null, figure: "18", caption: "jobs.ring.found" });
    expect(ringFigure(translator("de"), rowCounts(job({ totalItems: 0 }))).figure).toBe("—");
  });

  it("sizes the figure by its length, a no-break space included, so it keeps clear of the ring", () => {
    expect([ringFigureSize("0%", 112), ringFigureSize("0%", 96)]).toEqual([28, 22]);
    expect([ringFigureSize("62%", 112), ringFigureSize("62%", 96)]).toEqual([24, 20]);
    expect([ringFigureSize("62 %", 112), ringFigureSize("62 %", 96)]).toEqual([20, 17]);
    expect([ringFigureSize("100%", 112), ringFigureSize("100%", 96)]).toEqual([20, 17]);
    expect([ringFigureSize("100 %", 112), ringFigureSize("100 %", 96)]).toEqual([18, 15]);
    expect(ringFigure(translator("en"), share(62, 100)).fontSize).toEqual({ wide: 24, narrow: 20 });
    expect(ringFigure(translator("de"), share(62, 100)).fontSize).toEqual({ wide: 20, narrow: 17 });
    expect(ringFigure(translator("de"), share(100, 100)).fontSize).toEqual({ wide: 18, narrow: 15 });
    // One rule: the ring component draws its figure with this very function.
    expect(coverageRingFigureSize).toBe(ringFigureSize);
  });
});

describe("a row's result", () => {
  const fragments = (locale: AppLocale, row: ReturnType<typeof rowOf>) => {
    const result = rowResult(row);
    if (result.live) throw new Error("a live row");
    return result.fragments.map((f) => `${f.look}/${f.tone ?? "-"}: ${say(locale, f.text)}`);
  };

  it("shows a live row's words and its bar", () => {
    const running = rowResult(rowOf(J01, R01));
    expect(running).toMatchObject({ live: true, subdued: false, bar: "segments" });
    if (!running.live) throw new Error("live");
    expect(say("de", running.text)).toBe("206 von 340 fertig · 60 %");
    expect(say("en", running.text)).toBe("206 of 340 done · 60%");
    const finding = rowResult(rowOf(J02));
    expect(finding).toMatchObject({ live: true, subdued: true, bar: "striped" });
    if (finding.live) expect(say("de", finding.text)).toBe("Bisher 18 gefunden");
    const queued = rowResult(rowOf(J03));
    expect(queued).toMatchObject({ live: true, subdued: true, bar: null });
    if (queued.live) expect(say("de", queued.text)).toBe("Startet gleich");
    const waiting = rowResult(rowOf(J03), { workerDown: true });
    if (waiting.live) expect(say("en", waiting.text)).toBe("Starts with a delay");
  });

  it("says what came out, failed before incomplete before waiting or translated, at most two", () => {
    expect(fragments("de", rowOf(J07, R07))).toEqual(["failed/critical: 3 fehlgeschlagen", "look/caution: 2 unvollständig"]);
    expect(fragments("en", rowOf(J07, R07))).toEqual(["failed/critical: 3 failed", "look/caution: 2 incomplete"]);
    expect(fragments("de", rowOf(J16, R16))).toEqual(["look/caution: 2 unvollständig", "waiting/-: 10 warten auf deine Freigabe"]);
    expect(fragments("en", rowOf(J16, R16))).toEqual(["look/caution: 2 incomplete", "waiting/-: 10 wait for your approval"]);
    expect(fragments("de", rowOf(J04, R04))).toEqual(["waiting/-: 14 warten auf deine Freigabe"]);
    expect(fragments("de", rowOf(J06, R06))).toEqual(["waiting/-: 12 warten auf deine Freigabe"]);
    expect(fragments("de", rowOf(J09))).toEqual(["translated/-: 4 übersetzt und live"]);
    // A job whose drafts were decided: translated, not "live".
    expect(fragments("de", rowOf(J14))).toEqual(["translated/-: 4 übersetzt"]);
    expect(fragments("en", rowOf(job({ totalItems: 9, succeededItems: 5, failedItems: 4 }), { waiting: 2, retryable: 4 }))).toEqual(["failed/critical: 4 failed", "waiting/-: 2 wait for your approval"]);
  });

  it("says everything was already up to date only when nothing was translated, failed or left out", () => {
    expect(fragments("de", rowOf(J13))).toEqual(["kept/subdued: Alles war schon aktuell"]);
    expect(fragments("en", rowOf(job({ totalItems: 0 })))).toEqual(["kept/subdued: Everything was already up to date"]);
    // A smart job whose items the paused schedule left out: not "up to date".
    expect(fragments("en", rowOf(job({ requestedBy: SMART, smartRunId: "run-5", totalItems: 5, skippedItems: 5 }), { cancelled: 4, sourceChanged: 1 }))).toEqual([
      "notYet/subdued: 1 not translated yet",
      "skipped/subdued: 4 not translated",
    ]);
  });

  it("names a stop's cause in its look, and what a cancelled job finished", () => {
    expect(fragments("de", rowOf(J10, R10))).toEqual(["paused/critical: Übersetzungsdienst nicht erlaubt"]);
    expect(fragments("de", rowOf(J10, R10, true))).toEqual(["paused/warning: Übersetzungsdienst nicht erlaubt"]);
    expect(fragments("de", rowOf(job({ status: "FAILED", errorCode: "DAILY_LIMIT" })))).toEqual(["paused/warning: Tageskontingent aufgebraucht"]);
    expect(fragments("de", rowOf(job({ status: "FAILED", errorCode: "OWN_KEY_QUOTA_AZURE" })))).toEqual(["paused/critical: Microsoft Azure-Schlüssel aufgebraucht"]);
    expect(fragments("en", rowOf(job({ status: "FAILED", errorCode: "OWN_KEY_AUTH_GOOGLE" })))).toEqual(["paused/critical: Google Cloud refused your key"]);
    expect(fragments("de", rowOf(J05, R05))).toEqual(["skipped/subdued: 120 von 410 fertig"]);
    expect(fragments("en", rowOf(J12, R12))).toEqual(["skipped/subdued: 2 of 5 done"]);
  });
});

describe("a row's meta", () => {
  const meta = (locale: AppLocale, row: ReturnType<typeof rowOf>, options: Parameters<typeof rowMeta>[1] = {}) =>
    rowMeta(row, { actorId: ACTOR, ...options })
      .map((part) => valueText(locale, part))
      .join(" · ");
  const FOUR_MINUTES = 4 * 60_000;

  it("follows the list's table on a wide card", () => {
    expect(meta("de", rowOf(J01, R01), { eta: FOUR_MINUTES })).toBe("Wird übersetzt · noch etwa 4 Minuten · von dir");
    expect(meta("en", rowOf(J01, R01), { eta: FOUR_MINUTES })).toBe("Translating · about 4 minutes left · by you");
    expect(meta("de", rowOf(J01, R01))).toBe("Wird übersetzt · von dir");
    expect(meta("de", rowOf(J02))).toBe(`Inhalte werden gesucht · Abgleich um ${clock("de", today("14:00"))}`);
    expect(meta("de", rowOf(J03))).toBe("In der Warteschlange · von dir");
    expect(meta("de", rowOf(J04, R04))).toBe("Abgeschlossen · 14 Kollektionen · von dir");
    expect(meta("en", rowOf(J04, R04))).toBe("Completed · 14 collections · by you");
    expect(meta("de", rowOf(J05, R05))).toBe(`Abgebrochen um ${clock("de", today("08:55"))} · von dir gestartet`);
    expect(meta("de", rowOf(J06, R06))).toBe(`Abgeschlossen · Änderungen von ${clock("de", today("06:10"))} bis ${clock("de", today("13:45"))}`);
    expect(meta("en", rowOf(J06, R06))).toBe(`Completed · changes from ${clock("en", today("06:10"))} to ${clock("en", today("13:45"))}`);
    expect(meta("de", rowOf(J07, R07))).toBe("Abgeschlossen mit Fehlern · 89 Produkte");
    expect(meta("de", rowOf(J10, R10))).toBe("Angehalten · 9 von 24 fertig · von dir");
    expect(meta("de", rowOf(J11))).toBe("Abgeschlossen · 6 Seiten · von dir");
    expect(meta("de", rowOf(J12, R12))).toBe("Abgebrochen: automatische Übersetzung aus");
    expect(meta("de", rowOf(J16, R16))).toBe("Abgeschlossen, teils unvollständig · 12 Seiten · von dir");
  });

  it("says who started it: you, your team, nobody for older jobs; automatic and smart jobs carry a badge instead", () => {
    expect(meta("de", rowOf({ ...J04, requestedBy: "77" }, R04))).toBe("Abgeschlossen · 14 Kollektionen · von deinem Team");
    expect(meta("de", rowOf({ ...J04, requestedBy: null }, R04))).toBe("Abgeschlossen · 14 Kollektionen");
    expect(meta("de", rowOf(J15))).toBe("Abgeschlossen · 24 Zusatzinfos");
    expect(meta("de", rowOf({ ...J05, requestedBy: "77" }, R05))).toBe(`Abgebrochen um ${clock("de", today("08:55"))} · von deinem Team`);
  });

  it("never shows a time left for a job that collects changes", () => {
    expect(meta("de", rowOf({ ...J06, status: "RUNNING" }, R06), { eta: FOUR_MINUTES })).toBe("Wird übersetzt");
    expect(meta("de", rowOf({ ...J06, status: "RUNNING", requestedBy: SMART }, R06), { eta: FOUR_MINUTES })).toBe("Wird übersetzt");
  });

  it("starts a narrow card with the origin, in the state word's place", () => {
    expect(meta("de", rowOf(J06, R06), { narrow: true })).toBe(`Automatisch · Änderungen von ${clock("de", today("06:10"))} bis ${clock("de", today("13:45"))}`);
    expect(meta("en", rowOf(J06, R06), { narrow: true })).toBe(`Automatic · changes from ${clock("en", today("06:10"))} to ${clock("en", today("13:45"))}`);
    expect(meta("de", rowOf(J02), { narrow: true })).toBe(`Vom Zeitplan · Abgleich um ${clock("de", today("14:00"))}`);
    expect(meta("en", rowOf(J02), { narrow: true })).toBe(`By the schedule · check at ${clock("en", today("14:00"))}`);
    expect(meta("de", rowOf(J11), { narrow: true })).toBe("Nur Texte für Google · 6 Seiten · von dir");
    expect(meta("en", rowOf(J11), { narrow: true })).toBe("Only texts for Google · 6 pages · by you");
    expect(meta("de", rowOf(J15), { narrow: true })).toBe("Vom Zeitplan · 24 Zusatzinfos");
    // Without an origin the wide meta stays.
    expect(meta("de", rowOf(J01, R01), { narrow: true, eta: FOUR_MINUTES })).toBe("Wird übersetzt · noch etwa 4 Minuten · von dir");
    // Inside a cluster its header names the check.
    expect(meta("de", rowOf(J07, R07), { narrow: true, inCluster: true })).toBe("Abgeschlossen mit Fehlern · 89 Produkte");
    // A system cancel keeps its reason, which names the origin.
    expect(meta("de", rowOf(J12, R12), { narrow: true })).toBe("Abgebrochen: automatische Übersetzung aus");
    // A cancelled row keeps when it was cancelled.
    expect(meta("de", rowOf({ ...J05, fieldScope: "SEO" }, R05), { narrow: true })).toBe(`Nur Texte für Google · Abgebrochen um ${clock("de", today("08:55"))} · von dir gestartet`);
  });
});

describe("dayGroups", () => {
  const rows = (...instants: string[]) => instants.map((createdAt, i) => ({ id: `job-${i + 1}`, createdAt }));
  const days = (zone: string | null, list: Array<{ createdAt: string }>) => dayGroups(list, zone, NOW).map((g) => [g.day, g.daysAgo, g.rows.length]);

  it("groups rows by their calendar day in the store's zone", () => {
    // 23:30 UTC on October 27 is 00:30 on October 28 in Berlin.
    const list = rows("2026-11-02T08:00:00Z", "2026-11-01T22:30:00Z", "2026-10-27T23:30:00Z");
    expect(days(ZONE, list)).toEqual([
      ["2026-11-02", 0, 1],
      ["2026-11-01", 1, 1],
      ["2026-10-28", 5, 1],
    ]);
    expect(days("UTC", list)).toEqual([
      ["2026-11-02", 0, 1],
      ["2026-11-01", 1, 1],
      ["2026-10-27", 6, 1],
    ]);
    // The heading's instant is one of the day's (its newest row's).
    expect(dayGroups(list, ZONE, NOW)[2]!.at).toBe("2026-10-27T23:30:00Z");
  });

  it("counts days across the change to winter time on October 25, 2026", () => {
    // Oct 26 00:30 CET · Oct 25 23:30 CET · Oct 25 00:30 CEST · Oct 24 23:30 CEST.
    const list = rows("2026-10-25T23:30:00Z", "2026-10-25T22:30:00Z", "2026-10-24T22:30:00Z", "2026-10-24T21:30:00Z");
    expect(days(ZONE, list)).toEqual([
      ["2026-10-26", 7, 1],
      ["2026-10-25", 8, 2],
      ["2026-10-24", 9, 1],
    ]);
  });

  it("gives the day a heading needs: today, yesterday, 2 to 6 days ago by weekday, from 7 by date", () => {
    // On Monday, November 2: Friday, October 30 lies in the previous ISO week but is 3 days ago; Tuesday, October 27 is 6.
    const list = rows("2026-10-30T14:48:00Z", "2026-10-27T10:00:00Z", "2026-10-26T10:00:00Z", "2025-05-12T12:12:00Z");
    expect(days(ZONE, list)).toEqual([
      ["2026-10-30", 3, 1],
      ["2026-10-27", 6, 1],
      ["2026-10-26", 7, 1],
      ["2025-05-12", 539, 1],
    ]);
    // 04:30 UTC on November 2 is still November 1 (yesterday) in New York.
    expect(days("America/New_York", rows("2026-11-02T04:30:00Z"))).toEqual([["2026-11-01", 1, 1]]);
  });

  it("shows UTC days for a missing, unknown or offset zone (a name every browser knows)", () => {
    const list = rows("2026-10-27T23:30:00Z");
    for (const zone of [null, "", "Mars/Olympus", "+05:30"]) expect(days(zone, list), String(zone)).toEqual([["2026-10-27", 6, 1]]);
  });

  it("gets its headings from the page's i18n.dayHeading: the spec's titles in the store's zone", () => {
    const de = translator("de", { timeZone: ZONE });
    // Newest first; 23:30 UTC on Tuesday, October 27 is Wednesday, October 28 in Berlin.
    const list = rows("2026-11-02T08:00:00Z", "2026-11-01T22:30:00Z", "2026-10-30T14:48:00Z", "2026-10-27T23:30:00Z", "2026-10-27T10:00:00Z", "2026-10-26T10:00:00Z", "2025-05-12T12:12:00Z");
    const headings = dayGroups(list, de.timeZone, NOW).map((day) => Object.values(de.dayHeading(day.at, NOW)).join(" · "));
    expect(headings).toEqual([
      "Heute · Montag, 2. November",
      "Gestern · Sonntag, 1. November",
      "Freitag · 30. Oktober",
      "Mittwoch · 28. Oktober",
      "Dienstag · 27. Oktober",
      "26. Oktober · Montag",
      "12. Mai 2025 · Montag",
    ]);
  });

  it("puts every row under its own day's heading, in every zone the pages show or replace by UTC", () => {
    // Around midnight in each zone and across the changes to winter time (Berlin October 25, New York November 1), newest first.
    const list = rows(
      "2026-11-02T13:00:00Z",
      "2026-11-01T23:30:00Z",
      "2026-11-01T15:30:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T04:30:00Z",
      "2026-11-01T03:30:00Z",
      "2026-10-25T23:30:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-24T22:30:00Z",
      "2026-10-24T21:30:00Z",
      "2025-12-31T23:30:00Z",
    );
    const weekdays = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
    // "Japan" and "EST": zone names without a region, which the pages show as given.
    for (const zone of [ZONE, "America/New_York", "Asia/Kolkata", "Japan", "EST", "Etc/UTC", "GMT", "UTC", null, "+05:30", "Mars/Olympus"]) {
      const de = translator("de", { timeZone: zone });
      const heading = (at: string | Date) => Object.values(de.dayHeading(at, NOW)).join(" · ");
      const groups = dayGroups(list, zone, NOW);
      // The store's zone as given or as the page's i18n names it: the same days.
      expect(dayGroups(list, de.timeZone, NOW), String(zone)).toEqual(groups);
      const shown = groups.map((day) => heading(day.at));
      expect(new Set(shown).size, `${zone}: one heading per day`).toBe(groups.length);
      for (const day of groups) {
        for (const row of day.rows) expect(heading(row.createdAt), `${zone}: ${row.createdAt}`).toBe(heading(day.at));
        const title = de.dayHeading(day.at, NOW).title;
        const expected = day.daysAgo === 0 ? "Heute" : day.daysAgo === 1 ? "Gestern" : day.daysAgo <= 6 ? "weekday" : "date";
        expect(title === "Heute" ? "Heute" : title === "Gestern" ? "Gestern" : weekdays.includes(title) ? "weekday" : /^\d/.test(title) ? "date" : title, `${zone}: ${day.day}`).toBe(expected);
      }
    }
  });
});

describe("clusters", () => {
  const row = (n: number, hhmm: string, fields: { resourceType?: string; smartRunId?: string | null; idempotencyKey?: string } = {}) => ({
    id: id(n),
    createdAt: today(hhmm),
    resourceType: fields.resourceType ?? "PRODUCT",
    smartRunId: fields.smartRunId ?? null,
    idempotencyKey: fields.idempotencyKey ?? `form-${n}`,
  });
  const shape = (entries: ReturnType<typeof clusters>) => entries.map((e) => (e.kind === "row" ? e.row.id.slice(6, 8) : `${e.cluster.origin}:${e.cluster.rows.map((r) => r.id.slice(6, 8)).join(",")}`));

  it("puts adjacent rows of one smart check, or of one click, together", () => {
    const list = [
      row(9, "03:01", { resourceType: "ARTICLE", smartRunId: "run-2" }),
      row(8, "03:00", { resourceType: "MEDIA_IMAGE", smartRunId: "run-2" }),
      row(7, "03:00", { smartRunId: "run-2" }),
      row(21, "02:40", { resourceType: "MENU", idempotencyKey: "form-x:MENU" }),
      row(20, "02:40", { resourceType: "LINK", idempotencyKey: "form-x:LINK" }),
      row(19, "02:30"),
    ];
    expect(shape(clusters(list))).toEqual(["smart:09,08,07", "click:21,20", "19"]);
  });

  it("never makes a cluster of one row, of rows that aren't neighbours, or of automatic jobs", () => {
    expect(shape(clusters([row(7, "03:00", { smartRunId: "run-2" })]))).toEqual(["07"]);
    expect(shape(clusters([row(7, "03:00", { smartRunId: "run-2" }), row(19, "02:59"), row(8, "02:58", { smartRunId: "run-2" })]))).toEqual(["07", "19", "08"]);
    // One kind per click has no ":<TYPE>" of its own; automatic jobs' keys are their own.
    expect(shape(clusters([row(1, "14:02"), row(2, "14:02")]))).toEqual(["01", "02"]);
    expect(shape(clusters([row(6, "06:10", { idempotencyKey: "auto-a" }), row(13, "06:09", { idempotencyKey: "auto-b" })]))).toEqual(["06", "13"]);
  });

  it("never spans two days: clusters are made per day", () => {
    const list = [
      { ...row(31, "00:00", { smartRunId: "run-9" }), createdAt: "2026-11-01T23:00:30Z" },
      { ...row(30, "00:00", { smartRunId: "run-9" }), createdAt: "2026-11-01T22:59:50Z" },
    ];
    expect(dayGroups(list, ZONE, NOW).map((day) => shape(clusters(day.rows)))).toEqual([["31"], ["30"]]);
  });

  it("titles a cluster with its first job's time and counts its jobs", () => {
    const [smart, click] = clusters([
      row(9, "03:01", { smartRunId: "run-2" }),
      row(7, "03:00", { smartRunId: "run-2" }),
      row(21, "14:02", { resourceType: "MENU", idempotencyKey: "form-x:MENU" }),
      row(20, "14:02", { resourceType: "LINK", idempotencyKey: "form-x:LINK" }),
    ]);
    if (smart?.kind !== "cluster" || click?.kind !== "cluster") throw new Error("two clusters");
    expect(say("de", smart.cluster.title)).toBe(`Abgleich des Zeitplans um ${clock("de", today("03:00"))}`);
    expect(say("en", smart.cluster.count)).toBe("2 jobs");
    expect(smart.cluster.link).toEqual({ href: "/app/settings/automatic#smart-activity", label: { key: "jobs.cluster.schedule" } });
    expect(say("de", click.cluster.title)).toBe(`Zusammen gestartet um ${clock("de", today("14:02"))}`);
    expect(click.cluster.link).toBeNull();
    expect(smart.cluster.key).toBe(id(9));
  });
});

describe("heroModel", () => {
  const NONE = { translations: 0, items: 0 };
  function hero(j: JobFields, groups: JobGroups, pending = NONE, stop: Parameters<typeof heroModel>[3] = null, options: Parameters<typeof heroModel>[4] = {}): HeroModel {
    const model = heroModel(j, groups, pending, stop, options);
    // Exactly one primary or none, in every state.
    expect((model.panel?.steps ?? []).filter((step) => step.primary).length).toBeLessThanOrEqual(1);
    return model;
  }
  const action = (locale: AppLocale, a: NonNullable<HeroModel["panel"]>["steps"][number]["action"]) =>
    a === null ? null : a.kind === "link" ? `${say(locale, a.label)} → ${a.href}` : `${a.kind}: ${say(locale, a.label)}`;
  const steps = (locale: AppLocale, model: HeroModel) =>
    (model.panel?.steps ?? []).map((step) => [step.id, say(locale, step.title), sayAll(locale, step.text), action(locale, step.action), step.primary ? "primary" : "-"]);
  const lines = (locale: AppLocale, model: HeroModel) => model.lines.map((line) => `${line.live ? "live" : (line.tone ?? "subdued")}: ${sayAll(locale, line.text)}`);
  const label = (locale: AppLocale, model: HeroModel) => (model.mark.kind === "ring" ? say(locale, model.mark.label) : null);
  const strip = (locale: AppLocale, model: HeroModel) => {
    if (!model.strip) return null;
    if (model.strip.kind === "foot") return `foot: ${say(locale, model.strip.foot.text)} ${say(locale, model.strip.foot.action.label)}`;
    const a = model.strip.action;
    return `${model.strip.icon}: ${say(locale, model.strip.title)} ${say(locale, model.strip.text)}${a ? ` [${a.kind === "link" ? `${say(locale, a.label)} → ${a.href}` : say(locale, a.label)}]` : ""}`;
  };

  it("shows a queued job with a clock mark, a calm line and the cancel foot alone", () => {
    const model = hero(J03, rowCounts(J03));
    expect(model).toMatchObject({ state: "queued", mark: { kind: "clock", tone: "info" }, legend: [], panel: null });
    expect(say("de", model.title)).toBe("Startet gleich");
    expect(lines("de", model)).toEqual(["subdued: Linguva sucht gleich, was zu übersetzen ist. Du kannst die Seite verlassen."]);
    expect(strip("de", model)).toBe("foot: Nicht mehr nötig? Auftrag abbrechen");
    // Background jobs don't run: the title and line say so in caution, the strip stays the cancel foot.
    const down = hero(J03, rowCounts(J03), NONE, null, { workerDown: true });
    expect(down.mark).toEqual({ kind: "clock", tone: "caution" });
    expect(say("de", down.title)).toBe("Startet verzögert");
    expect(lines("de", down)).toEqual(["subdued: Linguvas Hintergrunddienst läuft gerade nicht. Er startet von selbst neu, dann beginnt der Auftrag von allein."]);
    expect(strip("en", down)).toBe("foot: No longer needed? Cancel job");
  });

  it("shows a finding job's dashed ring with the count so far and a neutral strip (…02)", () => {
    const model = hero(J02, rowCounts(J02));
    expect(model).toMatchObject({ state: "finding", mark: { kind: "ring", dashed: true, caption: "jobs.ring.found" }, legend: [], panel: null });
    expect(label("de", model)).toBe("Bisher 18 gefunden, es wird noch gesucht.");
    expect(say("de", model.title)).toBe("Bildbeschreibungen (Produkte): bisher 18 gefunden");
    expect(lines("de", model)).toEqual(["subdued: Linguva sucht noch, was zu übersetzen ist. Die Restzeit erscheint, sobald die Suche fertig ist.", "live: Aktualisiert sich von selbst"]);
    expect(strip("de", model)).toBe("active: Nichts zu tun. Der Zeitplan übersetzt von selbst; du kannst die Seite verlassen. [Auftrag abbrechen]");
    // Drafts already wait: the review step, with the cancel foot.
    const drafts = hero(J02, rowCounts(J02), { translations: 6, items: 6 });
    expect(steps("de", drafts).map((s) => [s[0], s[4]])).toEqual([["review", "primary"]]);
    expect(drafts.panel?.foot?.wide).toBe(280);
  });

  it("shows a running job's figure and time left, then review and retry only what a new try fixes (…01)", () => {
    const model = hero(J01, outcomeGroups(O01, P01.items, J01), P01, null, { eta: 4 * 60_000 });
    expect(model.state).toBe("running");
    expect(say("de", model.title)).toBe("Produkte: 206 von 340 fertig");
    expect(say("en", model.title)).toBe("Products: 206 of 340 done");
    expect(label("de", model)).toBe("60 % fertig. Produkte: 206 von 340 fertig. 176 warten auf deine Freigabe, 30 waren schon aktuell, 2 unvollständig, 4 fehlgeschlagen, 128 noch offen.");
    expect(label("en", model)).toBe("60% done. Products: 206 of 340 done. 176 wait for your approval, 30 were already up to date, 2 incomplete, 4 failed, 128 still to do.");
    expect(lines("de", model)).toEqual(["subdued: Noch etwa 4 Minuten. Du kannst die Seite verlassen, der Auftrag läuft weiter.", "live: Aktualisiert sich von selbst"]);
    expect(steps("de", model)).toEqual([
      ["review", "452 Übersetzungen freigeben", "Für 176 Produkte. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.", `Jetzt freigeben → /app/review?job=${id(1)}`, "primary"],
      ["retry", "1 Produkt noch einmal versuchen", "Ein neuer Versuch klappt meistens, etwa wenn ein Dienst kurz nicht erreichbar war.", "retry: Wiederholen", "-"],
    ]);
    const retry = model.panel!.steps[1]!.action;
    expect(retry?.kind === "retry" && say("en", retry.accessibilityLabel)).toBe("Retry: 1 product");
    expect(model.panel?.foot).toMatchObject({ wide: 280, action: { kind: "cancel" } });
    expect(model.legend.map((line) => line.group)).toEqual(["waiting", "kept", "look", "failed", "open"]);
    // Without an estimate yet.
    expect(lines("en", hero(J01, outcomeGroups(O01, P01.items, J01), P01))[0]).toBe("subdued: You can leave this page; the job keeps running. The time left appears once enough is done.");
  });

  it("never gives a job that collects changes a time left; without steps a running job gets a neutral strip with cancel", () => {
    const automatic = hero({ ...J06, status: "RUNNING" }, rowCounts({ ...J06, status: "RUNNING" }), NONE, null, { eta: 60_000 });
    expect(lines("de", automatic)).toEqual(["live: Aktualisiert sich von selbst"]);
    expect(strip("de", automatic)).toBe("active: Nichts zu tun. Du kannst die Seite verlassen; Linguva übersetzt im Hintergrund weiter. [Auftrag abbrechen]");
  });

  it("shows a finished job with problems: review, retry 1, finish 4 in the editor, the smart job's changed original in none (…07)", () => {
    const groups = outcomeGroups(O07, P07.items, J07);
    const model = hero(J07, groups, P07);
    expect(model.state).toBe("doneErrors");
    expect(say("de", model.title)).toBe("Produkte: 83 von 89 fertig");
    expect(label("de", model)?.startsWith("93 % fertig. Produkte: 83 von 89 fertig. 52 warten auf deine Freigabe, 31 waren schon aktuell, 2 unvollständig, 3 fehlgeschlagen, 1 noch nicht übersetzt.")).toBe(true);
    expect(lines("de", model)).toEqual(["subdued: Kunden sehen die neuen Übersetzungen, sobald du sie freigibst. Was fehlt, steht weiter unten."]);
    expect(steps("de", model)).toEqual([
      ["review", "140 Übersetzungen freigeben", "Für 52 Produkte. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.", `Jetzt freigeben → /app/review?job=${id(7)}`, "primary"],
      ["retry", "1 Produkt noch einmal versuchen", "Ein neuer Versuch klappt meistens, etwa wenn ein Dienst kurz nicht erreichbar war.", "retry: Wiederholen", "-"],
      ["finish", "4 Produkte im Editor fertig übersetzen", "Ein neuer Versuch hilft hier nicht; das geht nur im Editor.", "Einträge zeigen → #problems-heading", "-"],
    ]);
    expect(steps("en", model).map((s) => s[1])).toEqual(["Approve 140 translations", "Try 1 product again", "Finish 4 products in the editor"]);
    const problems = problemsHeading(J07, groups)!;
    expect(say("de", problems.heading)).toBe("5 Produkte brauchen deine Aufmerksamkeit");
    expect(sayAll("de", problems.text)).toBe("83 von 89 sind in Ordnung. Öffne eine Zeile, um sie im Editor fertig zu übersetzen.");
    expect(say("en", problems.heading)).toBe("5 products need your attention");
    // What a row does on every device (a phone has no click); "done" stays the state's word.
    expect(sayAll("en", problems.text)).toBe("83 of 89 are fine. Open one to finish it in the editor.");
    // Without drafts the retry leads.
    expect(steps("en", hero(J07, outcomeGroups(O07, 0, J07))).map((s) => [s[0], s[4]])).toEqual([
      ["retry", "primary"],
      ["finish", "-"],
    ]);
  });

  it("opens the editor of the one item only the editor finishes, and shows the list for several (French · Pages)", () => {
    const pages = job({ id: id(17), resourceType: "PAGE", publishMode: "AUTO_PUBLISH", totalItems: 4, succeededItems: 2, skippedItems: 1, failedItems: 1 });
    const outcomes: ItemOutcomes[] = [
      { status: "SUCCEEDED", code: null, count: 2 },
      { status: "SKIPPED", code: "UP_TO_DATE", count: 1 },
      { status: "FAILED", code: "PROVIDER_REJECTED", count: 1 },
    ];
    const groups = outcomeGroups(outcomes, 0, pages);
    const editor = "/app/pages/4?lang=fr";
    const href = finishTarget(pages, [{ status: "FAILED", errorCode: "PROVIDER_REJECTED", href: editor }]);
    expect(href).toBe(editor);
    const one = hero(pages, groups, NONE, null, { finishHref: href });
    expect(steps("de", one)).toEqual([["finish", "1 Seite im Editor fertig übersetzen", "Ein neuer Versuch hilft hier nicht; das geht nur im Editor.", `Im Editor öffnen → ${editor}`, "primary"]]);
    expect(steps("en", one)[0]![3]).toBe(`Open in editor → ${editor}`);
    // Beside "75% done", the reason never says "done": the merchant finishes it.
    expect(steps("en", one)[0]![2]).toBe("Trying again won't help here – finish it yourself in the editor.");
    expect(steps("en", hero(J07, outcomeGroups(O07, 0, J07)))[1]![2]).toBe("Trying again won't help here – finish them yourself in the editor.");
    expect(one.panel!.steps[0]!.action).toMatchObject({ kind: "link", icon: "edit" });
    // Without its editor's address (Shopify's list too long, or no editor for the kind): the list below.
    expect(steps("en", hero(pages, groups, NONE, null, { finishHref: null }))[0]![3]).toBe("Show items → #problems-heading");
    // Several: never one item's editor, even with an address.
    expect(steps("en", hero(J07, outcomeGroups(O07, 0, J07), NONE, null, { finishHref: editor }))[1]![3]).toBe("Show items → #problems-heading");
  });

  it("finds that one item by outcomeGroups' rule: incomplete or failed for good, never what a new try or the schedule fixes", () => {
    const item = (status: string, errorCode: string | null, href: string | null = `/app/products/${status}-${errorCode}`) => ({ status, errorCode, href });
    const own = job();
    const smart = job({ requestedBy: SMART, smartRunId: "run-9" });
    for (const one of [item("SUCCEEDED", "PARTIAL"), item("SKIPPED", "ALL_FIELDS_REJECTED"), item("SKIPPED", "SOURCE_CHANGED"), item("FAILED", "PROVIDER_REJECTED"), item("FAILED", "TOO_LARGE_FOR_LIMIT")]) {
      expect(finishTarget(own, [one, item("DEAD", "PROVIDER_UNAVAILABLE"), item("FAILED", "PROVIDER_UNAVAILABLE")]), `${one.status} ${one.errorCode}`).toBe(one.href);
    }
    // A smart job's changed original is its schedule's; a new try fixes DEAD and retryable failures.
    expect(finishTarget(smart, [item("SKIPPED", "SOURCE_CHANGED")])).toBeNull();
    expect(finishTarget(own, [item("DEAD", "PROVIDER_REJECTED"), item("FAILED", null)])).toBeNull();
    // Two, none, or one without an editor.
    expect(finishTarget(own, [item("SUCCEEDED", "PARTIAL"), item("FAILED", "PROVIDER_REJECTED")])).toBeNull();
    expect(finishTarget(own, [])).toBeNull();
    expect(finishTarget(own, [item("FAILED", "PROVIDER_REJECTED", null)])).toBeNull();
  });

  it("shows a finished job whose translations wait, one that is live, and one with nothing to do", () => {
    const waiting = hero(J04, rowCounts(J04, R04), { translations: 14, items: 14 });
    expect(say("de", waiting.title)).toBe("Kollektionen: alle 14 fertig");
    expect(lines("de", waiting)).toEqual(["subdued: Kunden sehen die neuen Übersetzungen, sobald du sie freigibst."]);
    expect(steps("de", waiting).map((s) => [s[1], s[4]])).toEqual([["14 Übersetzungen freigeben", "primary"]]);
    const live = hero(J09, rowCounts(J09));
    expect(say("de", live.title)).toBe("Blogbeiträge: alle 4 fertig");
    expect(lines("de", live)).toEqual(["subdued: Kunden sehen die Übersetzungen schon."]);
    expect(strip("de", live)).toBe("done: Alles ist live. Es gibt nichts zu tun. [Deutsch ansehen → /app/languages/de]");
    expect(live.panel).toBeNull();
    const nothing = hero(J13, rowCounts(J13));
    expect(nothing.mark).toMatchObject({ kind: "ring", caption: "jobs.ring.upToDate" });
    expect(label("de", nothing)).toBe("100 % aktuell. Produkte: alle 23 waren schon aktuell. 23 waren schon aktuell.");
    expect(say("de", nothing.title)).toBe("Produkte: alle 23 waren schon aktuell");
    expect(lines("de", nothing)).toEqual(["subdued: Linguva hat 23 Produkte durchgesehen. Alles war schon übersetzt und aktuell."]);
    expect(lines("en", nothing)).toEqual(["subdued: Linguva looked through 23 products. Everything was already translated and up to date."]);
    expect(strip("de", nothing)).toBe(
      "done: Nichts zu tun. Wenn etwas deine Hilfe braucht, siehst du es unter „Aufträge“. [Automatische Übersetzung einstellen → /app/settings?section=changes]",
    );
    // A merchant's job with nothing to do has no settings to change.
    expect(strip("en", hero({ ...J13, requestedBy: ACTOR }, rowCounts(J13)))).toBe("done: Nothing to do. If something needs you, you'll see it under “Jobs”.");
  });

  it("shows a stopped job: fix, resume, review, and once the cause is fixed a primary resume (…10)", () => {
    const groups = outcomeGroups(O10, P10.items, J10);
    const model = hero(J10, groups, P10, { fixed: false });
    expect(model.state).toBe("stopped");
    expect(say("de", model.title)).toBe("Kollektionen: 9 von 24 fertig");
    expect(label("de", model)?.startsWith("37 % fertig.")).toBe(true);
    expect(lines("de", model)).toEqual(["critical: Italienisch übersetzt ein Dienst, den dein Shop noch nicht erlaubt hat.", "subdued: Was schon übersetzt ist, bleibt. Nichts geht verloren."]);
    expect(model.panel?.heading).toBe("jobs.next.howTo");
    const section = translator("de").t("settings.ai.heading");
    expect(steps("de", model)).toEqual([
      ["fix", "Übersetzungsdienst erlauben", `In den Einstellungen unter „${section}“. Das dauert eine Minute.`, `In den Einstellungen erlauben → /app/settings?section=ai&job=${id(10)}`, "primary"],
      ["resume", "Auftrag fortsetzen", "Danach übersetzt Linguva die übrigen 15 Kollektionen. 9 Kollektionen sind schon fertig und bleiben.", "resume: Auftrag fortsetzen", "-"],
      ["review", "27 Übersetzungen freigeben", "Für 9 Kollektionen. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.", `Jetzt freigeben → /app/review?job=${id(10)}`, "-"],
    ]);
    expect(steps("en", model).map((s) => s[1])).toEqual(["Allow the translation service", "Resume the job", "Approve 27 translations"]);
    expect(model.panel?.foot).toBeNull();
    expect(model.panel?.fold).toBeNull();
    // Back from Settings: the cause is fixed, the stop goes on with one click.
    const fixed = hero(J10, groups, P10, { fixed: true });
    expect(fixed.state).toBe("stoppedWait");
    expect(lines("de", fixed)[0]).toBe("success: Die Ursache ist behoben – setze den Auftrag fort.");
    // Good news in its own look, the stop's reason with the stop's pause.
    expect([fixed.lines[0]!.icon, model.lines[0]!.icon]).toEqual(["check-circle", "pause-circle"]);
    expect(steps("en", fixed).map((s) => [s[0], s[1], s[4]])).toEqual([
      ["resume", "You can resume now", "primary"],
      ["review", "Approve 27 translations", "-"],
    ]);
  });

  it("waits for the daily reset with review first and the plans foot, and resumes once the allowance is back", () => {
    const stopped = job({ id: id(40), resourceType: "ARTICLE", targetLocale: "es", status: "FAILED", errorCode: "DAILY_LIMIT", totalItems: 64, succeededItems: 18, skippedItems: 46 });
    const groups = rowCounts(stopped, outcomesOf({ waiting: 18, cancelled: 46 }));
    const pending = { translations: 54, items: 18 };
    const model = hero(stopped, groups, pending, { fixed: false, resumesAt: "2026-11-03T00:00:00.000Z" });
    expect(say("de", model.title)).toBe("Blogbeiträge: 18 von 64 fertig");
    expect(lines("de", model)[0]).toBe(`warning: Das KI‑Kontingent für heute ist aufgebraucht. Ab ${clock("de", "2026-11-03T00:00:00.000Z")} kannst du fortsetzen.`);
    expect(steps("de", model)).toEqual([
      ["review", "54 Übersetzungen freigeben", "Für 18 Blogbeiträge. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.", `Jetzt freigeben → /app/review?job=${id(40)}`, "primary"],
      ["wait", "Ab 01:00 fortsetzen", "Dann ist das Tageskontingent wieder da. Der Knopf zum Fortsetzen erscheint hier von selbst.", null, "-"],
    ]);
    // The page's timeRef writes the reset (midnight UTC, 1:00 in Berlin): 12-hour in English, Spanish with its article.
    expect(steps("en", model)[1]?.[1]).toBe("Resume from 1:00 AM");
    expect(steps("es", model)[1]?.[1]).toBe("Reanudar a partir de la 1:00");
    expect(model.panel?.foot && [say("de", model.panel.foot.text), say("de", model.panel.foot.action.label), model.panel.foot.wide]).toEqual([
      "Passiert das öfter? Größere Tarife haben mehr KI‑Zeichen pro Tag.",
      "Tarife ansehen",
      540,
    ]);
    // The Own key plan has no allowance to upsell.
    expect(hero(stopped, groups, pending, { fixed: false, resumesAt: "2026-11-03T00:00:00.000Z" }, { ownKeyPlan: true }).panel?.foot).toBeNull();
    const back = hero(stopped, groups, pending, { fixed: true });
    expect(lines("de", back)[0]).toBe("success: Das KI‑Kontingent ist wieder da – setze den Auftrag fort.");
    expect(back.lines[0]!.icon).toBe("check-circle");
    expect(steps("de", back).map((s) => [s[0], s[1], s[4]])).toEqual([
      ["resume", "Du kannst jetzt fortsetzen", "primary"],
      ["review", "54 Übersetzungen freigeben", "-"],
    ]);
  });

  it("names an own key's engine, folds its full text and leads to the keys (OWN_KEY_AUTH_DEEPL)", () => {
    const stopped = job({ id: id(41), resourceType: "PAGE", targetLocale: "fr", status: "FAILED", errorCode: "OWN_KEY_AUTH_DEEPL", totalItems: 12, succeededItems: 2, skippedItems: 10 });
    const model = hero(stopped, rowCounts(stopped, outcomesOf({ waiting: 2, cancelled: 10 })), { translations: 6, items: 2 }, { fixed: false }, { ownKeyPlan: true });
    expect(lines("de", model)[0]).toBe("critical: DeepL hat deinen Schlüssel nicht angenommen – er ist abgelaufen, gesperrt oder falsch eingegeben.");
    expect(steps("de", model)).toEqual([
      ["fix", "Schlüssel prüfen", "In den Einstellungen unter „Deine Schlüssel“: erneut prüfen oder ersetzen.", `Zu deinen Schlüsseln → /app/settings?section=keys&job=${id(41)}`, "primary"],
      ["resume", "Auftrag fortsetzen", "Danach übersetzt Linguva die übrigen 10 Seiten. 2 Seiten sind schon fertig und bleiben.", "resume: Auftrag fortsetzen", "-"],
      ["review", "6 Übersetzungen freigeben", "Für 2 Seiten. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.", `Jetzt freigeben → /app/review?job=${id(41)}`, "-"],
    ]);
    expect(steps("en", model)[0]!.slice(1, 4)).toEqual(["Check your key", "In Settings under “Your keys”: check it again or replace it.", `Go to your keys → /app/settings?section=keys&job=${id(41)}`]);
    expect(model.panel?.fold).toEqual({ summary: "jobs.next.whatHappened", code: "OWN_KEY_AUTH_DEEPL" });
    expect(model.panel?.foot).toBeNull();
    const quota = hero({ ...stopped, errorCode: "OWN_KEY_QUOTA_AZURE" }, rowCounts(stopped), NONE, { fixed: false });
    expect(steps("de", quota)[0]!.slice(1, 3)).toEqual(["Dein Microsoft Azure-Konto prüfen", "Erhöhe dort das Kontingent oder füge in den Einstellungen einen anderen Schlüssel hinzu."]);
  });

  it("makes a smart budget's fix optional, a provider's resume a second choice, and resumes a failed discovery or an unknown stop", () => {
    const budget = job({ id: id(42), targetLocale: "de", status: "FAILED", errorCode: "SMART_BUDGET_DAILY", requestedBy: SMART, smartRunId: "run-6", totalItems: 10, succeededItems: 4, skippedItems: 6 });
    const smart = hero(budget, rowCounts(budget, outcomesOf({ cancelled: 6 })), NONE, { fixed: false, nextCheckAt: today("23:00") });
    expect(smart.state).toBe("stoppedWait");
    expect(lines("de", smart)[0]).toBe(
      `warning: Der nächste Abgleich heute um ${clock("de", today("23:00"))} übersetzt den Rest von selbst. Wenn du nicht warten möchtest, erhöhe das Tagesbudget und setze den Auftrag dann fort.`,
    );
    expect(steps("de", smart).map((s) => [s[0], s[1], s[3], s[4]])).toEqual([
      ["fix", "Tagesbudget erhöhen", `Budgets ändern → /app/settings/automatic?job=${id(42)}#smart-budgets`, "-"],
      ["resume", "Auftrag fortsetzen", "resume: Auftrag fortsetzen", "-"],
    ]);
    const provider = hero({ ...J10, errorCode: "PROVIDER_QUOTA" }, rowCounts(J10, R10), NONE, { fixed: null });
    expect(steps("en", provider).map((s) => [s[0], s[1], s[4]])).toEqual([["resume", "You can resume now", "-"]]);
    expect(provider.panel?.fold).toEqual({ summary: "jobs.next.whatHappened", code: "PROVIDER_QUOTA" });
    for (const errorCode of ["DISCOVERY_FAILED", null]) {
      const model = hero({ ...J10, errorCode }, rowCounts(J10, R10), NONE, { fixed: null });
      expect(steps("en", model).map((s) => [s[0], s[1], s[4]]), String(errorCode)).toEqual([["resume", "You can resume now", "primary"]]);
    }
    expect(lines("de", hero({ ...J10, errorCode: null }, rowCounts(J10, R10), NONE, null))[0]).toBe("warning: Der Auftrag wurde unerwartet angehalten. Fortsetzen klappt meistens.");
  });

  it("reopens the app for SHOP_AUTH, leads to the plans for QUOTA_EXCEEDED, and offers nothing for an uninstalled app", () => {
    const auth = hero({ ...J10, errorCode: "SHOP_AUTH" }, rowCounts(J10, R10), NONE, { fixed: null });
    expect(lines("de", auth)[0]).toBe("critical: Shopify hat Linguvas Zugriff abgelehnt. Öffne Linguva neu und setze dann fort.");
    expect(steps("de", auth).map((s) => [s[0], s[1], s[3], s[4]])).toEqual([
      ["fix", "Linguva neu öffnen", "reload: Neu öffnen", "primary"],
      ["resume", "Auftrag fortsetzen", "resume: Auftrag fortsetzen", "-"],
    ]);
    const month = { fixed: false, resumesAt: "2026-12-01T00:00:00.000Z" };
    const quota = hero({ ...J10, errorCode: "QUOTA_EXCEEDED" }, rowCounts(J10, R10), NONE, month);
    expect(lines("de", quota)[0]).toBe("warning: Das KI‑Kontingent für diesen Monat ist aufgebraucht. Mit einem größeren Tarif geht es sofort weiter, sonst ab dem 1. Dezember.");
    expect(steps("de", quota).map((s) => [s[0], s[1], s[3], s[4]])).toEqual([
      ["fix", "Mehr KI‑Zeichen bekommen", `Tarife ansehen → /app/plan?job=${id(10)}`, "primary"],
      ["resume", "Auftrag fortsetzen", "resume: Auftrag fortsetzen", "-"],
    ]);
    // Its fix step is the way to the plans already: no second link in the foot.
    expect(quota.panel?.foot).toBeNull();
    const gone = hero({ ...J10, errorCode: "SHOP_INACTIVE" }, rowCounts(J10, R10), NONE, { fixed: null });
    expect(gone.panel).toBeNull();
    expect(gone.strip).toMatchObject({ kind: "nothing", icon: "done" });
  });

  it("shows a cancelled job: the rest on the language page, or the setting that was turned off", () => {
    const merchant = hero(J05, rowCounts(J05, R05));
    expect(say("de", merchant.title)).toBe("Produkte: 120 von 410 fertig");
    expect(lines("de", merchant)).toEqual(["subdued: Was schon übersetzt ist, bleibt."]);
    expect(steps("de", merchant)).toEqual([
      ["rest", "Den Rest übersetzen?", "Starte einen neuen Auftrag auf der Sprachseite; Fertiges wird nicht noch einmal übersetzt.", "Spanisch ansehen → /app/languages/es", "-"],
    ]);
    expect(steps("de", hero(J05, rowCounts(J05, R05), { translations: 12, items: 12 })).map((s) => [s[0], s[4]])).toEqual([
      ["review", "primary"],
      ["rest", "-"],
    ]);
    const autoOff = hero(J12, rowCounts(J12, R12));
    expect(say("de", autoOff.title)).toBe("Kollektionen: 2 von 5 fertig");
    expect(lines("de", autoOff)).toEqual(["subdued: Abgebrochen, weil die automatische Übersetzung für Deutsch ausgeschaltet wurde. Was schon übersetzt ist, bleibt."]);
    expect(steps("de", autoOff)).toEqual([
      ["autoOff", "Automatische Übersetzung ist aus", "Neue Änderungen werden nicht mehr von selbst übersetzt. In den Einstellungen kannst du sie wieder einschalten.", "Zu den Einstellungen → /app/settings?section=changes", "-"],
    ]);
    expect(autoOff.legend.map((line) => say("de", line.text))).toEqual(["2 übersetzt und live", "3 nicht übersetzt"]);
    const smartOff = job({ id: id(43), status: "CANCELLED", errorCode: "SMART_OFF", requestedBy: SMART, smartRunId: "run-7", totalItems: 8, succeededItems: 3, skippedItems: 5 });
    expect(steps("en", hero(smartOff, rowCounts(smartOff, outcomesOf({ waiting: 3, cancelled: 5 })), { translations: 3, items: 3 })).map((s) => [s[0], s[3], s[4]])).toEqual([
      ["review", `Approve now → /app/review?job=${id(43)}`, "primary"],
      ["smartOff", "View schedule → /app/settings/automatic", "-"],
    ]);
    const uninstalled = hero({ ...J05, errorCode: "SHOP_UNINSTALLED" }, rowCounts(J05, R05));
    expect(lines("de", uninstalled)).toEqual(["subdued: Abgebrochen, weil die App deinstalliert wurde. Was schon übersetzt ist, bleibt."]);
    expect(uninstalled.strip).toMatchObject({ kind: "nothing", icon: "done", action: null });
    // Items still settle after the cancel.
    const cancelling = hero(J05, rowCounts(J05, R05), NONE, null, { settling: true });
    expect(lines("de", cancelling)).toEqual(["subdued: Wird beendet … Wartende Einträge werden gerade abgebrochen."]);
    expect(cancelling.strip).toMatchObject({ kind: "nothing", icon: "active", action: null });
  });
});

describe("problemsHeading and cancelBody", () => {
  it("names the items left for the merchant, or the ones the schedule translates again; nothing without them", () => {
    const running = problemsHeading(J01, outcomeGroups(O01, P01.items, J01))!;
    expect(say("de", running.heading)).toBe("6 Produkte brauchen deine Aufmerksamkeit");
    // While the job runs, how many are fine isn't said yet.
    expect(sayAll("de", running.text)).toBe("Öffne eine Zeile, um sie im Editor fertig zu übersetzen.");
    const smart = job({ requestedBy: SMART, smartRunId: "run-8", totalItems: 31, skippedItems: 31 });
    const self = problemsHeading(smart, outcomeGroups([{ status: "SKIPPED", code: "UP_TO_DATE", count: 30 }, { status: "SKIPPED", code: "SOURCE_CHANGED", count: 1 }], 0, smart))!;
    expect(say("de", self.heading)).toBe("Der Zeitplan übersetzt 1 Produkt neu");
    // The schedule translates it again: its row is there to look at, not to finish.
    expect(self.text.at(-1)).toEqual({ key: "jobs.problems.openSelf" });
    expect(say("en", self.text.at(-1)!)).toBe("Open one to see it in the editor.");
    expect(problemsHeading(J13, rowCounts(J13))).toBeNull();
    // French and Spanish put the subject first.
    expect(say("fr", problemsHeading(J07, outcomeGroups(O07, P07.items, J07))!.heading)).toBe("5 produits demandent votre attention");
    expect(say("es", problemsHeading(J07, outcomeGroups(O07, P07.items, J07))!.heading)).toBe("5 productos necesitan tu atención");
  });

  it("tell what stays and what won't be translated when a job is cancelled, never counting problems as done", () => {
    const groups = outcomeGroups(O01, P01.items, J01);
    expect(sayAll("de", cancelBody(J01, groups))).toBe(
      "206 Produkte sind fertig und bleiben. 128 Produkte sind noch offen und werden nicht mehr übersetzt. Einen abgebrochenen Auftrag kannst du nicht fortsetzen – den Rest kannst du jederzeit neu übersetzen.",
    );
    expect(sayAll("en", cancelBody(J01, groups))).toBe(
      "206 products are done and stay. 128 products are still to do and won't be translated. You can't resume a cancelled job – but you can translate the rest again at any time.",
    );
    // Nothing done yet: only what is left.
    const fresh = rowCounts(job({ status: "RUNNING", totalItems: 40 }));
    expect(sayAll("en", cancelBody(J01, fresh))).toBe("40 products are still to do and won't be translated. You can't resume a cancelled job – but you can translate the rest again at any time.");
    expect(cancelBody(J06, rowCounts({ ...J06, status: "RUNNING" }, R06)).at(-1)).toEqual({ key: "jobs.cancel.final.auto" });
    expect(cancelBody(J02, rowCounts(J02)).at(-1)).toEqual({ key: "jobs.cancel.final.smart" });
  });
});

describe("a job's header, its unnamed items and the wait for the reset", () => {
  it("says when a job started, and when a queued one was created", () => {
    expect(say("de", startedText(J01))).toBe(`Gestartet heute um ${clock("de", today("14:02"))}`);
    expect(say("de", startedText(J03))).toBe(`Erstellt heute um ${clock("de", today("14:08"))}`);
    expect(say("en", startedText(J03))).toBe(`Created today at ${clock("en", today("14:08"))}`);
    expect(say("en", startedText(J10))).toBe(`Started yesterday at ${clock("en", yesterday("22:01"))}`);
  });

  it("names an item Shopify gave no name by its kind and number, else as an item", () => {
    expect(itemName(translator("de"), "PAGE", "4")).toBe("Seite 4");
    expect(itemName(translator("de"), "PRODUCT", "12")).toBe("Produkt 12");
    expect(itemName(translator("en"), "PAGE", "4")).toBe("Page 4");
    // French and Spanish nouns start a name with a capital.
    expect(itemName(translator("fr"), "PRODUCT", "12")).toBe("Produit 12");
    expect(itemName(translator("es"), "COLLECTION", "3")).toBe("Colección 3");
    expect(itemName(translator("de"), "SOMETHING_NEW", "7")).toBe("Eintrag 7");
  });

  it("looks again a few seconds after the reset, then every minute, never longer than a timer can wait", () => {
    const reset = "2026-11-03T00:00:00.000Z";
    const at = Date.parse(reset);
    expect(resumeCheckDelay(reset, at - 60 * 60_000)).toBe(60 * 60_000 + RESUME_CHECK.margin);
    expect(resumeCheckDelay(reset, at)).toBe(RESUME_CHECK.margin);
    expect(resumeCheckDelay(reset, at + RESUME_CHECK.margin)).toBe(RESUME_CHECK.every);
    expect(resumeCheckDelay(reset, at + 10 * 60_000)).toBe(RESUME_CHECK.every);
    expect(resumeCheckDelay("not a date", at)).toBe(RESUME_CHECK.every);
    expect(resumeCheckDelay("2027-12-01T00:00:00.000Z", at)).toBe(RESUME_CHECK.longest);
  });
});

describe("visibleStats", () => {
  const stats = (locale: AppLocale, j: JobFields, ownKeyPlan = false) =>
    visibleStats(j, { now: NOW, ownKeyPlan })?.map((stat) => [stat.icon, say(locale, stat.name), valueText(locale, stat.value), stat.note && say(locale, stat.note)]) ?? null;

  it("shows no strip for a job that sent and saved nothing (queued, finding, nothing to do)", () => {
    expect(stats("de", J03)).toBeNull();
    expect(stats("de", J02)).toBeNull();
    expect(stats("de", J13)).toBeNull();
  });

  it("shows how long a running job has run, its AI characters and what was saved, each with its feature's icon", () => {
    expect(stats("de", J01)).toEqual([
      ["clock", "Läuft seit", "7 Minuten", null],
      ["gauge", "KI‑Zeichen", "96.540", "aus deinem Monatskontingent"],
      ["database", "Gespart", "18.200 Zeichen", "aus früheren Übersetzungen"],
    ]);
  });

  it("calls the time Dauer once the job is over, and the span of the changes for automatic jobs", () => {
    expect(stats("de", J07)![0]).toEqual(["clock", "Dauer", "9 Minuten", null]);
    expect(stats("de", J10)![0]).toEqual(["clock", "Dauer", "13 Minuten", null]);
    expect(stats("de", J12)![0]).toEqual(["clock", "Zeitraum", `${clock("de", yesterday("09:12"))}–${clock("de", yesterday("09:21"))}`, null]);
  });

  it("leaves out a stat whose value is 0, so the others share the row; the Own key plan counts its own characters", () => {
    const ownKey = job({ status: "FAILED", errorCode: "OWN_KEY_AUTH_DEEPL", charsBilled: 3_120, startedAt: today("11:40"), finishedAt: today("11:41") });
    expect(stats("de", ownKey, true)).toEqual([
      ["clock", "Dauer", "1 Minute", null],
      ["gauge", "Zeichen über deine Schlüssel", "3.120", "zahlst du deinem Dienst"],
    ]);
    expect(stats("en", job({ charsSaved: 1, finishedAt: today("14:02") }))).toEqual([
      ["clock", "Duration", "less than a minute", null],
      ["database", "Saved", "1 character", "from earlier translations"],
    ]);
  });
});

describe("attentionVerdict", () => {
  const stopOf = (j: JobFields, outcomes: Partial<RowOutcomeCounts>, facts: AttentionStop["facts"]): AttentionStop => ({ job: j, groups: rowCounts(j, outcomesOf(outcomes)), facts });
  const S10 = stopOf(J10, R10, { fixed: false });
  const NO_FAILED: AttentionInput["failed"] = { count: 0, retryable: 0, jobCount: 0, jobs: [], sameKind: false };
  const input = (extra: Partial<AttentionInput> = {}): AttentionInput => ({ stops: [], stopCount: 0, failed: NO_FAILED, drafts: 0, active: 0, workerDown: false, ...extra });
  const rows = (locale: AppLocale, model: NonNullable<ReturnType<typeof attentionVerdict>>) =>
    model.rows.map((row) => `${row.mark.icon}/${row.mark.tone}: ${say(locale, row.title)} · ${sayAll(locale, row.text)} → ${row.href}`);

  it("leads with a stop that needs the merchant: one fix as the page's primary, then up to two quiet rows", () => {
    const model = attentionVerdict(
      input({ stops: [S10], stopCount: 1, drafts: 826, active: 3, failed: { count: 3, retryable: 1, jobCount: 1, jobs: [J07], sameKind: true } }),
    )!;
    expect(model).toMatchObject({ verdict: "needsYou", mark: { icon: "pause-circle", tone: "critical" }, headAction: null });
    expect(say("de", model.heading)).toBe("1 Auftrag wurde angehalten");
    expect(sayAll("de", model.text)).toBe("Außerdem laufen gerade 3 Aufträge.");
    expect(sayAll("en", model.text)).toBe("Also running: 3 jobs.");
    const featured = model.featured!;
    expect(say("de", featured.title)).toBe("Italienisch · Kollektionen: Übersetzungsdienst nicht erlaubt");
    expect(sayAll("de", featured.text)).toBe(
      `Angehalten gestern um ${clock("de", yesterday("22:14"))}, 9 von 24 sind fertig. Italienisch übersetzt ein Dienst, den dein Shop noch nicht erlaubt hat. Wenn das behoben ist, setzt du den Auftrag mit einem Klick fort.`,
    );
    expect(sayAll("en", featured.text)).toBe(
      `Stopped yesterday at ${clock("en", yesterday("22:14"))}; 9 of 24 are done. Italian is translated by a service your store hasn't allowed yet. Once that's fixed, you resume the job with one click.`,
    );
    expect(featured.primary?.kind === "link" && [say("de", featured.primary.label), featured.primary.href]).toEqual(["In den Einstellungen erlauben", `/app/settings?section=ai&job=${id(10)}`]);
    expect(featured.view).toEqual({ href: `/app/jobs/${id(10)}`, label: { key: "jobs.action.viewJob" }, variant: "tertiary" });
    expect(featured.locale).toBe("it");
    expect(rows("de", model)).toEqual([
      "clock/info: 826 Übersetzungen warten auf deine Freigabe · Kunden sehen sie erst, wenn du sie freigibst. → /app/review",
      // 2 of the 3 failed items only the editor can fix: no "another try usually works".
      `alert-circle/critical: 3 Produkte wurden nicht übersetzt · Im Auftrag Italienisch · Produkte. → /app/jobs/${id(7)}`,
    ]);
    expect(rows("en", model)[1]).toBe(`alert-circle/critical: 3 products weren't translated · In the job Italian · Products. → /app/jobs/${id(7)}`);
  });

  it("features the stop that needs the merchant even when one that can go on is newer, and lists the other", () => {
    const allowance = stopOf(job({ id: id(44), resourceType: "ARTICLE", targetLocale: "es", status: "FAILED", errorCode: "DAILY_LIMIT", totalItems: 64, succeededItems: 18, skippedItems: 46 }), { waiting: 18, cancelled: 46 }, { fixed: true });
    const key = stopOf(job({ id: id(41), resourceType: "PAGE", status: "FAILED", errorCode: "OWN_KEY_AUTH_DEEPL", totalItems: 12, succeededItems: 2, skippedItems: 10, finishedAt: today("11:41") }), { waiting: 2, cancelled: 10 }, { fixed: false });
    const model = attentionVerdict(input({ stops: [allowance, key], stopCount: 2 }))!;
    expect(model.verdict).toBe("needsYou");
    expect(say("de", model.heading)).toBe("2 Aufträge wurden angehalten");
    expect(sayAll("de", model.text)).toBe("Sonst läuft gerade nichts.");
    expect(say("de", model.featured!.title)).toBe("Französisch · Seiten: DeepL hat deinen Schlüssel abgelehnt");
    expect(model.featured!.primary).toMatchObject({ kind: "link", href: `/app/settings?section=keys&job=${id(41)}` });
    expect(rows("de", model)).toEqual([`pause-circle/warning: Spanisch · Blogbeiträge kann weiterlaufen · Das KI‑Kontingent ist wieder da. Öffne den Auftrag und setze ihn fort. → /app/jobs/${id(44)}`]);
  });

  it("shows stops that all go on by themselves in warning; a fixed one resumes with one click, one waiting for a reset can only be viewed", () => {
    const waiting = stopOf(job({ id: id(45), status: "FAILED", errorCode: "DAILY_LIMIT", totalItems: 10, succeededItems: 1, skippedItems: 9 }), { waiting: 1, cancelled: 9 }, { fixed: false, resumesAt: "2026-11-03T00:00:00.000Z" });
    const reset = attentionVerdict(input({ stops: [waiting], stopCount: 1 }))!;
    expect(reset).toMatchObject({ verdict: "waits", mark: { icon: "pause-circle", tone: "warning" } });
    expect(reset.featured!.primary).toBeNull();
    expect(reset.featured!.view.variant).toBe("secondary");
    // No fix: no "once that's fixed".
    expect(sayAll("de", reset.featured!.text)).toBe(`Angehalten heute um ${clock("de", today("14:09"))}, 1 von 10 ist fertig. Das KI‑Kontingent für heute ist aufgebraucht. Ab 01:00 kannst du fortsetzen.`);
    const fixed = attentionVerdict(input({ stops: [{ ...waiting, facts: { fixed: true } }], stopCount: 1, active: 1 }))!;
    expect(fixed.verdict).toBe("waits");
    expect(say("de", fixed.featured!.title)).toBe("Französisch · Produkte kann weiterlaufen");
    expect(sayAll("de", fixed.featured!.text)).toBe("Das KI‑Kontingent ist wieder da. Öffne den Auftrag und setze ihn fort.");
    expect(fixed.featured!.primary).toEqual({ kind: "resume", label: { key: "jobs.detail.resume" }, jobId: id(45) });
    expect(sayAll("de", fixed.text)).toBe("Außerdem läuft gerade 1 Auftrag.");
    expect(sayAll("de", attentionVerdict(input({ stops: [{ ...S10, facts: { fixed: true } }], stopCount: 1 }))!.featured!.text)).toBe("Die Ursache ist behoben. Öffne den Auftrag und setze ihn fort.");
  });

  it("says then resume only for causes with a fix, and reopens the app for SHOP_AUTH", () => {
    for (const group of STOP_GROUPS) {
      if (stopLook(group) === null) continue;
      const stop = stopOf(job({ status: "FAILED", errorCode: CODE_OF[group], totalItems: 2, succeededItems: 1, skippedItems: 1 }), { cancelled: 1 }, { fixed: false });
      const featured = attentionVerdict(input({ stops: [stop], stopCount: 1 }))!.featured!;
      expect(featured.text.some((text) => text.key === "jobs.attention.thenResume"), group).toBe((FIX_GROUPS as readonly string[]).includes(group));
      expect(featured.primary?.kind ?? null, group).toBe(group === "SHOP_AUTH" ? "reload" : STOP_FIX_HREF[group] ? "link" : null);
    }
  });

  it("sums up further stops in one quiet row, keeping at most two rows", () => {
    const more = [S10, stopOf({ ...J10, id: id(46) }, R10, { fixed: false }), stopOf({ ...J10, id: id(47) }, R10, { fixed: true })];
    const model = attentionVerdict(input({ stops: more, stopCount: 5, drafts: 12, failed: { count: 1, retryable: 1, jobCount: 1, jobs: [J07], sameKind: true } }))!;
    expect(model.featured!.jobId).toBe(id(10));
    expect(rows("de", model)).toEqual([
      "pause-circle/critical: 4 weitere angehaltene Aufträge · Du findest sie alle unter „Probleme“. → /app/jobs?status=problems",
      "clock/info: 12 Übersetzungen warten auf deine Freigabe · Kunden sehen sie erst, wenn du sie freigibst. → /app/review",
    ]);
    expect(say("de", model.heading)).toBe("5 Aufträge wurden angehalten");
    // One more: "it", not "them all".
    const two = attentionVerdict(input({ stops: [S10, stopOf({ ...J10, id: id(46) }, R10, { fixed: false })], stopCount: 2 }))!;
    expect(rows("de", two)).toEqual(["pause-circle/critical: 1 weiterer angehaltener Auftrag · Du findest ihn unter „Probleme“. → /app/jobs?status=problems"]);
    expect(rows("en", two)).toEqual(["pause-circle/critical: 1 more stopped job · You'll find it under “Problems”. → /app/jobs?status=problems"]);
  });

  it("names failed items when nothing stopped, promising a new try only when it helps every one", () => {
    const one = attentionVerdict(input({ failed: { count: 2, retryable: 2, jobCount: 1, jobs: [J07], sameKind: true }, active: 0 }))!;
    expect(one).toMatchObject({ verdict: "failed", mark: { icon: "alert-circle", tone: "critical" }, featured: null });
    expect(say("de", one.heading)).toBe("Einiges wurde nicht übersetzt");
    expect(rows("de", one)).toEqual([`alert-circle/critical: 2 Produkte wurden nicht übersetzt · Im Auftrag Italienisch · Produkte. Ein neuer Versuch klappt meistens. → /app/jobs/${id(7)}`]);
    const pages = job({ id: id(48), resourceType: "PAGE", targetLocale: "de" });
    const three = attentionVerdict(input({ failed: { count: 5, retryable: 2, jobCount: 3, jobs: [J07, pages], sameKind: false } }))!;
    expect(rows("de", three)).toEqual(["alert-circle/critical: 5 Einträge wurden nicht übersetzt · In den Aufträgen Italienisch · Produkte, Deutsch · Seiten und 1 weiteren. → /app/jobs?status=problems"]);
    expect(rows("en", three)).toEqual(["alert-circle/critical: 5 items weren't translated · In the jobs Italian · Products, German · Pages, and 1 more. → /app/jobs?status=problems"]);
    const two = attentionVerdict(input({ failed: { count: 2, retryable: 0, jobCount: 2, jobs: [J07, pages], sameKind: false } }))!;
    expect(sayAll("de", two.rows[0]!.text)).toBe("In den Aufträgen Italienisch · Produkte und Deutsch · Seiten.");
  });

  it("warns that translation is delayed while background jobs don't run, and offers review when only drafts wait", () => {
    const delayed = attentionVerdict(input({ workerDown: true, drafts: 3 }))!;
    expect(delayed).toMatchObject({ verdict: "delayed", mark: { icon: "clock", tone: "caution" } });
    expect([say("de", delayed.heading), sayAll("de", delayed.text)]).toEqual([
      "Die Übersetzung startet verzögert",
      "Linguvas Hintergrunddienst läuft gerade nicht. Er startet von selbst neu, dann laufen deine Aufträge von allein los.",
    ]);
    expect(delayed.rows.map((row) => row.href)).toEqual(["/app/review"]);
    const review = attentionVerdict(input({ drafts: 826 }))!;
    expect(review).toMatchObject({ verdict: "review", mark: { icon: "clock", tone: "info" }, featured: null, rows: [] });
    expect([say("de", review.heading), sayAll("de", review.text)]).toEqual(["826 Übersetzungen warten auf deine Freigabe", "Kunden sehen sie erst, wenn du sie freigibst. Sonst braucht dich gerade nichts."]);
    expect(review.headAction).toEqual({ kind: "link", href: "/app/review", label: { key: "language.next.review.action" } });
    expect(say("de", review.headAction!.label)).toBe("Jetzt freigeben");
  });

  it("shows no card when nothing needs the merchant", () => {
    expect(attentionVerdict(input())).toBeNull();
    expect(attentionVerdict(input({ active: 4 }))).toBeNull();
    // An uninstalled app's stop calls for nothing.
    expect(attentionVerdict(input({ stops: [stopOf({ ...J10, errorCode: "SHOP_INACTIVE" }, R10, { fixed: null })], stopCount: 1 }))).toBeNull();
  });
});

describe("the list's address", () => {
  const ID = "7F3A2C10-0000-4000-8000-000000000010";

  it("reads every part of the address, dropping what it doesn't know", () => {
    expect(parseJobsQuery("/app/jobs")).toEqual({ status: "all", lang: null, area: null, type: null, by: null, since: null, q: null, after: null, before: null, page: 1, started: null });
    expect(parseJobsQuery(`/app/jobs?status=problems&lang=it&area=images&by=you&since=7d&q=%20Jacke%20&after=${ID}&p=2&started=3`)).toEqual({
      status: "problems",
      lang: "it",
      area: "images",
      type: null,
      by: "you",
      since: "7d",
      q: "Jacke",
      after: ID.toLowerCase(),
      before: null,
      page: 2,
      started: 3,
    });
    expect(parseJobsQuery("/app/jobs?status=bogus&lang=%3Cscript%3E&area=everything&type=SHOP_POLICY&by=robot&since=1y&q=%20&after=7f3a2c10&p=0&started=x")).toEqual(parseJobsQuery("/app/jobs"));
    // Old links open the problems; `history` is the server's, not a tab.
    expect(parseJobsQuery("/app/jobs?status=failed").status).toBe("problems");
    // The selects' "All …" options submit ALL ("all"): no filter, although "all" reads like a language code.
    expect(parseJobsQuery("/app/jobs?lang=all&area=all&by=all&since=all")).toEqual(parseJobsQuery("/app/jobs"));
    expect(parseJobsQuery("/app/jobs?status=history").status).toBe("all");
    expect(parseJobsQuery(new URLSearchParams({ lang: "pt-BR", type: "MEDIA_IMAGE" }))).toMatchObject({ lang: "pt-BR", type: "MEDIA_IMAGE" });
    expect(parseJobsQuery(new URL("https://example.test/app/jobs?type=LINK&area=navigation"))).toMatchObject({ area: "navigation", type: "LINK" });
    expect(parseJobsQuery(`/app/jobs?q=${"x".repeat(150)}`).q).toHaveLength(100);
    // Both cursors: the page after wins; a number without a cursor is page 1.
    expect(parseJobsQuery(`/app/jobs?after=${ID}&before=${ID}`)).toMatchObject({ after: ID.toLowerCase(), before: null });
    expect(parseJobsQuery(`/app/jobs?before=${ID}&p=3`)).toMatchObject({ before: ID.toLowerCase(), page: 3 });
    expect(parseJobsQuery("/app/jobs?p=4").page).toBe(1);
    expect(parseJobsQuery(`/app/jobs?after=${ID}&p=-2`).page).toBe(1);
  });

  it("builds addresses with only what is set; tabs, filters and the search start on the first page", () => {
    const query = parseJobsQuery(`/app/jobs?status=problems&lang=it&area=images&q=Jacke&after=${ID}&p=2&started=2`);
    expect(jobsHref(query)).toBe("/app/jobs?status=problems&lang=it&area=images&q=Jacke");
    expect(jobsHref(query, { status: "all" })).toBe("/app/jobs?lang=it&area=images&q=Jacke");
    expect(jobsHref(query, { lang: "de" })).toBe("/app/jobs?status=problems&lang=de&area=images&q=Jacke");
    // The pager: the next or the previous page, with its number.
    expect(jobsHref(query, { after: "a1", page: 3 })).toBe("/app/jobs?status=problems&lang=it&area=images&q=Jacke&after=a1&p=3");
    expect(jobsHref(query, { before: "b1", page: 1 })).toBe("/app/jobs?status=problems&lang=it&area=images&q=Jacke&before=b1");
    // "Filter löschen": filters and search go, the tab stays; the dialog's reset keeps the search.
    expect(jobsHref(query, { lang: null, area: null, type: null, by: null, since: null, q: null })).toBe("/app/jobs?status=problems");
    expect(jobsHref(query, { lang: null, area: null, by: null, since: null })).toBe("/app/jobs?status=problems&q=Jacke");
    // An area replaces a legacy type; a type alone stays.
    const legacy = parseJobsQuery("/app/jobs?type=LINK");
    expect(jobsHref(legacy, { status: "completed" })).toBe("/app/jobs?status=completed&type=LINK");
    expect(jobsHref(legacy, { area: "blog" })).toBe("/app/jobs?area=blog");
    expect(jobsHref(legacy, { area: null })).toBe("/app/jobs");
    // What the address says comes back the same.
    const full = `/app/jobs?status=problems&lang=it&area=images&by=you&since=7d&q=Jacke&after=${ID.toLowerCase()}&p=2`;
    const parsed = parseJobsQuery(full);
    expect(jobsHref(parsed, { after: parsed.after, page: parsed.page })).toBe(full);
  });

  it("applies a select's choice at once: its value by the address's own rules, from the first page", () => {
    const query = parseJobsQuery(`/app/jobs?status=problems&type=LINK&q=Jacke&after=${ID}&p=2`);
    expect(filterHref(query, "lang", "fr")).toBe("/app/jobs?status=problems&lang=fr&type=LINK&q=Jacke");
    // An area replaces the legacy type; "All …" (ALL) and an unknown value set no filter.
    expect(filterHref(query, "area", "navigation")).toBe("/app/jobs?status=problems&area=navigation&q=Jacke");
    expect(filterHref(query, "area", "all")).toBe("/app/jobs?status=problems&q=Jacke");
    expect(filterHref(parseJobsQuery("/app/jobs?lang=fr"), "lang", "all")).toBe("/app/jobs");
    expect(filterHref(query, "by", "robot")).toBe("/app/jobs?status=problems&type=LINK&q=Jacke");
    expect(filterHref(query, "by", "smart")).toBe("/app/jobs?status=problems&type=LINK&by=smart&q=Jacke");
    expect(filterHref(query, "since", "7d")).toBe("/app/jobs?status=problems&type=LINK&since=7d&q=Jacke");
    expect([...JOB_FILTERS]).toEqual(["lang", "area", "by", "since"]);
    // "Filter zurücksetzen": the tab's first page, without filters or the search.
    expect(clearedHref(parseJobsQuery(`/app/jobs?status=completed&lang=fr&area=pages&by=you&since=today&q=Jacke&after=${ID}&p=3`))).toBe("/app/jobs?status=completed");
    expect(clearedHref(parseJobsQuery("/app/jobs?lang=fr"))).toBe("/app/jobs");
  });

  it("counts the filters set and hands them to the server", () => {
    expect(filterCount(parseJobsQuery("/app/jobs?lang=it&type=LINK&by=auto&q=x"))).toBe(3);
    expect(filterCount(parseJobsQuery("/app/jobs?status=active&q=x"))).toBe(0);
    expect(jobsFilter(parseJobsQuery("/app/jobs?lang=it&area=navigation&since=today"))).toEqual({ locale: "it", types: ["MENU", "LINK", "FILTER"], origin: null, since: "today" });
    expect(jobsFilter(parseJobsQuery("/app/jobs?type=MEDIA_IMAGE&by=smart"))).toEqual({ locale: null, types: ["MEDIA_IMAGE"], origin: "smart", since: null });
    expect(jobsFilter(parseJobsQuery("/app/jobs")).types).toBeNull();
  });

  it("knows the server's job types, starters, periods and statuses", () => {
    expect([...JOB_TYPES].sort()).toEqual([...SUPPORTED_BULK_RESOURCE_TYPES, "MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE", "PRODUCT_METAFIELD", "COLLECTION_METAFIELD", "PAGE_METAFIELD", "ARTICLE_METAFIELD"].sort());
    for (const type of [...JOB_TYPES, "SHOP_POLICY", "ONLINE_STORE_THEME", "EMAIL_TEMPLATE", "SOMETHING_NEW"]) expect(JOB_TYPES.includes(type), type).toBe(isJobResourceType(type));
    expect([...JOB_BY]).toEqual([...JOB_ORIGINS]);
    expect([...JOB_PERIODS]).toEqual([...JOB_SINCE]);
    for (const tab of JOB_TABS) expect(JOB_LIST_STATUSES, tab).toContain(tab);
  });
});

describe("plural texts, both forms in English and German", () => {
  const t = (locale: AppLocale, key: MessageKey, vars: MessageVars) => translator(locale).t(key, vars);
  const stoppedJob = job({ id: id(10), resourceType: "COLLECTION", targetLocale: "it", status: "FAILED", errorCode: "ENGINE_CONSENT" });
  const resume = (locale: AppLocale, open: number, done: number) => {
    const j = { ...stoppedJob, totalItems: open + done, succeededItems: done, skippedItems: open };
    const step = heroModel(j, rowCounts(j, outcomesOf({ cancelled: open })), { translations: 0, items: 0 }, { fixed: true }).panel!.steps.find((s) => s.id === "resume")!;
    return sayAll(locale, step.text);
  };

  it("jobs.next.resume.open and .done", () => {
    expect(resume("de", 1, 23)).toBe("Danach übersetzt Linguva den Rest (1 Kollektion). 23 Kollektionen sind schon fertig und bleiben.");
    expect(resume("de", 15, 1)).toBe("Danach übersetzt Linguva die übrigen 15 Kollektionen. 1 Kollektion ist schon fertig und bleibt.");
    expect(resume("de", 15, 9)).toBe("Danach übersetzt Linguva die übrigen 15 Kollektionen. 9 Kollektionen sind schon fertig und bleiben.");
    expect(resume("en", 1, 23)).toBe("Linguva then translates the last one (1 collection). 23 collections are already done and stay.");
    expect(resume("en", 15, 1)).toBe("Linguva then translates the other 15 collections. 1 collection is already done and stays.");
    // Nothing done yet: the second sentence is left out.
    expect(resume("de", 24, 0)).toBe("Danach übersetzt Linguva die übrigen 24 Kollektionen.");
  });

  it("jobs.attention.stopText, .others and .failedIn", () => {
    expect(t("de", "jobs.attention.stopText", { count: 1, when: "gestern um 22:14", done: 1, total: 24 })).toBe("Angehalten gestern um 22:14, 1 von 24 ist fertig.");
    expect(t("de", "jobs.attention.stopText", { count: 9, when: "gestern um 22:14", done: 9, total: 24 })).toBe("Angehalten gestern um 22:14, 9 von 24 sind fertig.");
    expect(t("en", "jobs.attention.stopText", { count: 1, when: "yesterday at 10:14 PM", done: 1, total: 24 })).toBe("Stopped yesterday at 10:14 PM; 1 of 24 is done.");
    expect(t("en", "jobs.attention.stopText", { count: 9, when: "yesterday at 10:14 PM", done: 9, total: 24 })).toBe("Stopped yesterday at 10:14 PM; 9 of 24 are done.");
    const others = (locale: AppLocale, active: number) => sayAll(locale, attentionVerdict({ stops: [{ job: J10, groups: rowCounts(J10, R10), facts: { fixed: false } }], stopCount: 1, failed: { count: 0, retryable: 0, jobCount: 0, jobs: [], sameKind: false }, drafts: 0, active, workerDown: false })!.text);
    expect([others("de", 1), others("de", 3), others("en", 1), others("en", 3)]).toEqual(["Außerdem läuft gerade 1 Auftrag.", "Außerdem laufen gerade 3 Aufträge.", "Also running: 1 job.", "Also running: 3 jobs."]);
    expect([t("de", "jobs.attention.failedIn", { count: 1, jobs: "A" }), t("de", "jobs.attention.failedIn", { count: 3, jobs: "A, B und 1 weiteren" })]).toEqual(["Im Auftrag A.", "In den Aufträgen A, B und 1 weiteren."]);
    expect([t("en", "jobs.attention.failedIn", { count: 1, jobs: "A" }), t("en", "jobs.attention.failedIn", { count: 3, jobs: "A, B, and 1 more" })]).toEqual(["In the job A.", "In the jobs A, B, and 1 more."]);
  });

  it("jobs.next.review.detail, jobs.next.retry.title, jobs.problems.rest", () => {
    const detail = (locale: AppLocale, translations: number, items: number) => say(locale, { key: "jobs.next.review.detail", vars: { count: translations, items: { items, type: "PRODUCT" } } });
    expect(detail("de", 1, 1)).toBe("Für 1 Produkt. Die KI hat sie schon geschrieben – Kunden sehen sie erst nach deiner Freigabe.");
    expect(detail("en", 1, 1)).toBe("For 1 product. The AI has already written it – customers see it once you approve it.");
    expect(detail("en", 452, 176)).toBe("For 176 products. The AI has already written them – customers see them once you approve them.");
    const retry = (locale: AppLocale, count: number) => say(locale, { key: "jobs.next.retry.title", vars: { count, items: { items: count, type: "PRODUCT" } } });
    expect([retry("de", 1), retry("de", 4), retry("en", 1), retry("en", 4)]).toEqual(["1 Produkt noch einmal versuchen", "4 Produkte noch einmal versuchen", "Try 1 product again", "Try 4 products again"]);
    expect([t("de", "jobs.problems.rest", { count: 1, ok: 1, total: 89 }), t("de", "jobs.problems.rest", { count: 83, ok: 83, total: 89 })]).toEqual(["1 von 89 ist in Ordnung.", "83 von 89 sind in Ordnung."]);
    expect([t("en", "jobs.problems.rest", { count: 1, ok: 1, total: 89 }), t("en", "jobs.problems.rest", { count: 83, ok: 83, total: 89 })]).toEqual(["1 of 89 is fine.", "83 of 89 are fine."]);
  });

  it("jobs.cancel.done and .rest, jobs.cluster.count", () => {
    const body = (locale: AppLocale, ok: number, open: number) => {
      const j = job({ status: "RUNNING", totalItems: ok + open, succeededItems: ok });
      return sayAll(locale, cancelBody(j, rowCounts(j)).slice(0, 2));
    };
    expect(body("de", 1, 1)).toBe("1 Produkt ist fertig und bleibt. 1 Produkt ist noch offen und wird nicht mehr übersetzt.");
    expect(body("de", 206, 128)).toBe("206 Produkte sind fertig und bleiben. 128 Produkte sind noch offen und werden nicht mehr übersetzt.");
    expect(body("en", 1, 1)).toBe("1 product is done and stays. 1 product is still to do and won't be translated.");
    expect(body("en", 206, 128)).toBe("206 products are done and stay. 128 products are still to do and won't be translated.");
    expect([t("en", "jobs.cluster.count", { count: 1 }), t("en", "jobs.cluster.count", { count: 1200 })]).toEqual(["1 job", "1,200 jobs"]);
    expect([t("de", "jobs.cluster.count", { count: 1 }), t("de", "jobs.cluster.count", { count: 1200 })]).toEqual(["1 Auftrag", "1.200 Aufträge"]);
  });
});

describe("itemOutcome", () => {
  it("says an item that waits or runs again will be retried, not what its last try failed with", () => {
    const de = translator("de");
    const en = translator("en");
    expect(itemOutcome(en, "PENDING", "PROVIDER_UNAVAILABLE")).toBe("Waiting (will be retried)");
    expect(itemOutcome(de, "PENDING", "SHOPIFY_UNAVAILABLE")).toBe("Wartet (wird wiederholt)");
    expect(itemOutcome(en, "RUNNING", "UNEXPECTED_ERROR")).toBe("Being translated");
    expect(itemOutcome(en, "PENDING", null)).toBe("Waiting");
    // A failure keeps its reason.
    expect(itemOutcome(en, "DEAD", "PROVIDER_UNAVAILABLE")).toBe("The translation service was unavailable.");
    expect(itemOutcome(en, "FAILED", "PROVIDER_REJECTED")).toBe("The translation service rejected this content.");
  });

  it("says a stopped job's items were not translated because it stopped, leaving the cause to its page", () => {
    const en = translator("en");
    for (const code of ["ENGINE_CONSENT", "DAILY_LIMIT", "QUOTA_EXCEEDED", "OWN_KEY_AUTH_DEEPL", "PROVIDER_AUTH", "SHOP_INACTIVE"]) expect(itemOutcome(en, "CANCELLED", code), code).toBe("Not translated: the job stopped");
    expect(itemOutcome(translator("de"), "CANCELLED", "ENGINE_CONSENT")).toBe("Nicht übersetzt: Der Auftrag wurde angehalten");
    // Cancels keep their own words.
    expect(itemOutcome(en, "CANCELLED", "JOB_CANCELLED")).toBe("Not translated: the job was cancelled");
    expect(itemOutcome(en, "CANCELLED", "AUTO_OFF")).toBe("Not translated: automatic translation was turned off for this language");
    expect(itemOutcome(en, "CANCELLED", "SHOP_UNINSTALLED")).toBe("The app was uninstalled.");
  });
});
