import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // "Fits your store" needs AI translation: the mock provider (no network).
  process.env.TRANSLATION_PROVIDER = "mock";
});

/**
 * The Plan page's data (app/.server/billing/plan-page.ts): the store's
 * languages and the ones its plan covers, the allowance actually enforced
 * (also during a trial), when it renews, and what the store uses for
 * "Fits your store", read only from the shop's own rows. Nothing here
 * creates, changes or cancels a subscription: the Partner API is simulated.
 */
import { PrismaClient } from "@prisma/client";
import { loadPlanPage } from "../../app/.server/billing/plan-page";
import { AUTO_REQUESTED_BY } from "../../app/.server/jobs/bulk-jobs";
import { getBillingStatus, type BillingDeps } from "../../app/.server/billing/subscription";
import { resetConfigCache } from "../../app/.server/lib/config";
import { MAX_ENABLED_LOCALES } from "../../app/.server/locales/shop-locales";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { periodKey } from "../../app/.server/usage/usage-ledger";
import { recommendPlan } from "../../app/lib/plan-view";
import { PLANS, TRIAL_AI_CHARS } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { ownerDb, resetDatabase } from "../support/db";
import { fakePartnerApi, PARTNER_SETTINGS, type FakeSubscription } from "../support/fake-partner-api";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
let n = 0;

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function shop() {
  const domain = `plan-${++n}.myshopify.com`;
  const { shop } = await upsertInstalledShop({ shopDomain: domain, shopifyShopGid: `gid://shopify/Shop/${7000 + n}` }, app);
  return { ...shop, shopDomain: domain };
}

/** The page's data for a store whose Partner API answer is `subscription`. */
async function page(s: Awaited<ReturnType<typeof shop>>, store: FakeShopifyStore, subscription: FakeSubscription, extra: { now?: Date; deps?: Partial<BillingDeps> } = {}) {
  const now = extra.now ?? new Date();
  const deps: BillingDeps = { prisma: app, settings: PARTNER_SETTINGS, required: true, fetchImpl: fakePartnerApi(subscription).fetchImpl, now: () => now, ...extra.deps };
  return loadPlanPage({ admin: store.asAdmin(), shop: s, billing: getBillingStatus(deps, s), welcome: false, now }, app);
}

const used = (shopId: string, chars: number, at = new Date()) =>
  withTenant(shopId, (tx) => tx.usageLedger.create({ data: { shopId, periodKey: periodKey(at), kind: "RESERVE", chars, provider: "mock", idempotencyKey: `seed-${++n}`, createdAt: at } }), app);

describe("the store's languages", () => {
  it("marks the languages the plan covers, in the order enforcement uses, and the room Shopify has left", async () => {
    const s = await shop();
    const store = new FakeShopifyStore(1);
    store.locales = [
      { locale: "en", name: "English", primary: true, published: true },
      { locale: "de", name: "German", primary: false, published: true },
      { locale: "fr", name: "French", primary: false, published: true },
      { locale: "nl", name: "Dutch", primary: false, published: false },
      { locale: "da", name: "Danish", primary: false, published: true },
    ];
    const data = await page(s, store, { handle: "starter" });
    expect(data.languages).toEqual({
      primary: "en",
      primaryName: "English",
      shopifyRoom: MAX_ENABLED_LOCALES - 5,
      // Sorted by name; Starter's three are the first three (allowedTargetLocales).
      items: [
        { locale: "da", name: "Danish", published: true, inPlan: true },
        { locale: "nl", name: "Dutch", published: false, inPlan: true },
        { locale: "fr", name: "French", published: true, inPlan: true },
        { locale: "de", name: "German", published: true, inPlan: false },
      ],
    });
    // Hidden languages count too: four languages need Pro.
    expect(data.use).toMatchObject({ languages: 4 });
    expect(recommendPlan(data.use!)).toEqual({ plan: "pro", reasons: ["languages"] });
  });

  it("renders without them when Shopify doesn't answer, with no recommendation", async () => {
    const s = await shop();
    const store = new FakeShopifyStore(1);
    store.failNext = { count: 1, error: () => new Error("Shopify is down") };
    const data = await page(s, store, { handle: "pro" });
    expect(data).toMatchObject({ state: "ACTIVE", languages: null, use: null, entitlements: PLANS.pro });
  });

  it("passes Shopify's re-authentication answer on instead of hiding it", async () => {
    const s = await shop();
    const store = new FakeShopifyStore(1);
    const reauth = new Response(null, { status: 401, headers: { "X-Shopify-API-Request-Failure-Reauthorize": "1" } });
    store.failNext = { count: 1, error: () => reauth as unknown as Error };
    // The billing check is done first, so nothing still writes when the test ends.
    const billing = await getBillingStatus({ prisma: app, settings: PARTNER_SETTINGS, required: true, fetchImpl: fakePartnerApi({ handle: "pro" }).fetchImpl }, s);
    await expect(loadPlanPage({ admin: store.asAdmin(), shop: s, billing: Promise.resolve(billing), welcome: false }, app)).rejects.toBe(reauth);
  });
});

describe("the allowance and when it renews", () => {
  it("shows the plan's enforced limits, never the platform cap", async () => {
    vi.stubEnv("AI_DAILY_CHAR_LIMIT", "1000000");
    resetConfigCache();
    const s = await shop();
    const data = await page(s, new FakeShopifyStore(1), { handle: "pro" });
    expect(data.limits).toEqual({ limit: PLANS.pro.monthlyChars, dailyLimit: 1_000_000 });
    expect(data.limits).not.toHaveProperty("platformDailyLimit");
    expect(data.costPerMillion).toBeNull();
  });

  it("shows the trial's allowance while the trial runs, and the plan's afterwards", async () => {
    const s = await shop();
    const now = new Date("2026-10-30T09:00:00Z");
    const trialEndsAt = new Date(now.getTime() + 6 * DAY);
    const trial = await page(s, new FakeShopifyStore(1), { handle: "business", trialEndsAt: trialEndsAt.toISOString() }, { now });
    expect(trial.entitlements).toEqual({ ...PLANS.business, monthlyChars: TRIAL_AI_CHARS });
    expect(trial.limits.limit).toBe(TRIAL_AI_CHARS);
    expect(trial.subscription).toMatchObject({ planHandle: "business", trialEndsAt: trialEndsAt.toISOString() });

    const after = new Date(trialEndsAt.getTime() + DAY);
    const s2 = await shop();
    const paid = await page(s2, new FakeShopifyStore(1), { handle: "business", trialEndsAt: trialEndsAt.toISOString() }, { now: after });
    expect(paid.entitlements).toEqual(PLANS.business);
    expect(paid.limits.limit).toBe(PLANS.business.monthlyChars);
  });

  it("counts the UTC month and renews on the first of the next one", async () => {
    const s = await shop();
    const now = new Date("2026-10-31T23:30:00Z");
    await used(s.id, 1_234, now);
    await used(s.id, 99_999, new Date("2026-09-30T23:59:00Z"));
    const data = await page(s, new FakeShopifyStore(1), { handle: "starter" }, { now });
    expect(data.usage.month).toBe(1_234);
    expect(data.now).toBe(now.toISOString());
    expect(data.resetsOn).toBe("2026-11-01T00:00:00.000Z");
  });

  it("links the plan buttons to Shopify's plan page only when billing is set up", async () => {
    vi.stubEnv("SHOPIFY_APP_HANDLE", "linguva");
    resetConfigCache();
    const s = await shop();
    const on = await page(s, new FakeShopifyStore(1), null);
    expect(on).toMatchObject({ configured: true, state: "NONE", choosePlanUrl: `https://admin.shopify.com/store/${s.shopDomain.replace(".myshopify.com", "")}/charges/linguva/pricing_plans` });
    const s2 = await shop();
    const off = await page(s2, new FakeShopifyStore(1), null, { deps: { settings: null } });
    expect(off).toMatchObject({ configured: false, state: "ACTIVE", choosePlanUrl: null });
  });
});

describe("what the store uses", () => {
  async function switchedOn(shopId: string, at: Date) {
    await withTenant(
      shopId,
      async (tx) => {
        await tx.shopSettings.upsert({
          where: { shopId },
          create: { shopId, autoTranslateNew: true, bulkPublishMode: "AUTO_PUBLISH" },
          update: { autoTranslateNew: true, bulkPublishMode: "AUTO_PUBLISH" },
        });
        await tx.smartAutoConfig.create({ data: { shopId, enabled: true } });
        await tx.translationJob.create({ data: { shopId, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: `job-${++n}`, createdAt: at } });
      },
      app,
    );
  }

  it("reads the store's own switches and jobs, never another store's", async () => {
    const now = new Date();
    const busy = await shop();
    const quiet = await shop();
    await switchedOn(busy.id, new Date(now.getTime() - DAY));
    await used(busy.id, 50_000, now);
    expect((await page(busy, new FakeShopifyStore(1), { handle: "pro" }, { now })).use).toEqual({
      languages: 1,
      monthChars: 50_000,
      bulk: true,
      auto: true,
      autoPublish: true,
      smart: true,
    });
    expect((await page(quiet, new FakeShopifyStore(1), { handle: "pro" }, { now })).use).toEqual({
      languages: 1,
      monthChars: 0,
      bulk: false,
      auto: false,
      autoPublish: false,
      smart: false,
    });
  });

  it("counts only the store's own bulk jobs of the last 30 days, not the smart schedule's", async () => {
    const now = new Date();
    const s = await shop();
    await withTenant(
      s.id,
      async (tx) => {
        await tx.translationJob.create({ data: { shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "old", createdAt: new Date(now.getTime() - 31 * DAY) } });
        const run = await tx.smartAutoRun.create({ data: { shopId: s.id, trigger: "SCHEDULED", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [] } });
        await tx.translationJob.create({ data: { shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "smart", smartRunId: run.id, createdAt: now } });
      },
      app,
    );
    expect((await page(s, new FakeShopifyStore(1), { handle: "starter" }, { now })).use).toMatchObject({ bulk: false });
  });

  it("doesn't count the app's own automatic jobs as the store translating whole areas at once", async () => {
    const now = new Date();
    const s = await shop();
    // Automatic translation of new content and the smart schedule's real-time mode run jobs of their
    // own (without a run); both were switched off since. Nothing else is used: Free is enough.
    await withTenant(
      s.id,
      async (tx) => {
        await tx.translationJob.create({ data: { shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: AUTO_REQUESTED_BY, idempotencyKey: "auto", createdAt: now } });
        await tx.translationJob.create({ data: { shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: SMART_REQUESTED_BY, idempotencyKey: "realtime", createdAt: now } });
      },
      app,
    );
    const quiet = await page(s, new FakeShopifyStore(1), { handle: "starter" }, { now });
    expect(quiet.use).toMatchObject({ bulk: false, auto: false, smart: false });
    expect(recommendPlan(quiet.use!)).toEqual({ plan: "free", reasons: [] });

    // A job the merchant started counts, also one without a signed-in user (an offline session).
    for (const requestedBy of ["7", null]) {
      const own = await shop();
      await withTenant(own.id, (tx) => tx.translationJob.create({ data: { shopId: own.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy, idempotencyKey: "own", createdAt: now } }), app);
      expect((await page(own, new FakeShopifyStore(1), { handle: "starter" }, { now })).use, String(requestedBy)).toMatchObject({ bulk: true });
    }
  });

  it("is left out without AI translation: nothing to recommend", async () => {
    vi.stubEnv("TRANSLATION_PROVIDER", "deepl");
    vi.stubEnv("DEEPL_API_KEY", "");
    resetConfigCache();
    const s = await shop();
    const data = await page(s, new FakeShopifyStore(1), { handle: "starter" });
    expect(data).toMatchObject({ aiAvailable: false, use: null });
    expect(data.languages?.items).toHaveLength(1);
  });
});
