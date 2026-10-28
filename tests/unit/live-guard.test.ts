import { describe, expect, it, vi } from "vitest";
import { createLiveAdmin } from "../live/admin-client";
import { assertDevelopmentStore, chooseTargetLocale, LiveTestRefused, readLiveSettings } from "../live/guard";

const base = { LIVE_SHOPIFY_SHOP: "linguva-dev.myshopify.com", LIVE_SHOPIFY_ADMIN_TOKEN: "test-token" };

describe("live test guard", () => {
  it("is off unless configured", () => {
    expect(readLiveSettings({})).toBeNull();
  });

  it("accepts a token or Dev Dashboard client credentials", () => {
    expect(readLiveSettings(base)?.credentials).toEqual({ kind: "token", token: "test-token" });
    expect(
      readLiveSettings({
        LIVE_SHOPIFY_SHOP: base.LIVE_SHOPIFY_SHOP,
        LIVE_SHOPIFY_CLIENT_ID: "id",
        LIVE_SHOPIFY_CLIENT_SECRET: "secret",
      })?.credentials,
    ).toEqual({ kind: "client", clientId: "id", clientSecret: "secret" });
  });

  it("allows writes only with an explicit yes", () => {
    expect(readLiveSettings(base)?.allowWrites).toBe(false);
    expect(readLiveSettings({ ...base, LIVE_ALLOW_WRITES: "true" })?.allowWrites).toBe(false);
    expect(readLiveSettings({ ...base, LIVE_ALLOW_WRITES: "yes" })?.allowWrites).toBe(true);
  });

  it("refuses incomplete settings, non-myshopify domains and denied stores", () => {
    expect(() => readLiveSettings({ LIVE_SHOPIFY_SHOP: base.LIVE_SHOPIFY_SHOP })).toThrow(/exactly one/);
    expect(() => readLiveSettings({ ...base, LIVE_SHOPIFY_CLIENT_ID: "id" })).toThrow(/exactly one/);
    expect(() => readLiveSettings({ LIVE_SHOPIFY_SHOP: base.LIVE_SHOPIFY_SHOP, LIVE_SHOPIFY_CLIENT_ID: "id" })).toThrow(/exactly one/);
    expect(() => readLiveSettings({ LIVE_SHOPIFY_ADMIN_TOKEN: "t" })).toThrow(/LIVE_SHOPIFY_SHOP/);
    for (const shop of ["example.com", "evil.myshopify.com.attacker.io", "https://x.myshopify.com", "a/b.myshopify.com"]) {
      expect(() => readLiveSettings({ ...base, LIVE_SHOPIFY_SHOP: shop })).toThrow(/myshopify/);
    }
    expect(() => readLiveSettings({ ...base, LIVE_SHOPIFY_SHOP: "karinex-de.myshopify.com" })).toThrow(/deny/);
    expect(() =>
      readLiveSettings({ ...base, LIVE_SHOPIFY_SHOP: "shop-x.myshopify.com", LIVE_DENY_DOMAINS: "other, shop-x" }),
    ).toThrow(/deny/);
    expect(() => readLiveSettings({ ...base, LIVE_TARGET_LOCALE: "de; drop" })).toThrow(/locale/);
  });

  it("requires the token's store to be the configured Partner development store", () => {
    const settings = readLiveSettings(base)!;
    expect(() =>
      assertDevelopmentStore(settings, { myshopifyDomain: "linguva-dev.myshopify.com", partnerDevelopment: true }),
    ).not.toThrow();
    expect(() =>
      assertDevelopmentStore(settings, { myshopifyDomain: "linguva-dev.myshopify.com", partnerDevelopment: false }),
    ).toThrow(/not a Partner development store/);
    expect(() =>
      assertDevelopmentStore(settings, { myshopifyDomain: "real-shop.myshopify.com", partnerDevelopment: true }),
    ).toThrow(/belongs to/);
  });

  it("can use the app's own session for read-only checks, never with writes or mixed with other credentials", () => {
    const shop = { LIVE_SHOPIFY_SHOP: "linguva-test-lab.myshopify.com" };
    expect(readLiveSettings({ ...shop, LIVE_USE_APP_SESSION: "yes" })).toMatchObject({ credentials: { kind: "appSession" }, allowWrites: false });
    expect(() => readLiveSettings({ ...shop, LIVE_USE_APP_SESSION: "yes", LIVE_ALLOW_WRITES: "yes" })).toThrow(/read-only/);
    expect(() => readLiveSettings({ ...shop, LIVE_USE_APP_SESSION: "yes", LIVE_SHOPIFY_ADMIN_TOKEN: "x" })).toThrow(/exactly one/);
    expect(() => readLiveSettings({ LIVE_SHOPIFY_SHOP: "karinex-de.myshopify.com", LIVE_USE_APP_SESSION: "yes" })).toThrow(/deny list/);
  });
});

describe("live test target language", () => {
  const shop = "linguva-test-lab.myshopify.com";
  const en = { locale: "en", primary: true, published: true };

  it("uses the store's first additional language, also when it is unpublished", () => {
    expect(chooseTargetLocale([en, { locale: "fr", primary: false, published: false }], null, shop)).toEqual({ ok: true, locale: "fr", published: false });
    expect(chooseTargetLocale([en, { locale: "fr", primary: false, published: false }], "fr", shop)).toEqual({ ok: true, locale: "fr", published: false });
  });

  it("explains how to add a language when the store has none", () => {
    const choice = chooseTargetLocale([en], null, shop);
    expect(choice.ok).toBe(false);
    if (!choice.ok) {
      expect(choice.message).toContain("has no additional language yet");
      expect(choice.message).toContain("https://admin.shopify.com/store/linguva-test-lab/settings/languages");
      expect(choice.message).toContain("It can stay unpublished");
    }
  });

  it("names the languages to choose from when LIVE_TARGET_LOCALE doesn't match", () => {
    const choice = chooseTargetLocale([en, { locale: "fr", primary: false, published: false }], "de", shop);
    expect(choice).toMatchObject({ ok: false });
    if (!choice.ok) expect(choice.message).toMatch(/LIVE_TARGET_LOCALE=de isn't enabled[\s\S]*fr \(unpublished\)[\s\S]*LIVE_TARGET_LOCALE=fr/);
    const primary = chooseTargetLocale([en, { locale: "fr", primary: false, published: true }], "en", shop);
    if (!primary.ok) expect(primary.message).toContain("primary language");
  });
});

describe("live Admin client", () => {
  const settings = (allowWrites: boolean) =>
    ({ shop: "linguva-test-lab.myshopify.com", credentials: { kind: "token", token: "t" }, targetLocale: null, allowWrites }) as const;

  it("refuses Shopify mutations before sending anything unless fixture writes are allowed", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return Response.json({ data: {} });
    });
    try {
      const readOnly = createLiveAdmin(settings(false));
      await expect(readOnly.graphql(`#graphql\n  mutation LinguvaTranslationsRegister($id: ID!) { x }`)).rejects.toThrow(/read-only without LIVE_ALLOW_WRITES=yes/);
      await expect(readOnly.graphql(`mutation { productDelete(input: {}) { userErrors { message } } }`)).rejects.toThrow(LiveTestRefused);
      expect(calls).toEqual([]);
      await readOnly.graphql(`#graphql\n  query LinguvaShopLocales { shopLocales { locale } }`);
      expect(calls).toHaveLength(1);
      await createLiveAdmin(settings(true)).graphql(`mutation LinguvaTranslationsRegister { x }`);
      expect(calls).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains a mistyped store domain instead of a parser error", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ errors: "Not Found" }, { status: 404 }));
    try {
      await expect(createLiveAdmin(settings(false)).graphql(`query LinguvaLiveShopFacts { shop { id } }`)).rejects.toThrow(
        /answered 404 for linguva-test-lab\.myshopify\.com\. Is LIVE_SHOPIFY_SHOP the store's \*\.myshopify\.com domain/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
