/**
 * Smart Auto-Translate (Business) against PostgreSQL: settings with a
 * version, turning it on and off, the scheduler's one run per occurrence
 * (also with several ticks at once), catch-up after an outage, daylight
 * saving, pauses and what lifts them, Check now, the per-item checks and
 * budgets, real-time routing, and uninstall.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { createAutoItems, queueAutoTranslate, type AutoQueue } from "../../app/.server/jobs/auto-translate";
import { sweepChangedContent } from "../../app/.server/jobs/auto-sweep";
import { retryJobItems } from "../../app/.server/jobs/bulk-jobs";
import { classifyError } from "../../app/.server/jobs/errors";
import { processItem, type JobDependencies } from "../../app/.server/jobs/processors";
import { currentShopLocales, forgetCurrentLocales } from "../../app/.server/locales/current-locales";
import { storeMemory } from "../../app/.server/memory/translation-memory";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { getShopSettings, setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { addSmartExclusion, getSmartConfig, isSmartExcluded, pauseSmart, resumeSmart, saveSmartSettings, setSmartEnabled, smartPauseAfterStop } from "../../app/.server/smart/config";
import { loadSmartCoverageNote } from "../../app/.server/smart/panel";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import { requestSmartRun, retrySmartRun, smartTick, type SmartDeps } from "../../app/.server/smart/runs";
import { normaliseSmartSettings, type SmartSettingsValue } from "../../app/.server/smart/validate";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { getOriginUsageSince } from "../../app/.server/usage/usage-ledger";
import { PLANS, type Entitlements } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(async () => {
  await resetDatabase();
  forgetCurrentLocales();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const daily = (over: Partial<SmartSettingsValue> = {}): SmartSettingsValue => ({
  mode: "daily",
  timeZone: "Europe/Berlin",
  times: [23 * 60],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  locales: ["de"],
  resourceTypes: ["PRODUCT", "COLLECTION"],
  fieldGroups: [],
  includeAttached: false,
  publishMode: "DRAFT",
  replaceOutdatedMachine: true,
  dailyBudget: null,
  monthlyBudget: null,
  ...over,
});

async function setup(plan: Entitlements = PLANS.business) {
  const { shop } = await upsertInstalledShop({ shopDomain: "smart.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(2);
  const pages: unknown[] = [];
  let entitlements = plan;
  const deps: SmartDeps = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    billingFor: async () => ({ configured: true, entitlements }),
    aiAvailable: true,
    enqueueCoveragePage: async (payload) => void pages.push(payload),
  };
  const setPlan = (next: Entitlements) => (entitlements = next);
  return { shop, store, deps, pages, setPlan };
}

async function enabled(shopId: string, value = daily(), now = new Date()) {
  const saved = await saveSmartSettings({ shopId, actorId: "7", value, version: 0, primaryLocale: "en", now }, app);
  expect(saved).not.toBeNull();
  const on = await setSmartEnabled({ shopId, actorId: "7", enabled: true, now }, app);
  expect(on.ok).toBe(true);
  return getSmartConfig(shopId, app);
}

const runs = (shopId: string) => withTenant(shopId, (tx) => tx.smartAutoRun.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } }), app);
const hint = async (shopId: string) => (await app.shop.findUniqueOrThrow({ where: { id: shopId } })).smartNextRunAt;

describe("settings", () => {
  it("are saved with a version: a form opened before someone saved is refused", async () => {
    const { shop } = await setup();
    const first = await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily(), version: 0, primaryLocale: "en" }, app);
    expect(first).toMatchObject({ version: 1, mode: "daily", times: [1380], enabled: false, nextRunAt: null });
    expect(await saveSmartSettings({ shopId: shop.id, actorId: "8", value: daily({ times: [60] }), version: 0, primaryLocale: "en" }, app)).toBeNull();
    expect((await getSmartConfig(shop.id, app))!.times).toEqual([1380]);
    expect(await saveSmartSettings({ shopId: shop.id, actorId: "8", value: daily({ times: [60] }), version: 1, primaryLocale: "en" }, app)).toMatchObject({ version: 2, times: [60] });
  });

  it("are refused by the database when a forged value gets past the form", async () => {
    const { shop } = await setup();
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily(), version: 0, primaryLocale: "en" }, app);
    for (const data of [{ mode: "hourly" }, { timeZone: "+05:30" }, { times: [2000] }, { weekdays: [8] }, { locales: ["DE;drop"] }, { dailyBudget: 0 }, { pauseReason: "x y" }]) {
      await expect(withTenant(shop.id, (tx) => tx.smartAutoConfig.update({ where: { shopId: shop.id }, data }), app)).rejects.toThrow(/check constraint/i);
    }
  });

  it("turn on only once saved; turning on turns basic automatic translation off, turning off clears the schedule", async () => {
    const { shop } = await setup();
    expect(await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: true }, app)).toEqual({ ok: false, problem: "NOT_CONFIGURED" });
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
    const now = new Date("2026-10-29T12:00:00Z");
    const config = await enabled(shop.id, daily(), now);
    expect(config).toMatchObject({ enabled: true, nextRunAt: new Date("2026-10-29T22:00:00Z") });
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T22:00:00Z"));
    expect((await getShopSettings(shop.id, app)).autoTranslateNew).toBe(false);
    await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: false }, app);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ enabled: false, nextRunAt: null });
    expect(await hint(shop.id)).toBeNull();
  });

  it("validated on the server: the plan's languages only, and automatic publishing only when confirmed", () => {
    const context = { targets: ["de", "fr", "es"], allowed: ["de", "fr"], shopTimeZone: null, entitlements: PLANS.business, currentPublishMode: "DRAFT" as const };
    const form = { mode: "daily", timeZone: "UTC", times: ["03:00"], weekdays: [], locales: ["de,es"], resourceTypes: ["PRODUCT"], fieldGroups: "all" as const, includeAttached: false, publishMode: "DRAFT", confirmPublish: false, replaceOutdatedMachine: true, dailyBudget: "", monthlyBudget: "" };
    expect(normaliseSmartSettings(form, context)).toEqual({ ok: false, problem: "PLAN_LANGUAGE" });
    expect(normaliseSmartSettings({ ...form, locales: ["de"], publishMode: "AUTO_PUBLISH" }, context)).toEqual({ ok: false, problem: "CONFIRMATION_REQUIRED" });
  });
});

describe("the scheduler", () => {
  it("creates one run per occurrence however many ticks run at once, and moves on to the next one", async () => {
    const { shop, deps, pages } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    const due = new Date("2026-10-29T22:00:30Z");
    const results = await Promise.all(Array.from({ length: 5 }, () => smartTick(deps, due)));
    expect(results.reduce((n, r) => n + r.started, 0)).toBe(1);
    const [run, ...more] = await runs(shop.id);
    expect(more).toHaveLength(0);
    expect(run).toMatchObject({ trigger: "SCHEDULED", occurrenceAt: new Date("2026-10-29T22:00:00Z"), status: "RUNNING", locales: ["de"] });
    expect(pages).toHaveLength(1);
    // The run's measurement covers every additional language, so the figures stay complete.
    const report = await withTenant(shop.id, (tx) => tx.coverageReport.findFirstOrThrow({ where: { shopId: shop.id } }), app);
    expect(report).toMatchObject({ smartRunId: run!.id, requestedBy: SMART_REQUESTED_BY });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ nextRunAt: new Date("2026-10-30T22:00:00Z") });
    // The tick may look again a minute later (in case the start hadn't got through), then waits for the next check.
    await smartTick(deps, new Date("2026-10-29T22:01:30Z"));
    expect(await runs(shop.id)).toHaveLength(1);
    expect(await hint(shop.id)).toEqual(new Date("2026-10-30T22:00:00Z"));
  });

  it("tries a run whose start didn't get through again a minute later, not at the next check", async () => {
    const { shop, deps, pages } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    // The measurement can't be created just then (a database timeout after the run's commit).
    let failing = true;
    const flaky = new Proxy(app, {
      get(target, prop, receiver) {
        if (prop === "$transaction" && failing && new Error().stack?.includes("createCoverageReport")) return () => Promise.reject(new Error("timeout"));
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(await smartTick({ ...deps, prisma: flaky }, new Date("2026-10-29T22:00:30Z"))).toMatchObject({ failed: 1 });
    failing = false;
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["QUEUED"]);
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T22:01:30Z"));
    // createdAt comes from the database clock: put it just before the simulated tick (the run must be more
    // than a minute old), so the test holds on any day. Under the tenant: FORCE RLS applies to the owner too.
    await withTenant(shop.id, (tx) => tx.smartAutoRun.updateMany({ where: { shopId: shop.id }, data: { createdAt: new Date("2026-10-29T22:00:29Z") } }), app);
    await smartTick(deps, new Date("2026-10-29T22:01:30Z"));
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["RUNNING"]);
    expect(pages).toHaveLength(1);
  });

  it("after an outage runs one catch-up check, then goes on from now", async () => {
    const { shop, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-25T12:00:00Z"));
    await smartTick(deps, new Date("2026-10-29T12:00:00Z"));
    const all = await runs(shop.id);
    expect(all).toHaveLength(1);
    // 23:00 in Berlin on the day the clocks went back (winter time).
    expect(all[0]!.occurrenceAt).toEqual(new Date("2026-10-25T22:00:00Z"));
    expect((await getSmartConfig(shop.id, app))!.nextRunAt).toEqual(new Date("2026-10-29T22:00:00Z"));
  });

  it("keeps the local time across the change to winter time", async () => {
    const { shop, deps } = await setup();
    // 02:30 in Berlin exists twice on 25 October 2026: the first one counts, then 02:30 winter time.
    await enabled(shop.id, daily({ times: [150] }), new Date("2026-10-24T12:00:00Z"));
    expect((await getSmartConfig(shop.id, app))!.nextRunAt).toEqual(new Date("2026-10-25T00:30:00Z"));
    await smartTick(deps, new Date("2026-10-25T00:31:00Z"));
    expect((await getSmartConfig(shop.id, app))!.nextRunAt).toEqual(new Date("2026-10-26T01:30:00Z"));
  });

  it("records skipped checks while paused, and a budget pause lifts by itself", async () => {
    const { shop, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    expect(await smartPauseAfterStop(shop.id, "SMART_BUDGET_DAILY", new Date("2026-10-29T21:00:00Z"), app)).toBe("BUDGET_DAILY");
    const paused = (await getSmartConfig(shop.id, app))!;
    // Lifts at local midnight (Berlin, winter time).
    expect(paused.pausedUntil).toEqual(new Date("2026-10-29T23:00:00Z"));
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    expect((await runs(shop.id)).map((r) => [r.status, r.errorCode])).toEqual([["SKIPPED", "PAUSED"]]);
    await smartTick(deps, new Date("2026-10-30T22:00:30Z"));
    expect((await getSmartConfig(shop.id, app))!.pausedAt).toBeNull();
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["SKIPPED", "RUNNING"]);
  });

  it("pauses on a plan without the smart schedule, and continues when the plan includes it again", async () => {
    const { shop, deps, setPlan } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    setPlan(PLANS.pro);
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "PLAN" });
    expect((await runs(shop.id)).map((r) => [r.status, r.errorCode])).toEqual([["SKIPPED", "PAUSED"]]);
    setPlan(PLANS.business);
    await smartTick(deps, new Date("2026-10-30T22:00:30Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
    expect((await runs(shop.id)).at(-1)!.status).toBe("RUNNING");
  });

  it("pauses when the store's main language changed, and continues once the languages are saved again", async () => {
    const { shop, store, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    store.locales = [
      { locale: "de", name: "German", primary: true, published: true },
      { locale: "en", name: "English", primary: false, published: true },
    ];
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "PRIMARY_LANGUAGE", enabled: true });
    // Nothing was translated or deleted.
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["SKIPPED"]);
    const config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ locales: ["en"] }), version: config.version, primaryLocale: "de" }, app);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, primaryLocale: "de", locales: ["en"] });
  });

  it("doesn't pause again from a copy of the languages read before the merchant saved them for the new main language", async () => {
    const { shop, store, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    // The worker read the languages (English main) a moment before the switch in Shopify.
    await currentShopLocales(shop.id, async () => store.asAdmin(), app);
    store.locales = [
      { locale: "de", name: "German", primary: true, published: true },
      { locale: "en", name: "English", primary: false, published: true },
    ];
    const config = (await getSmartConfig(shop.id, app))!;
    // At the simulated time, so the next check is the 23:00 one on any day.
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ locales: ["en"] }), version: config.version, primaryLocale: "de", now: new Date("2026-10-29T12:00:00Z") }, app);
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["RUNNING"]);
  });

  it("pauses at the monthly budget until the 1st in its time zone, and for an hour when the provider stops", async () => {
    const { shop } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    expect(await smartPauseAfterStop(shop.id, "PROVIDER_QUOTA", new Date("2026-10-29T21:00:00Z"), app)).toBe("PROVIDER");
    expect((await getSmartConfig(shop.id, app))!.pausedUntil).toEqual(new Date("2026-10-29T22:00:00Z"));
    expect(await smartPauseAfterStop(shop.id, "SMART_BUDGET_MONTHLY", new Date("2026-10-29T21:00:00Z"), app)).toBe("BUDGET_MONTHLY");
    // Midnight starting 1 November in Berlin (winter time).
    expect((await getSmartConfig(shop.id, app))!.pausedUntil).toEqual(new Date("2026-10-31T23:00:00Z"));
    // A shorter stop doesn't shorten it.
    expect(await smartPauseAfterStop(shop.id, "SMART_BUDGET_DAILY", new Date("2026-10-29T21:30:00Z"), app)).toBeNull();
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "BUDGET_MONTHLY" });
  });

  it("pauses and resumes by the merchant's choice", async () => {
    const { shop } = await setup();
    await enabled(shop.id);
    expect(await pauseSmart({ shopId: shop.id, actorId: "7" }, app)).toBe(true);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "MANUAL", pausedUntil: null });
    await resumeSmart({ shopId: shop.id, actorId: "7" }, app);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
  });

  it("keeps the merchant's own pause while the plan, consent or main language change and change back", async () => {
    const { shop, store, deps, pages, setPlan } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    const day = (n: number) => new Date(Date.UTC(2026, 9, 29 + n, 22, 0, 30));
    const swapPrimary = (primary: string) => {
      store.locales = ["en", "de"].map((locale) => ({ locale, name: locale, primary: locale === primary, published: true }));
      forgetCurrentLocales();
    };

    setPlan(PLANS.pro);
    await smartTick(deps, day(0));
    setPlan(PLANS.business);
    await setAiConsent({ shopId: shop.id, granted: false, actorId: "7" }, app);
    await smartTick(deps, day(1));
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "7" }, app);
    swapPrimary("de");
    await smartTick(deps, day(2));
    // The merchant reviews the languages: saving them must not resume either.
    const config = (await getSmartConfig(shop.id, app))!;
    expect(config).toMatchObject({ pauseReason: "MANUAL", pausedUntil: null });
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ locales: ["en"] }), version: config.version, primaryLocale: "de", now: day(2) }, app);
    await smartTick(deps, day(3));

    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "MANUAL", pausedUntil: null });
    expect((await runs(shop.id)).map((r) => [r.status, r.errorCode])).toEqual(Array.from({ length: 4 }, () => ["SKIPPED", "PAUSED"]));
    expect(pages).toHaveLength(0);
    // Resuming is the merchant's: the main language changed meanwhile, so it pauses for that instead.
    swapPrimary("en");
    await resumeSmart({ shopId: shop.id, actorId: "7", now: day(3) }, app);
    await smartTick(deps, day(4));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "PRIMARY_LANGUAGE" });
    expect(pages).toHaveLength(0);
  });
});

describe("Check now", () => {
  it("starts one run per click, none while one is active, and not again within a few minutes", async () => {
    const { shop, deps, pages } = await setup();
    await enabled(shop.id);
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7" };
    const first = await requestSmartRun(deps, { ...input, idempotencyKey: "click-0001" });
    expect(first.status).toBe("started");
    expect(await requestSmartRun(deps, { ...input, idempotencyKey: "click-0001" })).toEqual({ status: "active", runId: first.runId });
    expect(await requestSmartRun(deps, { ...input, idempotencyKey: "click-0002" })).toEqual({ status: "active", runId: first.runId });
    await withTenant(shop.id, (tx) => tx.smartAutoRun.update({ where: { id: first.runId! }, data: { status: "COMPLETED" } }), app);
    expect(await requestSmartRun(deps, { ...input, idempotencyKey: "click-0003" })).toEqual({ status: "cooldown" });
    expect(pages).toHaveLength(1);
    expect(await requestSmartRun(deps, { ...input, idempotencyKey: "bad key!" })).toMatchObject({ status: "blocked" });
  });

  it("is started by the tick when its own start didn't get through, also without a schedule", async () => {
    const { shop, deps, pages } = await setup();
    await enabled(shop.id, daily({ mode: "manual", times: [], weekdays: [] }));
    expect(await hint(shop.id)).toBeNull();
    // The request fails after the run's commit (here: its audit entry).
    const failing = new Proxy(app, {
      get: (target, prop, receiver) => (prop === "auditLog" ? { createMany: () => Promise.reject(new Error("connection reset")) } : Reflect.get(target, prop, receiver)),
    });
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7" };
    await expect(requestSmartRun({ ...deps, prisma: failing }, { ...input, idempotencyKey: "click-0001" })).rejects.toThrow("connection reset");
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["QUEUED"]);
    const soon = (await hint(shop.id))!;
    expect(soon.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    // The tick finds it (after the minute its request had to start it), starts it, and goes back to no schedule.
    await smartTick(deps, new Date(Date.now() + 2 * 60_000));
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["RUNNING"]);
    expect(pages).toHaveLength(1);
    await smartTick(deps, new Date(Date.now() + 4 * 60_000));
    expect(await hint(shop.id)).toBeNull();
  });

  it("refuses while turned off, without AI translation or on a plan without the smart schedule", async () => {
    const { shop, deps, setPlan } = await setup();
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7", idempotencyKey: "click-0001" };
    expect(await requestSmartRun(deps, input)).toEqual({ status: "off" });
    await enabled(shop.id);
    expect(await requestSmartRun({ ...deps, aiAvailable: false }, input)).toMatchObject({ status: "blocked", reason: "AI_NOT_CONFIGURED" });
    setPlan(PLANS.pro);
    expect(await requestSmartRun(deps, input)).toMatchObject({ status: "blocked", reason: "PLAN" });
    expect(await runs(shop.id)).toHaveLength(0);
  });

  it("lifts a pause for consent once consent is back, and pauses with a recheck when it is missing", async () => {
    const { shop, deps } = await setup();
    const manual = daily({ mode: "manual", times: [], weekdays: [] });
    const t0 = new Date();
    await enabled(shop.id, manual, t0);
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7", now: t0 };
    expect(await smartPauseAfterStop(shop.id, "CONSENT_REQUIRED", t0, app)).toBe("CONSENT");
    // Consent is given (since the setup): Check now lifts the pause and starts.
    expect((await requestSmartRun(deps, { ...input, idempotencyKey: "click-0001" })).status).toBe("started");
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
    await withTenant(shop.id, (tx) => tx.smartAutoRun.updateMany({ where: { shopId: shop.id }, data: { status: "COMPLETED" } }), app);
    await setAiConsent({ shopId: shop.id, granted: false, actorId: null }, app);
    const later = new Date(t0.getTime() + 10 * 60_000);
    expect(await requestSmartRun(deps, { ...input, now: later, idempotencyKey: "click-0002" })).toMatchObject({ status: "blocked", reason: "CONSENT" });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "CONSENT" });
    // Also without a schedule, the tick looks again in 15 minutes.
    expect(await hint(shop.id)).toEqual(new Date(later.getTime() + 15 * 60_000));
  });

  it("a scheduled check while it runs is recorded as coalesced, not run twice", async () => {
    const { shop, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7", idempotencyKey: "click-0100" };
    expect((await requestSmartRun(deps, input)).status).toBe("started");
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    expect((await runs(shop.id)).map((r) => [r.trigger, r.status, r.errorCode])).toEqual([
      ["MANUAL", "RUNNING", null],
      ["SCHEDULED", "SKIPPED", "COALESCED"],
    ]);
  });
});

describe("when the tick looks again", () => {
  const manual = () => daily({ mode: "manual", times: [], weekdays: [] });

  it("a pause for consent or the plan from a stopped job is looked at again in 15 minutes, also without a schedule", async () => {
    const { shop, deps, setPlan } = await setup();
    const t0 = new Date("2026-10-29T12:00:00Z");
    await enabled(shop.id, manual(), t0);
    expect(await hint(shop.id)).toBeNull();
    expect(await smartPauseAfterStop(shop.id, "CONSENT_REQUIRED", t0, app)).toBe("CONSENT");
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T12:15:00Z"));
    // Consent is given: the tick lifts the pause, and without a schedule there is nothing more to look at.
    await smartTick(deps, new Date("2026-10-29T12:15:00Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
    expect(await hint(shop.id)).toBeNull();

    setPlan(PLANS.pro);
    expect(await smartPauseAfterStop(shop.id, "PLAN_SMART", new Date("2026-10-29T13:00:00Z"), app)).toBe("PLAN");
    await smartTick(deps, new Date("2026-10-29T13:15:00Z"));
    // Still without the smart schedule: the pause stays and is looked at again.
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "PLAN" });
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T13:30:00Z"));
    setPlan(PLANS.business);
    await smartTick(deps, new Date("2026-10-29T13:30:00Z"));
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
  });

  it("saving the settings, pausing and resuming keep the minute's recheck of a run that waits", async () => {
    const { shop, deps, pages } = await setup();
    const t0 = new Date("2026-10-29T12:00:00Z");
    await enabled(shop.id, manual(), t0);
    // A Check now that waited for the merchant's own measurement, which has finished meanwhile.
    await withTenant(
      shop.id,
      (tx) =>
        tx.smartAutoRun.create({
          data: { shopId: shop.id, trigger: "MANUAL", status: "WAITING", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [], includeAttached: false, publishMode: "DRAFT", replaceOutdatedMachine: true },
        }),
      app,
    );
    const t1 = new Date("2026-10-29T12:05:00Z");
    const saved = await saveSmartSettings({ shopId: shop.id, actorId: "7", value: manual(), version: 1, primaryLocale: "en", now: t1 }, app);
    expect(saved).not.toBeNull();
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T12:06:00Z"));
    await pauseSmart({ shopId: shop.id, actorId: "7", now: t1 }, app);
    await resumeSmart({ shopId: shop.id, actorId: "7", now: t1 }, app);
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T12:06:00Z"));
    await smartTick(deps, new Date("2026-10-29T12:06:00Z"));
    expect((await runs(shop.id)).map((r) => r.status)).toEqual(["RUNNING"]);
    expect(pages).toHaveLength(1);
  });

  /** Allowing AI processing from a product's editor (resource-editor.ts, intent grant-consent). */
  async function grantInEditor(store: FakeShopifyStore, shopId: string) {
    const form = new FormData();
    form.set("intent", "grant-consent");
    const billing = { configured: true, state: "ACTIVE", entitlements: PLANS.business, subscription: null, stale: false, mustChoosePlan: false } as const;
    return runEditorAction(
      { admin: store.asAdmin(), shopId, actorId: "7", kind: "PRODUCT", resourceId: P1, target: { locale: "de", name: "German", rtl: false }, sourceName: "English", billing, targetLocales: ["de"] },
      form,
    );
  }

  it("giving consent ends a pause for consent at once; the merchant's own pause stays", async () => {
    const { shop, store } = await setup();
    const t0 = new Date("2026-10-29T12:00:00Z");
    await enabled(shop.id, daily(), t0);
    await smartPauseAfterStop(shop.id, "CONSENT_REQUIRED", t0, app);
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T12:15:00Z"));
    expect(await grantInEditor(store, shop.id)).toEqual({ kind: "consent" });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
    expect(await hint(shop.id)).toEqual(new Date("2026-10-29T22:00:00Z"));
    await pauseSmart({ shopId: shop.id, actorId: "7", now: t0 }, app);
    expect(await grantInEditor(store, shop.id)).toEqual({ kind: "consent" });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "MANUAL" });
  });

  it("giving consent leaves the pause to a new main language that the consent pause was covering", async () => {
    const { shop, store } = await setup();
    const t0 = new Date("2026-10-29T12:00:00Z");
    await enabled(shop.id, daily(), t0);
    // German became the main language in Shopify, then a job stopped for consent first.
    store.locales = [
      { locale: "de", name: "German", primary: true, published: true },
      { locale: "en", name: "English", primary: false, published: true },
    ];
    forgetCurrentLocales();
    await smartPauseAfterStop(shop.id, "CONSENT_REQUIRED", t0, app);
    expect(await grantInEditor(store, shop.id)).toEqual({ kind: "consent" });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "PRIMARY_LANGUAGE" });
  });

  it("Retry agrees with the page: a pause whose cause is gone is lifted first; a real cause refuses", async () => {
    const { shop, deps, setPlan } = await setup();
    const t0 = new Date("2026-10-29T12:00:00Z");
    await enabled(shop.id, daily(), t0);
    // A check's job with one failed item.
    const { run } = await withTenant(
      shop.id,
      async (tx) => {
        const run = await tx.smartAutoRun.create({ data: { shopId: shop.id, trigger: "MANUAL", status: "COMPLETED", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [], idempotencyKey: "retry-run-1" } });
        const job = await tx.translationJob.create({
          data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: SMART_REQUESTED_BY, idempotencyKey: "retry-job-1", status: "COMPLETED", discoveryDone: true, totalItems: 1, failedItems: 1, smartRunId: run.id },
        });
        await tx.translationJobItem.create({ data: { shopId: shop.id, jobId: job.id, resourceGid: P1, status: "DEAD" } });
        return { run };
      },
      app,
    );
    await smartPauseAfterStop(shop.id, "PLAN_SMART", t0, app);
    const queued: string[] = [];
    const shopRef = { id: shop.id, shopDomain: shop.shopDomain };
    expect(await retrySmartRun(deps, shopRef, run.id, async (ids) => void queued.push(...ids), t0)).toEqual({ ok: true, count: 1 });
    expect(queued).toHaveLength(1);
    // The plan really lacks the schedule: refused, nothing queued.
    setPlan(PLANS.pro);
    expect(await retrySmartRun(deps, shopRef, run.id, async (ids) => void queued.push(...ids), t0)).toEqual({ ok: false, error: "NOT_ON" });
    expect(queued).toHaveLength(1);
  });
});

describe("items of smart jobs", () => {
  /** An item of a check's job (realtime: of a real-time job instead, which has no run). */
  async function smartItem(
    shopId: string,
    over: { fieldGroups?: string[]; resourceType?: string; targetLocale?: string; publishMode?: "DRAFT" | "AUTO_PUBLISH"; includeAttached?: boolean; replaceOutdatedMachine?: boolean } = {},
    resourceGid = P1,
    realtime = false,
  ) {
    return withTenant(
      shopId,
      async (tx) => {
        const run = realtime
          ? null
          : await tx.smartAutoRun.create({ data: { shopId, trigger: "MANUAL", status: "RUNNING", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [], idempotencyKey: `r-${Math.random().toString(36).slice(2, 12)}` } });
        const job = await tx.translationJob.create({
          data: {
            shopId,
            resourceType: "PRODUCT",
            targetLocale: "de",
            requestedBy: SMART_REQUESTED_BY,
            idempotencyKey: `t-${Math.random()}`,
            status: "RUNNING",
            discoveryDone: true,
            totalItems: 1,
            smartRunId: run?.id ?? null,
            ...over,
          },
        });
        const item = await tx.translationJobItem.create({ data: { shopId, jobId: job.id, resourceGid } });
        return { job, item };
      },
      app,
    );
  }
  const jobDeps = (store: FakeShopifyStore, entitlements: Entitlements = PLANS.business): JobDependencies => ({
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test:smart",
    billingFor: async () => ({ configured: true, entitlements }),
  });

  it("skip excluded resources and stop while paused or turned off", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id);
    await addSmartExclusion({ shopId: shop.id, resourceGid: P1, actorId: "7" }, app);
    const { item } = await smartItem(shop.id);
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toEqual({ status: "SKIPPED", errorCode: "EXCLUDED" });
    await withTenant(shop.id, (tx) => tx.smartAutoExclusion.deleteMany({ where: { shopId: shop.id } }), app);
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    const paused = await smartItem(shop.id);
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: paused.item.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "PAUSED" });
    await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: false }, app);
    const off = await smartItem(shop.id);
    // Turning off cancelled the job itself.
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: off.item.id }, 1)).toMatchObject({ status: "CANCELLED" });
  });

  it("stop the job on a plan without the smart schedule", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id);
    const { item } = await smartItem(shop.id);
    const error = await processItem(jobDeps(store, PLANS.pro), { shopId: shop.id, itemId: item.id }, 1).catch((e) => e);
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "PLAN_SMART" });
  });

  it("stop with the smart schedule's own reason also on a plan without bulk translation, and either plan stop pauses for the plan", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id);
    const { item } = await smartItem(shop.id);
    const error = await processItem(jobDeps(store, PLANS.free), { shopId: shop.id, itemId: item.id }, 1).catch((e) => e);
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "PLAN_SMART" });
    expect(await smartPauseAfterStop(shop.id, "PLAN_REQUIRED", new Date(), app)).toBe("PLAN");
  });

  it("follow the settings as they are now for images and outdated machine output too", async () => {
    const { shop, store } = await setup();
    // Linguva's own machine translation of product 1's description, outdated since.
    store.translate(P1, "de", "body_html", "<p>Warme <b>Jacke</b> Nummer 1.</p>");
    await withTenant(
      shop.id,
      (tx) =>
        tx.translationRevision.create({
          data: { shopId: shop.id, resourceGid: P1, locale: "de", key: "body_html", value: "<p>Warme <b>Jacke</b> Nummer 1.</p>", sourceDigest: sha("<p>Warm <b>jacket</b> number 1.</p>"), origin: "AI", provider: "mock" },
        }),
      app,
    );
    store.updateSource(P1, "body_html", "<p>Warm <b>jacket</b> number 1, now waterproof.</p>");
    store.addImage(P1, "Blue jacket");
    // Planned while images were included and outdated machine output replaced; both turned off since.
    await enabled(shop.id, daily({ includeAttached: false, replaceOutdatedMachine: false }));
    const { item } = await smartItem(shop.id, { includeAttached: true, replaceOutdatedMachine: true });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const drafts = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id, status: "PENDING" } }), app);
    // The missing title only: the outdated description and the image's alt text stay as they are.
    expect(drafts.map((d) => `${d.resourceGid}|${d.key}`)).toEqual([`${P1}|title`]);
  });

  it("translate only the chosen field groups, count as smart usage, and stop at the daily budget", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id, daily({ dailyBudget: 1000 }));
    const { item } = await smartItem(shop.id, { fieldGroups: ["title"] });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const drafts = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id } }), app);
    expect(drafts.map((d) => d.key)).toEqual(["title"]);
    const used = await getOriginUsageSince(shop.id, "smart", new Date("2026-01-01T00:00:00Z"), app);
    expect(used).toBeGreaterThan(0);
    // The next product's title doesn't fit in what is left of today's budget: the job stops.
    const config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ dailyBudget: used + 5 }), version: config.version, primaryLocale: "en" }, app);
    const next = await smartItem(shop.id, { fieldGroups: ["title"] }, "gid://shopify/Product/2");
    const error = await processItem(jobDeps(store), { shopId: shop.id, itemId: next.item.id }, 1).catch((e) => e);
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "SMART_BUDGET_DAILY" });
  });

  it("follow the settings as they are now: a type or real time taken out stops them, narrower field groups narrow them", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id, daily({ resourceTypes: ["PRODUCT"] }));
    const narrowed = await smartItem(shop.id);
    const realtime = await smartItem(shop.id, {}, "gid://shopify/Product/2", true);
    let config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ resourceTypes: ["PRODUCT"], fieldGroups: ["title"] }), version: config.version, primaryLocale: "en" }, app);
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: narrowed.item.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const drafts = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id } }), app);
    expect(drafts.map((d) => d.key)).toEqual(["title"]);
    // Queued in real time; the schedule is daily now: its next check takes it.
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: realtime.item.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "OUT_OF_SCOPE" });
    config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ resourceTypes: ["COLLECTION"] }), version: config.version, primaryLocale: "en" }, app);
    const removed = await smartItem(shop.id, {}, "gid://shopify/Product/2");
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: removed.item.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "OUT_OF_SCOPE" });
  });

  it("translate only into a language the store and the plan still have", async () => {
    const { shop, store } = await setup();
    store.locales = [...store.locales, { locale: "fr", name: "French", primary: false, published: true }];
    await enabled(shop.id, daily({ locales: ["de", "fr"] }));
    store.locales = store.locales.filter((l) => l.locale !== "fr");
    forgetCurrentLocales();
    const { item } = await smartItem(shop.id, { targetLocale: "fr" });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "LANGUAGE_GONE" });
    expect(await getOriginUsageSince(shop.id, "smart", new Date("2026-01-01T00:00:00Z"), app)).toBe(0);
  });

  it("translate into a language added a moment ago: a copy of the languages minutes old is checked with Shopify first", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id, daily({ locales: ["de", "fr"] }));
    // The worker read the languages a minute ago, before French was added in Shopify.
    await currentShopLocales(shop.id, async () => store.asAdmin(), app);
    store.locales = [...store.locales, { locale: "fr", name: "French", primary: false, published: true }];
    const { item } = await smartItem(shop.id, { targetLocale: "fr" });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
  });

  it("translate nothing from a new primary language: the job stops and the schedule pauses until the languages are saved", async () => {
    const { shop } = await setup();
    await enabled(shop.id);
    // The store's primary language is French now; the settings were saved with English.
    const store = new FakeShopifyStore(2, "fr");
    store.locales = [
      { locale: "fr", name: "French", primary: true, published: true },
      { locale: "de", name: "German", primary: false, published: true },
    ];
    forgetCurrentLocales();
    const { item } = await smartItem(shop.id);
    const error = await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1).catch((e) => e);
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "PRIMARY_LANGUAGE" });
    expect(await smartPauseAfterStop(shop.id, "PRIMARY_LANGUAGE", new Date(), app)).toBe("PRIMARY_LANGUAGE");
    expect(await getOriginUsageSince(shop.id, "smart", new Date("2026-01-01T00:00:00Z"), app)).toBe(0);
  });

  it("compare the primary language only with content Shopify returned (a resource without any is no sign of a change)", async () => {
    const { shop } = await setup();
    const store = new FakeShopifyStore(1, "de");
    store.locales = [
      { locale: "de", name: "German", primary: true, published: true },
      { locale: "fr", name: "French", primary: false, published: true },
    ];
    store.products.set(P1, []);
    forgetCurrentLocales();
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ locales: ["fr"] }), version: 0, primaryLocale: "de" }, app);
    await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: true }, app);
    const { item } = await smartItem(shop.id, { targetLocale: "fr" });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toMatchObject({ status: "SKIPPED" });
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null });
  });

  it("leave a custom field alone when its product is excluded", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id, daily({ resourceTypes: ["PRODUCT"], includeAttached: true }));
    const field = "gid://shopify/Metafield/9901";
    const now = new Date();
    await withTenant(
      shop.id,
      (tx) =>
        tx.coverageItem.create({
          data: { shopId: shop.id, locale: "de", resourceType: "PRODUCT_METAFIELD", resourceGid: field, parentGid: P1, sourceKeys: ["value"], currentKeys: [], outdatedKeys: [], draftKeys: [], reviewKeys: [], fieldStates: ["custom:missing"], sourceChars: [12], syncedAt: now, seenAt: now },
        }),
      app,
    );
    const { item } = await smartItem(shop.id, { resourceType: "PRODUCT_METAFIELD" }, field);
    await addSmartExclusion({ shopId: shop.id, resourceGid: P1, actorId: "7" }, app);
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toEqual({ status: "SKIPPED", errorCode: "EXCLUDED" });
  });

  it("publish only while the settings say so, and reuse translation memory without billing it", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id, daily({ publishMode: "AUTO_PUBLISH" }));
    const config = (await getSmartConfig(shop.id, app))!;
    expect(config).toMatchObject({ publishMode: "AUTO_PUBLISH", publishConfirmedBy: "7" });
    // The title is in the translation memory (approved): reused, not sent.
    const title = store.products.get(P1)!.find((f) => f.key === "title")!.value;
    await storeMemory({ shopId: shop.id, sourceLocale: "en", targetLocale: "de", market: "" }, [{ source: title, target: "Produkt 1 Jacke" }], "APPROVED", app);
    const { job, item } = await smartItem(shop.id, { publishMode: "AUTO_PUBLISH" });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect(store.translationOf(P1, "de", "title")).toBe("Produkt 1 Jacke");
    const counted = await withTenant(shop.id, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
    expect(counted.charsSaved).toBeGreaterThanOrEqual(title.length);
    // Back to drafts: an item of a job made while publishing was on waits for review.
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ publishMode: "DRAFT" }), version: config.version, primaryLocale: "en" }, app);
    const next = await smartItem(shop.id, { publishMode: "AUTO_PUBLISH" }, "gid://shopify/Product/2");
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: next.item.id }, 1)).toMatchObject({ status: "SUCCEEDED", errorCode: "DRAFTED" });
    expect(store.translationOf("gid://shopify/Product/2", "de", "title")).toBeUndefined();
  });

  it("are cancelled with their check when it is turned off", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id);
    const { job, item } = await smartItem(shop.id);
    await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: false }, app);
    expect((await runs(shop.id)).map((r) => [r.status, r.errorCode])).toEqual([["CANCELLED", "SMART_OFF"]]);
    expect(await withTenant(shop.id, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app)).toMatchObject({ status: "CANCELLED", errorCode: "SMART_OFF" });
    expect(await processItem(jobDeps(store), { shopId: shop.id, itemId: item.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "SMART_OFF" });
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
  });

  it("are retried from the Jobs page without a discovery of their own (the check's measurement fills the job)", async () => {
    const { shop } = await setup();
    await enabled(shop.id);
    const { job, item } = await smartItem(shop.id);
    await withTenant(
      shop.id,
      async (tx) => {
        await tx.translationJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "SMART_BUDGET_DAILY", discoveryDone: false } });
        await tx.translationJobItem.update({ where: { id: item.id }, data: { status: "FAILED" } });
      },
      app,
    );
    expect(await retryJobItems(shop.id, job.id, app)).toEqual({ itemIds: [item.id], rediscover: false });
    expect(await withTenant(shop.id, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app)).toMatchObject({ status: "RUNNING" });
  });
});

describe("webhooks and the periodic check", () => {
  const recordQueue = () => {
    const added: unknown[] = [];
    const queue: AutoQueue = { add: async (_name, data) => void added.push(data) };
    return { queue, added };
  };
  const webhook = (gid: string) => ({ shopDomain: "smart.myshopify.com", topic: "PRODUCTS_UPDATE", payload: { admin_graphql_api_id: gid, updated_at: "2026-10-29T10:00:00Z" } });

  it("queue nothing while paused, and create nothing on a plan without the smart schedule", async () => {
    const { shop, deps, setPlan } = await setup();
    await enabled(shop.id, daily({ mode: "realtime", times: [180] }));
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    const { queue, added } = recordQueue();
    expect(await queueAutoTranslate(webhook(P1), { queue, prisma: app })).toBe("paused");
    expect(added).toHaveLength(0);
    await resumeSmart({ shopId: shop.id, actorId: "7" }, app);
    setPlan(PLANS.pro);
    expect(await createAutoItems(app, { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" }, deps.billingFor)).toEqual({ itemIds: [], reused: [], busy: false });
  });

  it("queue nothing paid in a scheduled mode", async () => {
    const { shop } = await setup();
    await enabled(shop.id);
    const { queue, added } = recordQueue();
    expect(await queueAutoTranslate(webhook(P1), { queue, prisma: app })).toBe("off");
    expect(added).toHaveLength(0);
  });

  it("go to the smart path in real-time mode, with its scope and publishing", async () => {
    const { shop, deps } = await setup();
    await enabled(shop.id, daily({ mode: "realtime", times: [180], fieldGroups: ["title"], includeAttached: true }));
    const { queue, added } = recordQueue();
    expect(await queueAutoTranslate(webhook(P1), { queue, prisma: app })).toBe("queued");
    expect(added).toHaveLength(1);
    const created = await createAutoItems(app, { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" }, deps.billingFor);
    expect(created.itemIds).toHaveLength(1);
    const [job] = await withTenant(shop.id, (tx) => tx.translationJob.findMany({ where: { shopId: shop.id } }), app);
    expect(job).toMatchObject({ requestedBy: SMART_REQUESTED_BY, fieldGroups: ["title"], includeAttached: true, publishMode: "DRAFT", smartRunId: null });
    // An excluded resource isn't checked.
    await addSmartExclusion({ shopId: shop.id, resourceGid: "gid://shopify/Product/2", actorId: "7" }, app);
    expect((await createAutoItems(app, { shopId: shop.id, resourceGid: "gid://shopify/Product/2", resourceType: "PRODUCT" }, deps.billingFor)).itemIds).toHaveLength(0);
  });

  it("the periodic check follows changes between checks in real-time mode only, from its last full check on", async () => {
    const { shop, store, deps } = await setup();
    store.addContent(1);
    const sweepDeps = { prisma: app, adminFor: deps.adminFor, billingFor: deps.billingFor };
    const now = new Date();
    // A daily schedule reads everything at its time: nothing between checks.
    await enabled(shop.id, daily(), now);
    store.touch("gid://shopify/Page/1", new Date(now.getTime() + 60_000));
    const scheduled = recordQueue();
    expect(await sweepChangedContent(sweepDeps, scheduled.queue, new Date(now.getTime() + 5 * 60_000))).toMatchObject({ shops: 0, queued: 0 });
    // Real time: the changed page is checked (by the same check a webhook queues), the position moves on.
    const config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: daily({ mode: "realtime", times: [180] }), version: config.version, primaryLocale: "en", now }, app);
    const live = recordQueue();
    expect(await sweepChangedContent(sweepDeps, live.queue, new Date(now.getTime() + 5 * 60_000))).toMatchObject({ shops: 1, queued: 1 });
    expect(live.added).toEqual([expect.objectContaining({ resourceGid: "gid://shopify/Page/1", resourceType: "PAGE" })]);
    expect((await getShopSettings(shop.id, app)).autoSweptAt).not.toBeNull();
    // Paused: nothing.
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    store.touch("gid://shopify/Page/1", new Date(now.getTime() + 6 * 60_000));
    expect(await sweepChangedContent(sweepDeps, recordQueue().queue, new Date(now.getTime() + 10 * 60_000))).toMatchObject({ shops: 0, queued: 0 });
    // A skipped check (here: while paused) read nothing: changes before it are still followed after resuming.
    await withTenant(
      shop.id,
      (tx) => tx.smartAutoRun.create({ data: { shopId: shop.id, trigger: "SCHEDULED", occurrenceAt: new Date(now.getTime() + 11 * 60_000), status: "SKIPPED", errorCode: "PAUSED", locales: ["de"], resourceTypes: ["PAGE"], fieldGroups: [] } }),
      app,
    );
    await withTenant(shop.id, (tx) => tx.smartAutoConfig.update({ where: { shopId: shop.id }, data: { lastRunAt: new Date(now.getTime() + 11 * 60_000) } }), app);
    await resumeSmart({ shopId: shop.id, actorId: "7" }, app);
    const resumed = recordQueue();
    expect(await sweepChangedContent(sweepDeps, resumed.queue, new Date(now.getTime() + 12 * 60_000))).toMatchObject({ shops: 1, queued: 1 });
    expect(resumed.added).toEqual([expect.objectContaining({ resourceGid: "gid://shopify/Page/1" })]);
  });

  it("the periodic check doesn't move past a check that left part of its scope (PARTIAL)", async () => {
    const { shop, store, deps } = await setup();
    store.addContent(1);
    const sweepDeps = { prisma: app, adminFor: deps.adminFor, billingFor: deps.billingFor };
    const t0 = new Date();
    await enabled(shop.id, daily({ mode: "realtime", times: [180] }), t0);
    // A page changes; the check after it read the page while paused and planned nothing for it.
    store.touch("gid://shopify/Page/1", new Date(t0.getTime() + 5 * 60_000));
    const started = new Date(t0.getTime() + 20 * 60_000);
    await withTenant(
      shop.id,
      (tx) =>
        tx.smartAutoRun.create({
          data: { shopId: shop.id, trigger: "SCHEDULED", occurrenceAt: started, status: "COMPLETED", errorCode: "PARTIAL", startedAt: started, finishedAt: new Date(started.getTime() + 5 * 60_000), locales: ["de"], resourceTypes: ["PAGE"], fieldGroups: [] },
        }),
      app,
    );
    const { queue, added } = recordQueue();
    expect(await sweepChangedContent(sweepDeps, queue, new Date(t0.getTime() + 30 * 60_000))).toMatchObject({ shops: 1, queued: 1 });
    expect(added).toEqual([expect.objectContaining({ resourceGid: "gid://shopify/Page/1" })]);
  });
});

describe("the editor and coverage", () => {
  const editor = (store: FakeShopifyStore, shopId: string, entitlements: Entitlements): EditorContext => ({
    admin: store.asAdmin(),
    shopId,
    actorId: "7",
    kind: "PRODUCT",
    resourceId: P1,
    target: { locale: "de", name: "German", rtl: false },
    sourceName: "English",
    billing: { configured: true, state: "ACTIVE", entitlements, subscription: null, stale: false, mustChoosePlan: false },
    targetLocales: ["de"],
  });
  const form = (intent: string) => {
    const f = new FormData();
    f.set("intent", intent);
    return f;
  };

  it("leave a product out of the smart schedule and back in from its editor; a lower plan can't", async () => {
    const { shop, store } = await setup();
    await enabled(shop.id);
    expect((await loadEditorData(editor(store, shop.id, PLANS.business))).smart).toEqual({ excluded: false });
    expect(await runEditorAction(editor(store, shop.id, PLANS.business), form("smart-exclude"))).toEqual({ kind: "smart", excluded: true });
    expect((await loadEditorData(editor(store, shop.id, PLANS.business))).smart).toEqual({ excluded: true });
    const context = { entitled: true, consent: true, available: true, allowed: ["de"] };
    expect(await loadSmartCoverageNote(shop.id, context, app)).toMatchObject({ excluded: 1, status: { state: "on" } });
    // Pro: no option on the page, and a forged request changes nothing.
    expect((await loadEditorData(editor(store, shop.id, PLANS.pro))).smart).toBeNull();
    expect(await runEditorAction(editor(store, shop.id, PLANS.pro), form("smart-include"))).toEqual({ kind: "error", code: "PLAN_SMART" });
    expect(await isSmartExcluded(shop.id, P1, app)).toBe(true);
    expect(await runEditorAction(editor(store, shop.id, PLANS.business), form("smart-include"))).toEqual({ kind: "smart", excluded: false });
    expect(await isSmartExcluded(shop.id, P1, app)).toBe(false);
  });
});

describe("uninstall", () => {
  it("stops the schedule and cancels its runs; a reinstall doesn't resume it", async () => {
    const { shop, deps } = await setup();
    await enabled(shop.id, daily(), new Date("2026-10-29T12:00:00Z"));
    await smartTick(deps, new Date("2026-10-29T22:00:30Z"));
    await markShopUninstalled(shop.shopDomain, app);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await runs(shop.id)).map((r) => [r.status, r.errorCode])).toEqual([["CANCELLED", "SHOP_UNINSTALLED"]]);
    expect(await hint(shop.id)).toBeNull();
    await upsertInstalledShop({ shopDomain: shop.shopDomain }, app);
    expect((await getSmartConfig(shop.id, app))!.enabled).toBe(false);
  });
});
