/**
 * Settings on the Own key plan (app/routes/app.settings.tsx), its loader and
 * action called as functions with the session and billing stood in: no key
 * ever comes back (not in the page's data, not in any action's answer, not
 * even five characters of it), the key intents reach their handlers (not the
 * `{ ok: false }` guard), a forged save on another plan is refused before
 * anything else, a pending change to Own key manages keys with the date it
 * starts, every other shop gets `ownKeys: null` and today's data otherwise,
 * and a pause about Linguva's limits doesn't hold an Own key shop.
 * Mock mode (NODE_ENV=test): only test keys, no engine is ever called.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stand = vi.hoisted(() => ({
  shop: null as null | { id: string; shopDomain: string; name: string | null },
  admin: null as unknown,
  billing: null as unknown,
}));
vi.mock("../../app/.server/shopify/require-shop", () => ({
  requireShop: async () => ({ admin: stand.admin, shop: stand.shop, actorId: "42", session: {}, redirect: () => null, scopes: {} }),
}));
vi.mock("../../app/.server/billing/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/billing/billing")>()),
  shopBilling: async () => stand.billing,
}));

import { PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { resetConfigCache } from "../../app/.server/lib/config";
import { resetQueueClient } from "../../app/.server/queue/client";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { OWN_KEY_PLAN, PLANS } from "../../app/lib/plans";
import { action, loader } from "../../app/routes/app.settings";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const subscription = (planHandle: string, pendingPlanHandle: string | null = null) => ({
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
const billingOf = (entitlements: BillingStatus["entitlements"], sub: ReturnType<typeof subscription>): BillingStatus => ({
  configured: true,
  state: "ACTIVE",
  entitlements,
  subscription: sub,
  stale: false,
  mustChoosePlan: false,
});
const OWN = billingOf(OWN_KEY_PLAN, subscription("own-key"));
const PRO = billingOf(PLANS.pro, subscription("pro"));
const PENDING = billingOf(PLANS.pro, subscription("pro", "own-key"));

// Test keys built at runtime (mock mode accepts only "mock-…"); their own part is what must never come back.
const DEEPL_KEY = ["mock", "xyzzy", "7391"].join("-") + ":fx";
const AZURE_KEY = ["mock", "qwvut", "8462"].join("-");

let n = 0;
async function shopOn(billing: BillingStatus) {
  const { shop } = await upsertInstalledShop({ shopDomain: `settings-own-${++n}.myshopify.com`, name: "Own Key Store" }, app);
  stand.shop = shop;
  stand.admin = new FakeShopifyStore(2).asAdmin();
  stand.billing = billing;
  return shop;
}

const load = async () => (await loader({ request: new Request("http://app.test/app/settings"), params: {}, context: {} } as LoaderFunctionArgs)) as Awaited<ReturnType<typeof loader>>;
const post = async (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return (await action({ request: new Request("http://app.test/app/settings", { method: "POST", body }), params: {}, context: {} } as ActionFunctionArgs)) as Record<string, unknown>;
};

/** Neither the key nor any five characters in a row of its own part (after "mock-"; a hint has four). */
function expectNoKey(value: unknown, key: string) {
  const json = JSON.stringify(value);
  expect(json).not.toContain(key);
  const own = key.slice("mock-".length);
  for (let i = 0; i + 5 <= own.length; i++) expect(json, own.slice(i, i + 5)).not.toContain(own.slice(i, i + 5));
}

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

const rows = (shopId: string) => withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ select: { engine: true, hint: true, status: true } }), app);

describe("Settings › Your translation keys", () => {
  it("saves, checks and removes a key without ever returning it", async () => {
    const shop = await shopOn(OWN);
    const before = await load();
    expect(before.ownKeys).toMatchObject({ access: "plan", plan: true, keys: [] });

    const saved = await post({ intent: "save-key", engine: "deepl", apiKey: DEEPL_KEY });
    expect(saved).toEqual({ ok: true, saved: "key", engine: "deepl", replaced: false, status: "OK" });
    expectNoKey(saved, DEEPL_KEY);
    expect(await rows(shop.id)).toEqual([{ engine: "deepl", hint: "7391", status: "OK" }]);

    const page = await load();
    expect(page.ownKeys?.keys).toEqual([expect.objectContaining({ engine: "deepl", hint: "7391", status: "OK", deeplPlan: "free" })]);
    expect(page.ownKeys?.deepl).toEqual({ plan: "free", used: 1_234, limit: 500_000 });
    // The permission now covers the key's service, under the own-key notice.
    expect(page.engines.configured).toEqual(["deepl"]);
    expect(page.consent).toBe(false);
    expectNoKey(page, DEEPL_KEY);

    const replaced = await post({ intent: "save-key", engine: "azure", apiKey: AZURE_KEY, region: "West Europe", location: "global" });
    expect(replaced).toEqual({ ok: true, saved: "key", engine: "azure", replaced: false, status: "OK" });
    expectNoKey(replaced, AZURE_KEY);
    const azure = (await load()).ownKeys?.keys.find((k) => k.engine === "azure");
    expect(azure).toMatchObject({ region: "westeurope", dataLocation: "global", hint: "8462" });

    const checked = await post({ intent: "check-key", engine: "deepl" });
    expect(checked).toEqual({ ok: true, saved: "key-check", engine: "deepl", status: "OK" });

    const removed = await post({ intent: "remove-key", engine: "deepl" });
    expect(removed).toEqual({ ok: true, saved: "key-removed", engine: "deepl" });
    expect((await rows(shop.id)).map((r) => r.engine)).toEqual(["azure"]);
    expectNoKey(await load(), AZURE_KEY);
  });

  it("answers a failure with its code and engine only, never what was typed", async () => {
    await shopOn(OWN);
    const typed = ["sk", "real", "looking", "key", "1234567890"].join("-");
    const mockOnly = await post({ intent: "save-key", engine: "deepl", apiKey: typed });
    expect(mockOnly).toEqual({ ok: false, error: "KEY_MOCK_ONLY", engine: "deepl" });
    expect(JSON.stringify(mockOnly)).not.toContain("looking");
    const refused = ["mock", "deepl", "refused"].join("-");
    expect(await post({ intent: "save-key", engine: "deepl", apiKey: refused })).toEqual({ ok: false, error: "KEY_REFUSED", engine: "deepl" });
    // An engine that isn't one: no engine in the answer.
    expect(await post({ intent: "save-key", engine: "<script>", apiKey: DEEPL_KEY })).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    expect(await post({ intent: "check-key", engine: "google" })).toEqual({ ok: false, error: "NO_KEY", engine: "google" });
    expect(await post({ intent: "remove-key", engine: "nope" })).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    // Removing what isn't there is fine (nothing to undo).
    expect(await post({ intent: "remove-key", engine: "google" })).toEqual({ ok: true, saved: "key-removed", engine: "google" });
  });

  it("refuses a forged save on another plan before anything else, and stores nothing", async () => {
    const shop = await shopOn(PRO);
    const answer = await post({ intent: "save-key", engine: "deepl", apiKey: DEEPL_KEY });
    expect(answer).toEqual({ ok: false, error: "PLAN_OWN_KEY", engine: "deepl" });
    expect(await post({ intent: "check-key", engine: "deepl" })).toEqual({ ok: false, error: "PLAN_OWN_KEY", engine: "deepl" });
    expect(await rows(shop.id)).toEqual([]);
  });

  it("a pending change to Own key: keys are managed now, with the day they start", async () => {
    const shop = await shopOn(PENDING);
    const page = await load();
    expect(page.ownKeys).toMatchObject({ access: "pending", plan: false, startsOn: "2026-11-28T00:00:00.000Z", keys: [] });
    expect(await post({ intent: "save-key", engine: "deepl", apiKey: DEEPL_KEY })).toMatchObject({ ok: true, saved: "key" });
    expect((await rows(shop.id)).length).toBe(1);
    // Still Pro until the switch: Linguva's services, the plan's allowance tile.
    const after = await load();
    expect(after.engines.configured).not.toEqual([]);
    expect(after.ownKeys?.deepl).toBeNull();
  });

  it("every other shop: no keys card, today's data otherwise; saved keys after a downgrade can be removed", async () => {
    const shop = await shopOn(PRO);
    const page = await load();
    expect(page.ownKeys).toBeNull();
    expect(Object.keys(page).sort()).toEqual(
      ["aiAvailable", "auto", "autoPublishInPlan", "consent", "consentAt", "engines", "glossaryTerms", "limit", "now", "ownKeys", "publishMode", "resetsOn", "reuseMachineMemory", "smart", "smartCheckKey", "style", "used"].sort(),
    );
    expect(page.limit).toBe(PLANS.pro.monthlyChars);

    await seedOwnKey(shop.id, { engine: "deepl", apiKey: DEEPL_KEY }, { client: app, mode: "mock" });
    const off = await load();
    expect(off.ownKeys).toMatchObject({ access: "off", plan: false, deepl: null, keys: [expect.objectContaining({ engine: "deepl", hint: "7391" })] });
    expectNoKey(off, DEEPL_KEY);
    expect(await post({ intent: "remove-key", engine: "deepl" })).toEqual({ ok: true, saved: "key-removed", engine: "deepl" });
    expect(await rows(shop.id)).toEqual([]);
  });

  it("a pause for Linguva's limits doesn't hold an Own key shop", async () => {
    const shop = await shopOn(OWN);
    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRaw`UPDATE "ShopSettings" SET "autoPausedUntil" = now() + interval '6 hours', "autoPauseReason" = 'QUOTA_EXCEEDED' WHERE "shopId" = ${shop.id}::uuid`,
    ]);
    expect((await load()).auto.paused).toBeNull();
    stand.billing = PRO;
    expect((await load()).auto.paused).toMatchObject({ reason: "QUOTA_EXCEEDED" });
  });

  it("other intents still reach their handlers, and an unknown one the guard", async () => {
    await shopOn(OWN);
    expect(await post({ intent: "reuse-memory", enabled: "true" })).toEqual({ ok: true, saved: "memory", reuse: true });
    expect(await post({ intent: "something-else" })).toEqual({ ok: false });
  });

  it("a GET of Settings writes no key: it opens the keys for the language lists, and the rows stay exactly as they were", async () => {
    const shop = await shopOn(OWN);
    expect(await post({ intent: "save-key", engine: "deepl", apiKey: DEEPL_KEY })).toMatchObject({ ok: true, saved: "key" });
    expect(await post({ intent: "save-key", engine: "azure", apiKey: AZURE_KEY, location: "eu" })).toMatchObject({ ok: true, saved: "key" });
    const full = () => withTenant(shop.id, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);
    const before = await full();
    expect(before).toHaveLength(2);
    await load();
    await load();
    // The same envelopes, versions, states and times: reading never re-encrypts or marks a key.
    expect(await full()).toEqual(before);
  });
});
