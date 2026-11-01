/**
 * A language's page and its category lists on the Own key plan
 * (app/.server/languages/language-page.ts): translating in bulk waits for a
 * usable key (OWN_KEY_MISSING) or a key that isn't refused (OWN_KEY_REFUSED)
 * before anything else the merchant could change, the confirm dialog gets no
 * Linguva allowance (aiRemaining null), and the consent gap is read from the
 * shop's own keys (each key's own language list). Billing comes from the
 * cached subscription (Partner settings set, no request).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markEngineKey } from "../../app/.server/credentials/store";
import { loadCategoryItems, loadLanguagePage, translateCategoryAction } from "../../app/.server/languages/language-page";
import { resetConfigCache } from "../../app/.server/lib/config";
import { clearEngineRests } from "../../app/.server/providers/engine-router";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import type { ConsentToken } from "../../app/lib/engines";
import { ownerDb, resetDatabase } from "../support/db";
import { ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { fakeEngineFetch } from "../support/fake-engines";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const available = { jobsAvailable: true, aiAvailable: true } as const;
const K1 = ownDeepLKey(41);
const GOOGLE = ownGoogleKey(42);
let n = 0;

beforeEach(async () => {
  await resetDatabase();
  clearEngineRests();
  vi.stubEnv("TRANSLATION_PROVIDER", "mock");
  vi.stubEnv("SHOPIFY_PARTNER_ORG_ID", "1");
  vi.stubEnv("SHOPIFY_PARTNER_API_TOKEN", "partner-token");
  vi.stubEnv("SHOPIFY_APP_GID", "gid://shopify/App/1");
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

async function storeOn(planHandle: string) {
  const { shop } = await upsertInstalledShop({ shopDomain: `lang-own-${++n}.myshopify.com` }, app);
  const billed = await app.shop.update({ where: { id: shop.id }, data: { shopifyShopGid: `gid://shopify/Shop/${shop.id.slice(0, 8)}` } });
  await withTenant(shop.id, (tx) => tx.shopSubscription.create({ data: { shopId: shop.id, checkedAt: new Date(), state: "ACTIVE", planHandle } }), app);
  const store = new FakeShopifyStore(3);
  store.locales = [...store.locales, { locale: "fr", name: "French", primary: false, published: true }];
  return { shop: billed, store };
}

const ownConsent = (shopId: string, tokens: ConsentToken[]) => setAiConsent({ shopId, granted: true, actorId: "1", shown: tokens, consent: { configured: tokens, payer: "merchant" } }, app);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ intent: "translate-category", idempotencyKey: "own-key-lang-1", ...fields })) f.set(k, v);
  return f;
};

describe("translating a language in bulk on the Own key plan", () => {
  it("waits for a usable key: OWN_KEY_MISSING without one, before the operator's AI_NOT_CONFIGURED", async () => {
    const { shop, store } = await storeOn("own-key");
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(page.bulk.gate).toBe("OWN_KEY_MISSING");
    expect(page.bulk.aiRemaining).toBeNull();
    // Whatever the operator's setup says, the own key decides.
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, { ...available, aiAvailable: false })).bulk.gate).toBe("OWN_KEY_MISSING");
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, { jobsAvailable: false, aiAvailable: true })).bulk.gate).toBe("JOBS_UNAVAILABLE");
    const list = await loadCategoryItems(store.asAdmin(), shop, "de", "products", {}, app, available);
    expect(list.bulk).toMatchObject({ gate: "OWN_KEY_MISSING", aiRemaining: null });
    expect(await translateCategoryAction(store.asAdmin(), shop, { locale: "de", form: form({ category: "products" }), requestedBy: null }, app)).toEqual({ error: "OWN_KEY_MISSING" });
  });

  it("says OWN_KEY_REFUSED when every saved key is refused", async () => {
    const { shop, store } = await storeOn("own-key");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: K1 }, { client: app });
    const [row] = await withTenant(shop.id, (tx) => tx.shopEngineCredential.findMany(), app);
    await markEngineKey({ id: row!.id, shopId: shop.id, keyVersion: row!.keyVersion }, { status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL", lastErrorAt: new Date() }, app);
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, available)).bulk.gate).toBe("OWN_KEY_REFUSED");
  });

  it("then asks for the own-key consent, and with it nothing stops the job", async () => {
    const { shop, store } = await storeOn("own-key");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: K1 }, { client: app });
    // A consent to Linguva's notice (from another plan) doesn't cover the own key.
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, available)).bulk.gate).toBe("CONSENT_REQUIRED");
    await ownConsent(shop.id, ["deepl"]);
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, available)).bulk.gate).toBeNull();
  });

  it("reads the consent gap from the shop's own keys: a language only the unconsented Google key serves", async () => {
    const { shop, store } = await storeOn("own-key");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: K1 }, { client: app });
    await seedOwnKey(shop.id, { engine: "google", apiKey: GOOGLE }, { client: app });
    await ownConsent(shop.id, ["deepl"]);
    // DeepL's own list lacks French; Google's has it.
    const fake = fakeEngineFetch({ deepl: { [K1]: "ok" }, google: { [GOOGLE]: "ok" }, languages: { deepl: ["DE"], google: ["de", "en", "fr"] } });
    const options = { ...available, ownKeyOptions: { mode: "live" as const, fetch: fake.fetch } };
    expect((await loadLanguagePage(store.asAdmin(), shop, "fr", app, options)).bulk.gate).toBe("ENGINE_CONSENT");
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, options)).bulk.gate).toBeNull();
    // Only the merchant's keys read their lists, and no text was sent.
    expect(fake.calls.every((c) => [`DeepL-Auth-Key ${K1}`, GOOGLE].includes(c.authHeader ?? ""))).toBe(true);
    expect(fake.calls.some((c) => /translate$|translate\/v2$/.test(c.path))).toBe(false);
    await ownConsent(shop.id, ["deepl", "google-global"]);
    expect((await loadLanguagePage(store.asAdmin(), shop, "fr", app, options)).bulk.gate).toBeNull();
  });

  it("keeps today's gate and allowance for a Pro store", async () => {
    const { shop, store } = await storeOn("pro");
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(page.bulk.gate).toBeNull();
    expect(typeof page.bulk.aiRemaining).toBe("number");
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, { ...available, aiAvailable: false })).bulk.gate).toBe("AI_NOT_CONFIGURED");
  });
});
