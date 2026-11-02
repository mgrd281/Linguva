import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // The editor's AI translation needs a provider: the mock one (no network).
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { grantComplimentaryAccess } from "../../app/.server/billing/complimentary";
import { ensureShopGid, getBillingStatus, SUBSCRIPTION_TTL_MS, type BillingDeps } from "../../app/.server/billing/subscription";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { listPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import { periodKey, QuotaExceededError } from "../../app/.server/usage/usage-ledger";
import { PLANS, TRIAL_AI_CHARS, type Entitlements } from "../../app/lib/plans";
import * as plans from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
let n = 0;

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function shop(domain = "billing.myshopify.com") {
  const { shop } = await upsertInstalledShop({ shopDomain: domain, shopifyShopGid: `gid://shopify/Shop/${++n}` }, app);
  return shop;
}

function deps(api: ReturnType<typeof fakePartnerApi>, extra: Partial<BillingDeps> = {}): BillingDeps {
  return { prisma: app, settings: PARTNER_SETTINGS, required: true, fetchImpl: api.fetchImpl, ...extra };
}

describe("subscription status", () => {
  it("is unmetered while billing isn't configured", async () => {
    const s = await shop();
    const status = await getBillingStatus({ prisma: app, settings: null, required: true }, s);
    expect(status).toMatchObject({ configured: false, state: "ACTIVE", mustChoosePlan: false, entitlements: { plan: "unmetered" } });
  });

  it("uses the plan's entitlements and the cache until the TTL passes", async () => {
    const s = await shop();
    const api = fakePartnerApi({ handle: "pro" });
    let now = new Date("2026-10-28T10:00:00Z");
    const d = deps(api, { now: () => now });
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "ACTIVE", entitlements: PLANS.pro, mustChoosePlan: false });
    await getBillingStatus(d, s);
    expect(api.calls).toHaveLength(1);

    api.set({ handle: "starter" });
    now = new Date(now.getTime() + SUBSCRIPTION_TTL_MS + 1);
    expect((await getBillingStatus(d, s)).entitlements.plan).toBe("starter");
    expect(api.calls).toHaveLength(2);
    // The welcome link forces a fresh check.
    api.set({ handle: "business" });
    expect((await getBillingStatus(d, s, { force: true })).entitlements.plan).toBe("business");
  });

  it("sends a shop without a subscription to the plan page only when billing is required", async () => {
    const s = await shop();
    expect(await getBillingStatus(deps(fakePartnerApi(null)), s)).toMatchObject({ state: "NONE", mustChoosePlan: true, entitlements: PLANS.free });
    expect(await getBillingStatus(deps(fakePartnerApi(null), { required: false }), s, { force: true })).toMatchObject({
      state: "NONE",
      mustChoosePlan: false,
      entitlements: PLANS.free,
    });
  });

  it("never locks out a paying shop because the Partner API failed", async () => {
    const s = await shop();
    const api = fakePartnerApi({ handle: "pro" });
    let now = new Date("2026-10-28T10:00:00Z");
    const d = deps(api, { now: () => now });
    await getBillingStatus(d, s);
    for (const failure of [{ status: 500 }, { status: 429 }, new TypeError("network down")]) {
      api.set(failure);
      now = new Date(now.getTime() + SUBSCRIPTION_TTL_MS + 1);
      expect(await getBillingStatus(d, s)).toMatchObject({ state: "ACTIVE", stale: true, mustChoosePlan: false, entitlements: PLANS.pro });
    }
    // Never checked successfully: free plan, but no redirect.
    const fresh = await shop("never-checked.myshopify.com");
    expect(await getBillingStatus(deps(fakePartnerApi({ status: 503 })), fresh)).toMatchObject({
      state: "UNKNOWN",
      mustChoosePlan: false,
      entitlements: PLANS.free,
    });
  });

  it("stores trial, cancellation and pending plan; unknown handles get the free plan", async () => {
    const s = await shop();
    const status = await getBillingStatus(
      deps(fakePartnerApi({ handle: "pro", trialEndsAt: "2026-11-05T00:00:00Z", cancelAtEndOfCycle: true, pendingHandle: "starter" })),
      s,
    );
    expect(status.subscription).toMatchObject({ planHandle: "pro", pendingPlanHandle: "starter", cancelAtEndOfCycle: true });
    expect(status.subscription!.trialEndsAt!.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect((await getBillingStatus(deps(fakePartnerApi({ handle: "mystery" })), s, { force: true })).entitlements).toEqual(PLANS.free);
  });

  it("stores the shop GID on first use", async () => {
    const { shop: s } = await upsertInstalledShop({ shopDomain: "gid.myshopify.com" }, app);
    const admin = { graphql: async () => Response.json({ data: { shop: { id: "gid://shopify/Shop/777" } } }) };
    expect(await ensureShopGid(admin as never, s, app)).toBe("gid://shopify/Shop/777");
    expect((await app.shop.findUniqueOrThrow({ where: { id: s.id } })).shopifyShopGid).toBe("gid://shopify/Shop/777");
  });

  it("keeps each shop's subscription private (RLS)", async () => {
    const a = await shop("sub-a.myshopify.com");
    const b = await shop("sub-b.myshopify.com");
    await getBillingStatus(deps(fakePartnerApi({ handle: "business" })), a);
    expect(await withTenant(b.id, (tx) => tx.shopSubscription.count(), app)).toBe(0);
    expect(await app.shopSubscription.count()).toBe(0);
    expect(await withTenant(a.id, (tx) => tx.shopSubscription.count(), app)).toBe(1);
  });
});

describe("uninstall and reinstall (App Store requirement 1.2.2)", () => {
  /**
   * A Pro store, uninstalled (Shopify cancels the subscription then) and
   * installed again an hour later, well inside the 6-hour cache.
   */
  async function reinstalledProStore(extra: Partial<BillingDeps> = {}) {
    const s = await shop("reinstall.myshopify.com");
    const api = fakePartnerApi({ handle: "pro" });
    let now = new Date("2026-10-30T09:00:00Z");
    const d = deps(api, { now: () => now, ...extra });
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "ACTIVE", entitlements: PLANS.pro });
    await markShopUninstalled(s.shopDomain, app);
    now = new Date(now.getTime() + 60 * 60_000);
    const { event, shop: again } = await upsertInstalledShop({ shopDomain: s.shopDomain, shopifyShopGid: s.shopifyShopGid }, app);
    expect(event).toBe("REINSTALLED");
    return { s: again, api, d };
  }

  it("asks Shopify again, and sends a store without a plan back to the plan page", async () => {
    const { s, api, d } = await reinstalledProStore();
    api.set(null);
    // The way the app's layout loads it: no forced check.
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "NONE", entitlements: PLANS.free, mustChoosePlan: true });
    expect(api.calls).toHaveLength(2);
  });

  it("gives the plan Shopify reports after the reinstall", async () => {
    const { s, api, d } = await reinstalledProStore();
    api.set({ handle: "starter" });
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "ACTIVE", entitlements: PLANS.starter, mustChoosePlan: false });
    expect(api.calls).toHaveLength(2);
  });

  it("never gives back the cancelled plan when Shopify can't be asked", async () => {
    const { s, api, d } = await reinstalledProStore();
    api.set({ status: 503 });
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "NONE", entitlements: PLANS.free, mustChoosePlan: true });
    // Plans not required: Free, and nobody is sent anywhere.
    expect(await getBillingStatus({ ...d, required: false }, s)).toMatchObject({ state: "NONE", entitlements: PLANS.free, mustChoosePlan: false });
    // A failed check leaves the reset in place: the next one asks again.
    api.set({ handle: "pro" });
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "ACTIVE", entitlements: PLANS.pro });
  });

  it("asks again after a reinstall even when the plan was cached after the uninstall", async () => {
    // For example an uninstall recorded before the reset existed.
    const s = await shop("reinstall-old.myshopify.com");
    const api = fakePartnerApi({ handle: "business" });
    const d = deps(api);
    await getBillingStatus(d, s);
    await markShopUninstalled(s.shopDomain, app);
    await withTenant(s.id, (tx) => tx.shopSubscription.update({ where: { shopId: s.id }, data: { state: "ACTIVE", planHandle: "business", checkedAt: new Date() } }), app);
    await upsertInstalledShop({ shopDomain: s.shopDomain }, app);
    api.set(null);
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "NONE", entitlements: PLANS.free, mustChoosePlan: true });
    expect(api.calls).toHaveLength(2);
  });

  it("keeps owner complimentary access across a reinstall", async () => {
    const s = await shop("reinstall-own.myshopify.com");
    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: s.shopifyShopGid!, reason: "Own store", operator: "owner" });
    const d = deps(fakePartnerApi(null), { complimentaryGids: [s.shopifyShopGid!] });
    await markShopUninstalled(s.shopDomain, app);
    await upsertInstalledShop({ shopDomain: s.shopDomain }, app);
    expect(await getBillingStatus(d, s)).toMatchObject({ state: "COMPLIMENTARY", mustChoosePlan: false });
  });

  it("leaves a store that was never checked without a row", async () => {
    const s = await shop("reinstall-new.myshopify.com");
    await markShopUninstalled(s.shopDomain, app);
    await upsertInstalledShop({ shopDomain: s.shopDomain }, app);
    expect(await withTenant(s.id, (tx) => tx.shopSubscription.count(), app)).toBe(0);
  });
});

describe("plans in bulk jobs and the editor", () => {
  async function bulkSetup(entitlements: Entitlements) {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    await setBulkPublishMode({ shopId: s.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const store = new FakeShopifyStore(3);
    const d: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 1_000_000,
      keyPrefix: "lv:test:billing",
      billingFor: async () => ({ configured: true, entitlements }),
    };
    const { job } = await createBulkJob({ shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `b-${++n}` }, app);
    const page = await runDiscoveryPage(d, { shopId: s.id, jobId: job.id });
    return { s, store, d, items: page.itemIds };
  }

  it("stops a bulk job when the plan doesn't include bulk translation", async () => {
    const { s, d, items, store } = await bulkSetup(PLANS.free);
    await expect(processItem(d, { shopId: s.id, itemId: items[0]! }, 1)).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
  });

  it("uses the plan's monthly allowance, not the environment default", async () => {
    // About one product's worth of text.
    const { s, d, items } = await bulkSetup({ ...PLANS.starter, monthlyChars: 60 });
    await processItem(d, { shopId: s.id, itemId: items[0]! }, 1);
    await expect(processItem(d, { shopId: s.id, itemId: items[1]! }, 1)).rejects.toMatchObject({ scope: "monthly", limit: 60 });
  });

  it("creates drafts instead of publishing when the plan has no automatic publishing", async () => {
    const { s, d, items, store } = await bulkSetup(PLANS.starter);
    for (const id of items) await processItem(d, { shopId: s.id, itemId: id }, 1);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect((await listPendingDrafts(s.id, {}, app)).length).toBe(6);
  });

  it("limits AI translation in the editor to the plan's languages", async () => {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    const store = new FakeShopifyStore(1);
    const ctx = (locale: string): EditorContext => ({
      admin: store.asAdmin(),
      shopId: s.id,
      actorId: "1",
      kind: "PRODUCT",
      resourceId: "gid://shopify/Product/1",
      target: { locale, name: locale, rtl: false },
      sourceName: "English",
      billing: { configured: true, state: "ACTIVE", entitlements: PLANS.free, subscription: null, stale: false, mustChoosePlan: false },
      targetLocales: ["de", "fr"],
    });
    const form = new FormData();
    form.set("intent", "ai-translate");
    form.append("key", "title");
    expect(await runEditorAction(ctx("fr"), form)).toEqual({ kind: "error", code: "PLAN_LANGUAGE" });
  });
});

describe("refresh throttle (minAgeMs)", () => {
  it("reuses a successful check younger than minAgeMs, asks Shopify for an older one, and always with force alone", async () => {
    const s = await shop();
    const api = fakePartnerApi({ handle: "pro" });
    let now = new Date("2026-10-30T09:00:00Z");
    const d = deps(api, { now: () => now });
    await getBillingStatus(d, s);
    expect(api.calls).toHaveLength(1);

    now = new Date(now.getTime() + 10_000);
    expect(await getBillingStatus(d, s, { force: true, minAgeMs: 30_000 })).toMatchObject({ state: "ACTIVE", stale: false, entitlements: PLANS.pro });
    expect(api.calls).toHaveLength(1);

    now = new Date(now.getTime() + 21_000);
    api.set({ handle: "business" });
    expect((await getBillingStatus(d, s, { force: true, minAgeMs: 30_000 })).entitlements.plan).toBe("business");
    expect(api.calls).toHaveLength(2);

    // Without minAgeMs, force always asks (the welcome link).
    await getBillingStatus(d, s, { force: true });
    expect(api.calls).toHaveLength(3);
  });

  it("never turns a failed check into 'no plan': the last known state or UNKNOWN, and the next click asks again", async () => {
    const s = await shop();
    const api = fakePartnerApi({ handle: "starter" });
    let now = new Date("2026-10-30T09:00:00Z");
    const d = deps(api, { now: () => now });
    await getBillingStatus(d, s);
    api.set({ status: 503 });
    now = new Date(now.getTime() + 31_000);
    expect(await getBillingStatus(d, s, { force: true, minAgeMs: 30_000 })).toMatchObject({ state: "ACTIVE", stale: true, entitlements: PLANS.starter });
    // A failure doesn't update checkedAt: the next refresh asks Shopify again.
    now = new Date(now.getTime() + 1_000);
    await getBillingStatus(d, s, { force: true, minAgeMs: 30_000 });
    expect(api.calls).toHaveLength(3);

    const never = await shop("never-answered.myshopify.com");
    expect(await getBillingStatus(deps(fakePartnerApi({ status: 503 })), never, { force: true, minAgeMs: 30_000 })).toMatchObject({
      state: "UNKNOWN",
      entitlements: PLANS.free,
      mustChoosePlan: false,
    });
  });
});

describe("trial allowance (docs/PRICING_DECISION.md §10.2)", () => {
  const HOUR = 3_600_000;

  /** AI characters this shop already used this month (not on the platform's daily counter). */
  async function usedThisMonth(shopId: string, chars: number) {
    await withTenant(
      shopId,
      (tx) => tx.usageLedger.create({ data: { shopId, periodKey: periodKey(), kind: "RESERVE", chars, provider: "mock", idempotencyKey: "seed-month" } }),
      app,
    );
  }

  async function trialShop() {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    // The trial ends in two hours; the next check would be in six.
    let now = new Date();
    const api = fakePartnerApi({ handle: "pro", trialEndsAt: new Date(now.getTime() + 2 * HOUR).toISOString() });
    const d = deps(api, { now: () => now });
    return { s, api, d, later: () => (now = new Date(now.getTime() + 3 * HOUR)) };
  }

  const editor = (shopId: string, store: FakeShopifyStore, billing: EditorContext["billing"]): EditorContext => ({
    admin: store.asAdmin(),
    shopId,
    actorId: "1",
    kind: "PRODUCT",
    resourceId: "gid://shopify/Product/1",
    target: { locale: "de", name: "German", rtl: false },
    sourceName: "English",
    billing,
    targetLocales: ["de"],
  });
  const aiTranslate = () => {
    const form = new FormData();
    form.set("intent", "ai-translate");
    form.append("key", "title");
    return form;
  };

  it("refuses editor AI above the trial allowance, and gives the plan's allowance once the trial is over, without a new check", async () => {
    const { s, api, d, later } = await trialShop();
    await usedThisMonth(s.id, TRIAL_AI_CHARS - 5);
    const store = new FakeShopifyStore(1);

    const trial = await getBillingStatus(d, s);
    expect(trial.entitlements).toEqual({ ...PLANS.pro, monthlyChars: TRIAL_AI_CHARS });
    expect(await runEditorAction(editor(s.id, store, trial), aiTranslate())).toEqual({ kind: "error", code: "QUOTA_EXCEEDED" });

    later();
    const after = await getBillingStatus(d, s);
    expect(api.calls).toHaveLength(1);
    expect(after.entitlements).toEqual(PLANS.pro);
    expect(after.trialEndsAt).toBeUndefined();
    expect(await runEditorAction(editor(s.id, store, after), aiTranslate())).toMatchObject({ kind: "ai", drafts: { title: "[de] Product 1 jacket" } });
  });

  it("stops a bulk job at the trial allowance; after the trial it continues", async () => {
    const { s, d, later } = await trialShop();
    await usedThisMonth(s.id, TRIAL_AI_CHARS - 5);
    const store = new FakeShopifyStore(2);
    const jobs: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 10_000_000,
      keyPrefix: "lv:test:trial",
      billingFor: (shopId) => getBillingStatus(d, { id: shopId, shopifyShopGid: s.shopifyShopGid }),
    };
    const { job } = await createBulkJob({ shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `trial-${++n}` }, app);
    const page = await runDiscoveryPage(jobs, { shopId: s.id, jobId: job.id });
    const stop = await processItem(jobs, { shopId: s.id, itemId: page.itemIds[0]! }, 1).catch((e) => e);
    expect(stop).toBeInstanceOf(QuotaExceededError);
    expect(stop).toMatchObject({ scope: "monthly", limit: TRIAL_AI_CHARS });

    // The same item, resumed after the trial: the plan's allowance applies (results wait as drafts).
    later();
    expect(await processItem(jobs, { shopId: s.id, itemId: page.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await listPendingDrafts(s.id, {}, app)).length).toBeGreaterThan(0);
  });
});

describe("the Own key plan's subscription", () => {
  it("gives the Own key entitlements through the Partner API and the cache (with OWN_KEY_PLAN_VISIBLE unset: it never decides them)", async () => {
    const s = await shop("ownkey-billing.myshopify.com");
    const api = fakePartnerApi({ handle: "own-key" });
    let now = new Date("2026-10-28T10:00:00Z");
    const d = deps(api, { now: () => now });
    const fresh = await getBillingStatus(d, s);
    expect(fresh).toMatchObject({ configured: true, state: "ACTIVE", mustChoosePlan: false, subscription: { planHandle: "own-key" } });
    expect(fresh.entitlements).toEqual(plans.OWN_KEY_PLAN);
    // From the cache (no second call), and as the last known state when the Partner API fails.
    expect((await getBillingStatus(d, s)).entitlements).toEqual(plans.OWN_KEY_PLAN);
    expect(api.calls).toHaveLength(1);
    api.set({ status: 503 });
    now = new Date(now.getTime() + SUBSCRIPTION_TTL_MS + 1);
    expect(await getBillingStatus(d, s)).toMatchObject({ stale: true, entitlements: { plan: "own-key", ownKeys: true } });
    // An alias handle is the same plan.
    api.set({ handle: "own_key" });
    expect((await getBillingStatus(d, s, { force: true })).entitlements).toEqual(plans.OWN_KEY_PLAN);
  });

  it("keeps today's plan during a pending change to Own key, and Free for a look-alike handle", async () => {
    const s = await shop("ownkey-pending.myshopify.com");
    const pending = await getBillingStatus(deps(fakePartnerApi({ handle: "pro", pendingHandle: "own-key" })), s);
    expect(pending.entitlements).toEqual(PLANS.pro);
    expect(pending.subscription).toMatchObject({ planHandle: "pro", pendingPlanHandle: "own-key" });
    expect(plans.usesOwnKeys(pending.entitlements)).toBe(false);
    expect((await getBillingStatus(deps(fakePartnerApi({ handle: "Own-Key" })), s, { force: true })).entitlements).toEqual(PLANS.free);
  });

  it("never reaches own keys with billing off or with complimentary access (which wins over any plan)", async () => {
    const s = await shop("ownkey-comp.myshopify.com");
    const off = await getBillingStatus({ prisma: app, settings: null, required: true }, s);
    expect(off.entitlements).toMatchObject({ plan: "unmetered" });
    expect(Object.hasOwn(off.entitlements, "ownKeys")).toBe(false);
    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: s.shopifyShopGid!, reason: "Own store", operator: "owner" });
    const complimentary = await getBillingStatus(deps(fakePartnerApi({ handle: "own-key" }), { complimentaryGids: [s.shopifyShopGid!] }), s);
    expect(complimentary.state).toBe("COMPLIMENTARY");
    expect(Object.hasOwn(complimentary.entitlements, "ownKeys")).toBe(false);
  });
});
