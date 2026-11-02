/**
 * The Plan page's and the Overview's data on the Own key plan
 * (app/.server/billing/plan-page.ts, app/.server/overview/overview.ts):
 * the Own key card shows by the flag and always to its subscriber or a
 * store changing to it (every handle of OWN_KEY_HANDLES), no "Fits your
 * store" for a subscriber, its keys' engines and usage; the Overview asks
 * for the key before the permission, never says "used up", and hands the
 * page the keys (a problem key's banner, the pending change's date).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanPage } from "../../app/.server/billing/plan-page";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { markEngineKey } from "../../app/.server/credentials/store";
import { resetConfigCache } from "../../app/.server/lib/config";
import { loadOverview } from "../../app/.server/overview/overview";
import { ownKeysForOverview, shopTranslationFacts } from "../../app/.server/providers/shop-translation";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { periodKey } from "../../app/.server/usage/usage-ledger";
import { OWN_KEY_PLAN, OWN_KEY_PRICE, PLANS } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const DEEPL_KEY = ["mock", "plan", "4711"].join("-") + ":fx";

const sub = (planHandle: string, pendingPlanHandle: string | null = null) => ({
  shopId: "",
  state: "ACTIVE" as const,
  planHandle,
  pendingPlanHandle,
  billingPeriod: "EVERY_30_DAYS",
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: new Date("2026-11-28T00:00:00.000Z"),
  checkedAt: new Date(),
  updatedAt: new Date(),
});
const billing = (planHandle: string, pendingPlanHandle: string | null = null): BillingStatus => ({
  configured: true,
  state: "ACTIVE",
  entitlements: planHandle === "pro" ? PLANS.pro : OWN_KEY_PLAN,
  subscription: sub(planHandle, pendingPlanHandle),
  stale: false,
  mustChoosePlan: false,
});

let n = 0;
const newShop = async () => (await upsertInstalledShop({ shopDomain: `own-plan-${++n}.myshopify.com`, name: "Own Plan" }, app)).shop;
const plan = (shop: { id: string; shopDomain: string }, status: BillingStatus) =>
  loadPlanPage({ admin: new FakeShopifyStore(2).asAdmin(), shop, billing: Promise.resolve(status), welcome: false }, app);

async function overview(shop: Awaited<ReturnType<typeof newShop>>, status: BillingStatus) {
  const facts = await shopTranslationFacts(shop.id, status, { client: app });
  return loadOverview(new FakeShopifyStore(2).asAdmin(), shop, app, {
    // No measuring step first (no background jobs here).
    jobsAvailable: false,
    billing: status,
    aiAvailable: facts.available,
    consent: { configured: facts.configured, payer: facts.payer },
    ownKeys: await ownKeysForOverview(shop.id, facts, status, app),
  });
}

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("TRANSLATION_PROVIDER", "mock");
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("the Plan page's Own key data", () => {
  it("flag off, Pro: hidden; flag on: shown; the rest as before", async () => {
    const shop = await newShop();
    const pro = billing("pro");
    const off = await plan(shop, pro);
    expect(off.ownKeyPlan).toEqual({ visible: false, current: false, pending: false, choosePlanUrl: off.choosePlanUrl, price: OWN_KEY_PRICE });
    expect(off.ownKeys).toBeNull();
    expect(off.use).not.toBeNull();
    vi.stubEnv("OWN_KEY_PLAN_VISIBLE", "on");
    resetConfigCache();
    const on = await plan(shop, pro);
    expect(on.ownKeyPlan).toMatchObject({ visible: true, current: false, pending: false });
    expect({ ...on, ownKeyPlan: null, now: null }).toEqual({ ...off, ownKeyPlan: null, now: null });
  });

  it("a subscriber sees its card with the flag off, for every handle; no 'Fits your store'; its keys and usage", async () => {
    for (const handle of ["own-key", "ownkey", "own-key-test"]) {
      const shop = await newShop();
      const page = await plan(shop, billing(handle));
      expect(page.ownKeyPlan, handle).toMatchObject({ visible: true, current: true, pending: false });
      expect(page.use, handle).toBeNull();
      expect(page.ownKeys, handle).toEqual({ keys: [], usage: { total: 0, byEngine: {} } });
    }
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: DEEPL_KEY }, { client: app, mode: "mock" });
    await withTenant(
      shop.id,
      (tx) => tx.usageLedger.create({ data: { shopId: shop.id, periodKey: periodKey(), kind: "RESERVE", chars: 900, provider: "deepl", payer: "merchant", idempotencyKey: "own-plan-1" } }),
      app,
    );
    const page = await plan(shop, billing("own-key"));
    expect(page.ownKeys).toEqual({ keys: [expect.objectContaining({ engine: "deepl", hint: "4711", status: "OK" })], usage: { total: 900, byEngine: { deepl: 900 } } });
    expect(page.aiAvailable).toBe(true);
    expect(JSON.stringify(page)).not.toContain("plan-4711");
  });

  it("a pending change to Own key: the card shows, marked pending", async () => {
    const page = await plan(await newShop(), billing("pro", "own-key"));
    expect(page.ownKeyPlan).toMatchObject({ visible: true, current: false, pending: true });
    expect(page.ownKeys).toBeNull();
  });
});

describe("the Overview on Own key", () => {
  it("without a key: the key is the next step, never 'used up', no allowance", async () => {
    const shop = await newShop();
    const page = await overview(shop, billing("own-key"));
    expect(page.next).toEqual({ id: "own-key" });
    expect(page.usage.level).toBe("ok");
    expect(page.ownKeys).toEqual({ access: "plan", keys: [], startsOn: null });
    expect(page.aiAvailable).toBe(false);
  });

  it("a refused key: the page gets its summary (the banner's job message); a usable key: no key step", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: DEEPL_KEY }, { client: app, mode: "mock" });
    expect((await overview(shop, billing("own-key"))).next?.id).not.toBe("own-key");
    const row = await withTenant(shop.id, (tx) => tx.shopEngineCredential.findFirstOrThrow({ select: { id: true, keyVersion: true } }), app);
    await markEngineKey({ id: row.id, shopId: shop.id, keyVersion: row.keyVersion }, { status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL", lastErrorAt: new Date() }, app);
    const page = await overview(shop, billing("own-key"));
    expect(page.ownKeys?.keys).toEqual([expect.objectContaining({ engine: "deepl", status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL", hint: "4711" })]);
    expect(page.next).toEqual({ id: "own-key" });
    expect(JSON.stringify(page)).not.toContain("plan-4711");
  });

  it("a key set to RECHECK after a restore isn't used: the page gets its summary (the banner) and asks for the key again", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: DEEPL_KEY }, { client: app, mode: "mock" });
    const row = await withTenant(shop.id, (tx) => tx.shopEngineCredential.findFirstOrThrow({ select: { id: true, keyVersion: true } }), app);
    await markEngineKey({ id: row.id, shopId: shop.id, keyVersion: row.keyVersion }, { status: "RECHECK", lastErrorCode: "OWN_KEY_RECHECK", lastErrorAt: new Date() }, app);
    const page = await overview(shop, billing("own-key"));
    expect(page.ownKeys?.keys).toEqual([expect.objectContaining({ engine: "deepl", status: "RECHECK", lastErrorCode: "OWN_KEY_RECHECK" })]);
    expect(page.aiAvailable).toBe(false);
    expect(page.next).toEqual({ id: "own-key" });
  });

  it("a pending change without a key: the date it starts, and Pro's usage as before", async () => {
    const shop = await newShop();
    const page = await overview(shop, billing("pro", "own-key"));
    expect(page.ownKeys).toEqual({ access: "pending", keys: [], startsOn: "2026-11-28T00:00:00.000Z" });
    expect(page.next?.id).not.toBe("own-key");
    expect(page.usage.limit).toBe(PLANS.pro.monthlyChars);
    expect(page.usage).not.toHaveProperty("ownKey");
  });

  it("Pro without keys: no own-key data at all", async () => {
    const page = await overview(await newShop(), billing("pro"));
    expect(page.ownKeys).toBeNull();
    expect(page.usage).not.toHaveProperty("ownKey");
  });
});
