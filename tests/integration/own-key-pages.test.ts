/**
 * Pages that only show state on the Own key plan (Overview, Plan page, the
 * editor's loader, a resource list, the coverage list): they read the shop's
 * key summaries, never decrypt a key and never write one (I11), and say
 * whether AI translation is available from the shop's own keys, never from
 * Linguva's engines. The Settings and Languages loaders open the provider for
 * the engines' language lists (shop-translation.ts), checked elsewhere.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanPage } from "../../app/.server/billing/plan-page";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { resetConfigCache } from "../../app/.server/lib/config";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { loadOverview } from "../../app/.server/overview/overview";
import { ownKeysForOverview, shopTranslationFacts } from "../../app/.server/providers/shop-translation";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { loadEditorData } from "../../app/.server/translation/resource-editor";
import { OWN_KEY_PLAN } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { OPERATOR_ENV, ownDeepLKey } from "../support/engine-fixtures";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const K1 = ownDeepLKey(51);
const OWN: BillingStatus = { configured: true, state: "ACTIVE", entitlements: OWN_KEY_PLAN, subscription: null, stale: false, mustChoosePlan: false };

beforeEach(async () => {
  await resetDatabase();
  for (const [name, value] of Object.entries(OPERATOR_ENV)) vi.stubEnv(name, value);
  resetConfigCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const rows = (shopId: string) => withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);

describe("pages that only show state", () => {
  it("never decrypt or write a key, and take availability from the shop's own keys", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: "own-pages.myshopify.com" }, app);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: K1 }, { client: app });
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: ["deepl"], consent: { configured: ["deepl"], payer: "merchant" } }, app);
    const store = new FakeShopifyStore(2);
    const before = await rows(shop.id);
    const decrypt = vi.spyOn(TokenCipher.prototype, "decrypt");

    const facts = await shopTranslationFacts(shop.id, OWN, { client: app });
    expect(facts).toMatchObject({ payer: "merchant", available: true, configured: ["deepl"], unavailable: null });
    const overview = await loadOverview(store.asAdmin(), shop, app, {
      billing: OWN,
      aiAvailable: facts.available,
      consent: { configured: facts.configured, payer: facts.payer },
      ownKeys: await ownKeysForOverview(shop.id, facts, OWN, app),
    });
    expect(overview.aiAvailable).toBe(true);
    // No Linguva allowance to use up: never "exhausted" with 0 included characters.
    expect(overview.usage).toMatchObject({ level: "ok", ownKey: { total: 0 }, trialEndsAt: null });
    expect(overview.checklist.find((s) => s.id === "consent")?.done ?? true).toBe(true);

    const plan = await loadPlanPage({ admin: store.asAdmin(), shop, billing: Promise.resolve(OWN), welcome: false }, app);
    expect(plan.aiAvailable).toBe(true);

    const editor = await loadEditorData({
      admin: store.asAdmin(),
      shopId: shop.id,
      actorId: "7",
      kind: "PRODUCT",
      resourceId: "gid://shopify/Product/1",
      target: { locale: "de", name: "German", rtl: false },
      sourceName: "English",
      billing: OWN,
      translation: facts,
    });
    expect(editor.ai).toMatchObject({ available: true, consent: true, consentTokens: ["deepl"], limit: null });

    expect(decrypt).not.toHaveBeenCalled();
    expect(await rows(shop.id)).toEqual(before);
  });

  it("an Own key shop without a key isn't available, whatever Linguva's engines are", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: "own-pages-none.myshopify.com" }, app);
    const store = new FakeShopifyStore(1);
    const facts = await shopTranslationFacts(shop.id, OWN, { client: app });
    expect(facts).toEqual({ payer: "merchant", available: false, configured: [], unavailable: "OWN_KEY_MISSING", keys: [] });
    const plan = await loadPlanPage({ admin: store.asAdmin(), shop, billing: Promise.resolve(OWN), welcome: false }, app);
    expect(plan.aiAvailable).toBe(false);
    expect(await ownKeysForOverview(shop.id, facts, OWN, app)).toEqual({ access: "plan", keys: [], startsOn: null });
  });
});
