/**
 * The way back to a stopped job (app/.server/jobs/back-to-job.ts) against
 * PostgreSQL, and the pages that show it, their loaders called as functions
 * with the session and billing stood in: Settings' AI permission and keys
 * sections (`?section=ai|keys&job=<id>`), the smart schedule's page and the
 * Plan page. Only a FAILED job of this shop, stopped for a cause the page
 * fixes, and only once that cause is fixed (stopFix says true); a running
 * or finished job, another shop's job, an id from elsewhere or a check that
 * fails shows nothing and never breaks the page.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stand = vi.hoisted(() => ({
  shop: null as null | { id: string; shopDomain: string; name: string | null },
  admin: null as unknown,
  billing: null as unknown,
}));
vi.mock("../../app/.server/shopify/require-shop", () => ({
  requireShop: async () => ({ admin: stand.admin, shop: stand.shop, actorId: "42", session: {}, redirect: () => null, scopes: { query: async () => ({ granted: [] }) } }),
}));
vi.mock("../../app/.server/billing/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/billing/billing")>()),
  shopBilling: async () => stand.billing,
}));

import { PrismaClient, type Prisma, type TranslationJob } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { backToJob, stopGroupsFixedAt } from "../../app/.server/jobs/back-to-job";
import type { StopFixBilling } from "../../app/.server/jobs/stop-fix";
import { resetConfigCache } from "../../app/.server/lib/config";
import { resetQueueClient } from "../../app/.server/queue/client";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { saveSmartSettings } from "../../app/.server/smart/config";
import type { SmartSettingsValue } from "../../app/.server/smart/validate";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { periodKey } from "../../app/.server/usage/usage-ledger";
import { OWN_KEY_PLAN, PLANS, type Entitlements } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { loader as planLoader } from "../../app/routes/app.plan";
import { loader as settingsLoader } from "../../app/routes/app.settings";
import { loader as smartLoader } from "../../app/routes/app.settings_.automatic";
import { ownerDb, resetDatabase } from "../support/db";
import { ownDeepLKey } from "../support/engine-fixtures";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const MIN = 60_000;

beforeEach(async () => {
  await resetDatabase();
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await resetQueueClient();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

let seq = 0;
const newShop = async (name: string) => (await upsertInstalledShop({ shopDomain: `${name}-${++seq}.myshopify.com`, name: "Back To Job Store" }, app)).shop;
const billed = (entitlements: Entitlements): StopFixBilling => ({ configured: true, entitlements });

/** A job as the Jobs pages see it: stopped (FAILED) with a code unless told otherwise. */
async function job(shopId: string, data: Partial<Omit<Prisma.TranslationJobUncheckedCreateInput, "shopId">> = {}): Promise<TranslationJob> {
  const status = data.status ?? "FAILED";
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.create({
        data: {
          resourceType: "PRODUCT",
          targetLocale: "de",
          discoveryDone: true,
          idempotencyKey: `back-${++seq}`,
          finishedAt: status === "FAILED" || status === "COMPLETED" || status === "CANCELLED" ? new Date(Date.now() - MIN) : null,
          ...data,
          shopId,
          status,
        },
      }),
    app,
  );
}

const schedule = (over: Partial<SmartSettingsValue> = {}): SmartSettingsValue => ({
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

/** The smart schedule's characters now (its budgets count them). */
async function smartUsage(shopId: string, chars: number, at: Date) {
  await withTenant(
    shopId,
    (tx) => tx.usageLedger.create({ data: { shopId, periodKey: periodKey(at), kind: "RESERVE", chars, provider: "mock", idempotencyKey: `smart-usage-${++seq}`, origin: "smart", createdAt: at } }),
    app,
  );
}

describe("backToJob: the way back once the page fixed the stop", () => {
  it("names the causes each page fixes, from the Jobs pages' fix addresses", () => {
    const sorted = (target: string) => stopGroupsFixedAt(target).sort();
    expect(sorted("/app/settings?section=ai")).toEqual(["CONSENT_REQUIRED", "ENGINE_CONSENT"]);
    expect(sorted("/app/settings?section=keys")).toEqual(["OWN_KEY_AUTH", "OWN_KEY_MISSING", "OWN_KEY_QUOTA"]);
    expect(sorted("/app/settings/automatic")).toEqual(["PRIMARY_LANGUAGE", "SMART_BUDGET_DAILY", "SMART_BUDGET_MONTHLY"]);
    expect(sorted("/app/plan")).toEqual(["PLAN_REQUIRED", "PLAN_SMART", "QUOTA_EXCEEDED"]);
    // Settings without a section fixes nothing by itself.
    expect(stopGroupsFixedAt("/app/settings")).toEqual([]);
  });

  it("a stop for the permission: only once it is given, and only on the permission's section", async () => {
    const s = await newShop("consent");
    const stopped = await job(s.id, { errorCode: "CONSENT_REQUIRED", targetLocale: "fr", resourceType: "COLLECTION" });
    const ask = (target: string) => backToJob({ shopId: s.id, billing: billed(PLANS.pro), jobId: stopped.id, target, client: app });
    expect(await ask("/app/settings?section=ai")).toBeNull();
    await setAiConsent({ shopId: s.id, granted: true, actorId: "7" }, app);
    expect(await ask("/app/settings?section=ai")).toEqual({ id: stopped.id, targetLocale: "fr", resourceType: "COLLECTION", group: "CONSENT_REQUIRED" });
    // Fixed, but not by these pages.
    expect(await ask("/app/settings?section=keys")).toBeNull();
    expect(await ask("/app/plan")).toBeNull();
    expect(await ask("/app/settings/automatic")).toBeNull();
  });

  it("never for a job that isn't stopped, another shop's job or an id from elsewhere", async () => {
    const s = await newShop("only-failed");
    const other = await newShop("other");
    await setAiConsent({ shopId: s.id, granted: true, actorId: "7" }, app);
    await setAiConsent({ shopId: other.id, granted: true, actorId: "7" }, app);
    const ask = (shopId: string, jobId: string | null) => backToJob({ shopId, billing: billed(PLANS.pro), jobId, target: "/app/settings?section=ai", client: app });
    for (const status of ["COMPLETED", "CANCELLED", "RUNNING", "PENDING", "DISCOVERING"] as const) {
      const notStopped = await job(s.id, { status, errorCode: "CONSENT_REQUIRED" });
      expect(await ask(s.id, notStopped.id), status).toBeNull();
    }
    const theirs = await job(other.id, { errorCode: "CONSENT_REQUIRED" });
    expect(await ask(other.id, theirs.id)).toMatchObject({ id: theirs.id });
    expect(await ask(s.id, theirs.id)).toBeNull();
    for (const id of [null, "", "not-a-job", "../jobs", `${theirs.id}'--`, "00000000-0000-4000-8000-000000000000"]) expect(await ask(s.id, id), String(id)).toBeNull();
    // A stop with a cause no page fixes (the AI service), or none recorded.
    expect(await ask(s.id, (await job(s.id, { errorCode: "PROVIDER_UNAVAILABLE" })).id)).toBeNull();
    expect(await ask(s.id, (await job(s.id, { errorCode: null })).id)).toBeNull();
  });

  it("the plan: once it includes whole areas, or the smart schedule", async () => {
    const s = await newShop("plan");
    const bulk = await job(s.id, { errorCode: "PLAN_REQUIRED" });
    const smart = await job(s.id, { errorCode: "PLAN_SMART", requestedBy: SMART_REQUESTED_BY, resourceType: "PAGE" });
    const ask = (jobId: string, entitlements: Entitlements) => backToJob({ shopId: s.id, billing: billed(entitlements), jobId, target: "/app/plan", client: app });
    expect(await ask(bulk.id, PLANS.free)).toBeNull();
    expect(await ask(bulk.id, PLANS.starter)).toMatchObject({ id: bulk.id, group: "PLAN_REQUIRED" });
    expect(await ask(smart.id, PLANS.pro)).toBeNull();
    expect(await ask(smart.id, PLANS.business)).toMatchObject({ id: smart.id, resourceType: "PAGE", group: "PLAN_SMART" });
  });

  it("own keys: once a key works", async () => {
    const s = await newShop("keys");
    const missing = await job(s.id, { errorCode: "OWN_KEY_MISSING" });
    const ask = () => backToJob({ shopId: s.id, billing: billed(OWN_KEY_PLAN), jobId: missing.id, target: "/app/settings?section=keys", client: app });
    expect(await ask()).toBeNull();
    await seedOwnKey(s.id, { engine: "deepl", apiKey: ownDeepLKey(1) }, { client: app });
    expect(await ask()).toMatchObject({ id: missing.id, group: "OWN_KEY_MISSING" });
  });

  it("the smart schedule's budget: once it is raised", async () => {
    const s = await newShop("budget");
    const now = new Date();
    await saveSmartSettings({ shopId: s.id, actorId: "7", value: schedule({ dailyBudget: 1_000 }), version: 0, primaryLocale: "en", now }, app);
    await smartUsage(s.id, 2_000, now);
    const daily = await job(s.id, { errorCode: "SMART_BUDGET_DAILY", requestedBy: SMART_REQUESTED_BY });
    const ask = () => backToJob({ shopId: s.id, billing: billed(PLANS.business), jobId: daily.id, target: "/app/settings/automatic", now, client: app });
    expect(await ask()).toBeNull();
    await saveSmartSettings({ shopId: s.id, actorId: "7", value: schedule({ dailyBudget: 5_000 }), version: 1, primaryLocale: "en", now }, app);
    expect(await ask()).toMatchObject({ id: daily.id, group: "SMART_BUDGET_DAILY" });
  });

  it("a check that fails shows nothing and never throws", async () => {
    const s = await newShop("broken");
    const stopped = await job(s.id, { errorCode: "PLAN_REQUIRED" });
    const unreachable = new PrismaClient({ datasources: { db: { url: "postgresql://nobody:nothing@127.0.0.1:1/none" } } });
    try {
      await expect(backToJob({ shopId: s.id, billing: billed(PLANS.pro), jobId: stopped.id, target: "/app/plan", client: unreachable })).resolves.toBeNull();
    } finally {
      await unreachable.$disconnect();
    }
  });
});

// ─── The pages ────────────────────────────────────────────────────────────────

const subscription = (planHandle: string) => ({
  shopId: "",
  state: "ACTIVE" as const,
  planHandle,
  pendingPlanHandle: null,
  billingPeriod: "EVERY_30_DAYS",
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: new Date("2026-11-28T00:00:00.000Z"),
  checkedAt: new Date(),
  updatedAt: new Date(),
});
const billingOf = (entitlements: Entitlements, handle: string): BillingStatus => ({
  configured: true,
  state: "ACTIVE",
  entitlements,
  subscription: subscription(handle),
  stale: false,
  mustChoosePlan: false,
});

async function standIn(name: string, billing: BillingStatus) {
  const shop = await newShop(name);
  stand.shop = shop;
  stand.admin = new FakeShopifyStore(2).asAdmin();
  stand.billing = billing;
  return shop;
}
const request = (path: string) => ({ request: new Request(`http://app.test${path}`), params: {}, context: {} }) as LoaderFunctionArgs;
const settingsPage = async (path: string) => (await settingsLoader(request(path))) as Awaited<ReturnType<typeof settingsLoader>>;

describe("the pages that fix a stop lead back to the job", () => {
  it("Settings: the AI permission's section, once the permission is given; not on another section", async () => {
    const shop = await standIn("settings-ai", billingOf(PLANS.pro, "pro"));
    const stopped = await job(shop.id, { errorCode: "CONSENT_REQUIRED", targetLocale: "de", resourceType: "PRODUCT" });
    expect((await settingsPage(`/app/settings?section=ai&job=${stopped.id}`)).backToJob).toBeNull();
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "42" }, app);
    expect((await settingsPage(`/app/settings?section=ai&job=${stopped.id}`)).backToJob).toEqual({
      id: stopped.id,
      targetLocale: "de",
      resourceType: "PRODUCT",
      group: "CONSENT_REQUIRED",
      section: "ai",
    });
    for (const path of [`/app/settings?section=publish&job=${stopped.id}`, `/app/settings?job=${stopped.id}`, "/app/settings?section=ai", `/app/settings?section=ai&job=nonsense`]) {
      expect((await settingsPage(path)).backToJob, path).toBeNull();
    }
    // The rest of the page is as without a job.
    expect((await settingsPage(`/app/settings?section=ai&job=${stopped.id}`)).consent).toBe(true);
  });

  it("Settings: the keys' section, once a key works, and only where the store has keys", async () => {
    const shop = await standIn("settings-keys", billingOf(OWN_KEY_PLAN, "own-key"));
    const missing = await job(shop.id, { errorCode: "OWN_KEY_MISSING", targetLocale: "fr" });
    const path = `/app/settings?section=keys&job=${missing.id}`;
    expect((await settingsPage(path)).backToJob).toBeNull();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(2) }, { client: app });
    expect((await settingsPage(path)).backToJob).toMatchObject({ id: missing.id, targetLocale: "fr", section: "keys" });

    // On Pro no key is needed (the cause is gone), but the store has no keys section to lead back from.
    const pro = await standIn("settings-nokeys", billingOf(PLANS.pro, "pro"));
    const old = await job(pro.id, { errorCode: "OWN_KEY_MISSING" });
    const page = await settingsPage(`/app/settings?section=keys&job=${old.id}`);
    expect(page.ownKeys).toBeNull();
    expect(page.backToJob).toBeNull();
  });

  it("the smart schedule's page: once the budget is raised", async () => {
    const shop = await standIn("smart", billingOf(PLANS.business, "business"));
    const now = new Date();
    await saveSmartSettings({ shopId: shop.id, actorId: "42", value: schedule({ dailyBudget: 1_000 }), version: 0, primaryLocale: "en", now }, app);
    await smartUsage(shop.id, 2_000, now);
    const daily = await job(shop.id, { errorCode: "SMART_BUDGET_DAILY", requestedBy: SMART_REQUESTED_BY });
    const page = async () => (await smartLoader(request(`/app/settings/automatic?job=${daily.id}`))) as Awaited<ReturnType<typeof smartLoader>>;
    expect((await page()).backToJob).toBeNull();
    await saveSmartSettings({ shopId: shop.id, actorId: "42", value: schedule({ dailyBudget: 5_000 }), version: 1, primaryLocale: "en", now }, app);
    expect((await page()).backToJob).toMatchObject({ id: daily.id, group: "SMART_BUDGET_DAILY" });
    expect(((await smartLoader(request("/app/settings/automatic"))) as Awaited<ReturnType<typeof smartLoader>>).backToJob).toBeNull();
  });

  it("the Plan page: once the plan includes whole areas", async () => {
    const shop = await standIn("plan-free", billingOf(PLANS.free, "free"));
    const stopped = await job(shop.id, { errorCode: "PLAN_REQUIRED" });
    const page = async () => (await planLoader(request(`/app/plan?job=${stopped.id}`))) as Awaited<ReturnType<typeof planLoader>>;
    expect((await page()).backToJob).toBeNull();
    stand.billing = billingOf(PLANS.starter, "starter");
    expect((await page()).backToJob).toMatchObject({ id: stopped.id, group: "PLAN_REQUIRED" });
    // Without a job, the page is as before.
    expect(((await planLoader(request("/app/plan"))) as Awaited<ReturnType<typeof planLoader>>).backToJob).toBeNull();
  });
});
