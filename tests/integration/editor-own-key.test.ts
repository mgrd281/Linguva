/**
 * The editor on the Own key plan (app/.server/translation/resource-editor.ts):
 * AI translation goes only to the merchant's own keys (every request
 * recorded, never a fictional operator key from the environment), a used-up
 * or refused key names its engine, a missing key and a key under an unknown
 * key id say so, the request limits still apply, the loader shows no Linguva
 * allowance, and granting consent stores the own-key notice with exactly the
 * shop's keys. Live members with a fake fetch are injected through the
 * context (tests only), never through env.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUnknownKidReports } from "../../app/.server/credentials/store";
import { engineConsentTokens, getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { clearEngineRests } from "../../app/.server/providers/engine-router";
import { shopTranslationFacts } from "../../app/.server/providers/shop-translation";
import { getShopSettings, setAiConsent } from "../../app/.server/settings/shop-settings";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { attachedRef } from "../../app/.server/translation/attached-editor";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import { getMonthlyUsage, getOwnKeyUsage } from "../../app/.server/usage/usage-ledger";
import type { ConsentToken } from "../../app/lib/engines";
import { OWN_KEY_PLAN } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { OPERATOR_ENV, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { fakeEngineFetch, type FakeEngineSpec } from "../support/fake-engines";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const K1 = ownDeepLKey(31);
const GOOGLE = ownGoogleKey(32);
const OWN_BILLING: BillingStatus = { configured: true, state: "ACTIVE", entitlements: OWN_KEY_PLAN, subscription: null, stale: false, mustChoosePlan: false };

beforeEach(async () => {
  await resetDatabase();
  clearEngineRests();
  resetUnknownKidReports();
  for (const [name, value] of Object.entries(OPERATOR_ENV)) vi.stubEnv(name, value);
  vi.stubEnv("AZURE_TRANSLATOR_REGION", "westeurope");
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

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const translate = () => form([["intent", "ai-translate"], ["key", "title"], ["key", "body_html"]]);

async function setup(own: FakeEngineSpec, keys: Array<{ engine: string; apiKey: string }>, options: { consent?: boolean } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: `editor-own-${Math.random().toString(36).slice(2, 8)}.myshopify.com` }, app);
  for (const key of keys) await seedOwnKey(shop.id, key, { client: app });
  const tokens = (await shopTranslationFacts(shop.id, OWN_BILLING, { client: app })).configured;
  if ((options.consent ?? true) && tokens.length) await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: tokens, consent: { configured: tokens, payer: "merchant" } }, app);
  const fake = fakeEngineFetch(own);
  const store = new FakeShopifyStore(2);
  const ctx: EditorContext = {
    admin: store.asAdmin(),
    shopId: shop.id,
    actorId: "7",
    kind: "PRODUCT",
    resourceId: P1,
    target: { locale: "de", name: "German", rtl: false },
    sourceName: "English",
    billing: OWN_BILLING,
    targetLocales: ["de"],
    ownKeyOptions: { mode: "live", fetch: fake.fetch },
  };
  return { shop, store, ctx, calls: fake.calls };
}

function expectOnlyMerchantKeys(calls: ReturnType<typeof fakeEngineFetch>["calls"], allowed: string[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(allowed).toContain(call.authHeader);
    for (const value of Object.values(OPERATOR_ENV)) expect(JSON.stringify(call)).not.toContain(value);
  }
}

describe("the editor on the Own key plan", () => {
  it("translates through the merchant's key only and charges the merchant", async () => {
    const { shop, ctx, calls } = await setup({ deepl: { [K1]: "ok" } }, [{ engine: "deepl", apiKey: K1 }]);
    const result = await runEditorAction(ctx, translate());
    expect(result).toMatchObject({ kind: "ai", provider: "deepl", drafts: { title: "[de] Product 1 jacket" } });
    expectOnlyMerchantKeys(calls, [`DeepL-Auth-Key ${K1}`]);
    expect(calls.every((c) => c.host === "api-free.deepl.com")).toBe(true);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
    expect((await getOwnKeyUsage(shop.id, undefined, app)).total).toBeGreaterThan(0);
  });

  it("names the engine of a used-up key (OWN_KEY_QUOTA) and marks it", async () => {
    const { shop, ctx } = await setup({ deepl: { [K1]: "quota" } }, [{ engine: "deepl", apiKey: K1 }]);
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "OWN_KEY_QUOTA", engine: "deepl" });
    const [row] = await withTenant(shop.id, (tx) => tx.shopEngineCredential.findMany(), app);
    expect(row).toMatchObject({ status: "QUOTA", lastErrorCode: "OWN_KEY_QUOTA_DEEPL" });
  });

  it("answers OWN_KEY_AUTH with the engine once every saved key is refused, without a request", async () => {
    const { ctx, calls } = await setup({ deepl: { [K1]: "refused" } }, [{ engine: "deepl", apiKey: K1 }]);
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "OWN_KEY_AUTH", engine: "deepl" });
    const sent = calls.length;
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "OWN_KEY_AUTH", engine: "deepl" });
    expect(calls.length).toBe(sent);
  });

  it("answers OWN_KEY_MISSING without a key, never the operator's engines", async () => {
    const { ctx, calls } = await setup({}, [], { consent: false });
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "OWN_KEY_MISSING" });
    expect(await runEditorAction(ctx, form([["intent", "ai-translate-attached"]]))).toEqual({ kind: "error", code: "OWN_KEY_MISSING" });
    expect(calls).toEqual([]);
  });

  it("answers PROVIDER_UNAVAILABLE (try again) for a key under a key id this process doesn't have", async () => {
    const { ctx, calls } = await setup({ deepl: { [K1]: "ok" } }, [{ engine: "deepl", apiKey: K1 }]);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `other:${Buffer.alloc(32, 4).toString("base64")}`);
    resetConfigCache();
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "PROVIDER_UNAVAILABLE" });
    expect(calls).toEqual([]);
  });

  it("keeps the request size limit and the request rate limit", async () => {
    const { ctx } = await setup({ deepl: { [K1]: "ok" } }, [{ engine: "deepl", apiKey: K1 }]);
    vi.stubEnv("AI_MAX_CHARS_PER_REQUEST", "5");
    resetConfigCache();
    expect(await runEditorAction(ctx, translate())).toEqual({ kind: "error", code: "REQUEST_TOO_LARGE" });
    vi.stubEnv("AI_MAX_CHARS_PER_REQUEST", "20000");
    resetConfigCache();
    // The staff member's per-minute budget (AI_USER_REQUESTS_PER_MINUTE, 10 by default) still runs out.
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await runEditorAction(ctx, form([["intent", "ai-translate"], ["key", "title"]])));
    expect(results.at(-1)).toMatchObject({ kind: "error", code: "RATE_LIMITED_USER" });
  });

  it("shows no Linguva allowance in the loader, but the characters through the own key", async () => {
    const { ctx } = await setup({ deepl: { [K1]: "ok" } }, [{ engine: "deepl", apiKey: K1 }]);
    await runEditorAction(ctx, translate());
    const data = await loadEditorData(ctx);
    expect(data.ai).toMatchObject({ available: true, consent: true, consentTokens: ["deepl"], limit: null, dailyLimit: null, ownKey: { unavailable: null } });
    expect(data.ai.ownKey!.chars).toBeGreaterThan(0);
    // The facts the editor context carries hold no provider and no credential.
    const facts = await shopTranslationFacts(ctx.shopId, OWN_BILLING, { client: app });
    expect(Object.keys(facts).sort()).toEqual(["available", "configured", "keys", "payer", "unavailable"]);
    expect(JSON.stringify(data)).not.toContain(K1);
  });

  it("an operator shop's loader keeps today's allowance fields", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: "editor-operator.myshopify.com" }, app);
    const store = new FakeShopifyStore(1);
    const data = await loadEditorData({ admin: store.asAdmin(), shopId: shop.id, actorId: "7", kind: "PRODUCT", resourceId: P1, target: { locale: "de", name: "German", rtl: false }, sourceName: "English" });
    expect(data.ai).toMatchObject({ consentTokens: engineConsentTokens(getConfig()), ownKey: null });
    expect(typeof data.ai.limit).toBe("number");
    expect(typeof data.ai.dailyLimit).toBe("number");
  });

  it("grants consent for a Google-only shop under the own-key notice", async () => {
    const { shop, ctx } = await setup({ google: { [GOOGLE]: "ok" } }, [{ engine: "google", apiKey: GOOGLE }], { consent: false });
    const result = await runEditorAction(ctx, form([["intent", "grant-consent"], ["consentTokens", "google-global"]]));
    expect(result).toEqual({ kind: "consent" });
    expect((await getShopSettings(shop.id, app)).consentVersion).toBe("2026-11-ownkey-v1:google-global");
    // A page that showed Linguva's DeepL notice doesn't grant the own-key one.
    const { ctx: other } = await setup({}, [{ engine: "google", apiKey: GOOGLE }], { consent: false });
    expect(await runEditorAction(other, form([["intent", "grant-consent"], ["consentTokens", "deepl"]]))).toEqual({ kind: "error", code: "CONSENT_CHANGED" });
  });

  it("stores both tokens for DeepL and Google keys, and the next translation fails over to Google", async () => {
    const { shop, ctx, calls } = await setup({ deepl: { [K1]: "quota" }, google: { [GOOGLE]: "ok" } }, [
      { engine: "deepl", apiKey: K1 },
      { engine: "google", apiKey: GOOGLE },
    ], { consent: false });
    const tokens: ConsentToken[] = ["deepl", "google-global"];
    expect(await runEditorAction(ctx, form([["intent", "grant-consent"], ["consentTokens", tokens.join(",")]]))).toEqual({ kind: "consent" });
    expect((await getShopSettings(shop.id, app)).consentVersion).toBe("2026-11-ownkey-v1:deepl,google-global");
    expect(await runEditorAction(ctx, translate())).toMatchObject({ kind: "ai", provider: "google" });
    expectOnlyMerchantKeys(calls, [`DeepL-Auth-Key ${K1}`, GOOGLE]);
    const rows = await withTenant(shop.id, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);
    expect(rows.map((r) => [r.engine, r.status])).toEqual([
      ["deepl", "QUOTA"],
      ["google", "OK"],
    ]);
  });

  it("translates images and custom fields through the own key, and stops naming the engine of a used-up key", async () => {
    const { ctx, store, calls } = await setup({ deepl: { [K1]: "ok" } }, [{ engine: "deepl", apiKey: K1 }]);
    const img = store.addImage(P1, "Red wool jacket");
    const result = await runEditorAction(ctx, form([["intent", "ai-translate-attached"]]));
    expect(result).toMatchObject({ kind: "attached-ai", provider: "deepl", drafts: { [attachedRef(img, "alt")]: "[de] Red wool jacket" } });
    expectOnlyMerchantKeys(calls, [`DeepL-Auth-Key ${K1}`]);

    const used = await setup({ deepl: { [K1]: "quota" } }, [{ engine: "deepl", apiKey: K1 }]);
    used.store.addImage(P1, "Blue wool jacket");
    expect(await runEditorAction(used.ctx, form([["intent", "ai-translate-attached"]]))).toMatchObject({ kind: "attached-ai", stopped: "OWN_KEY_QUOTA", engine: "deepl" });
  });
});
