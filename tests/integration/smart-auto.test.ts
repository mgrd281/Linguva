/**
 * Smart Auto-Translate (Business) against PostgreSQL: settings with a
 * version, turning it on and off, the scheduler's one run per occurrence
 * (also with several ticks at once), catch-up after an outage, daylight
 * saving, pauses and what lifts them, Check now, the per-item checks and
 * budgets, real-time routing, and uninstall.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { createAutoItems, queueAutoTranslate, type AutoQueue } from "../../app/.server/jobs/auto-translate";
import { classifyError } from "../../app/.server/jobs/errors";
import { processItem, type JobDependencies } from "../../app/.server/jobs/processors";
import { forgetCurrentLocales } from "../../app/.server/locales/current-locales";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { getShopSettings, setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { addSmartExclusion, getSmartConfig, pauseSmart, resumeSmart, saveSmartSettings, setSmartEnabled, smartPauseAfterStop } from "../../app/.server/smart/config";
import { requestSmartRun, smartTick, type SmartDeps } from "../../app/.server/smart/runs";
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
    expect(await hint(shop.id)).toEqual(new Date("2026-10-30T22:00:00Z"));
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

  it("pauses and resumes by the merchant's choice", async () => {
    const { shop } = await setup();
    await enabled(shop.id);
    expect(await pauseSmart({ shopId: shop.id, actorId: "7" }, app)).toBe(true);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "MANUAL", pausedUntil: null });
    await resumeSmart({ shopId: shop.id, actorId: "7" }, app);
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pausedAt: null, pauseReason: null });
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

  it("refuses while turned off or without AI translation", async () => {
    const { shop, deps } = await setup();
    const input = { shop: { id: shop.id, shopDomain: shop.shopDomain }, actorId: "7", idempotencyKey: "click-0001" };
    expect(await requestSmartRun(deps, input)).toEqual({ status: "off" });
    await enabled(shop.id);
    expect(await requestSmartRun({ ...deps, aiAvailable: false }, input)).toMatchObject({ status: "blocked", reason: "AI_NOT_CONFIGURED" });
  });
});

describe("items of smart jobs", () => {
  async function smartItem(shopId: string, over: { fieldGroups?: string[] } = {}, resourceGid = P1) {
    return withTenant(
      shopId,
      async (tx) => {
        const job = await tx.translationJob.create({
          data: { shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy: SMART_REQUESTED_BY, idempotencyKey: `t-${Math.random()}`, status: "RUNNING", discoveryDone: true, totalItems: 1, ...over },
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
});

describe("webhooks and the periodic check", () => {
  const recordQueue = () => {
    const added: unknown[] = [];
    const queue: AutoQueue = { add: async (_name, data) => void added.push(data) };
    return { queue, added };
  };
  const webhook = (gid: string) => ({ shopDomain: "smart.myshopify.com", topic: "PRODUCTS_UPDATE", payload: { admin_graphql_api_id: gid, updated_at: "2026-10-29T10:00:00Z" } });

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
