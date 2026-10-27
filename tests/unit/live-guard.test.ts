import { describe, expect, it } from "vitest";
import { assertDevelopmentStore, readLiveSettings } from "../live/guard";

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
    expect(() => readLiveSettings({ LIVE_SHOPIFY_SHOP: base.LIVE_SHOPIFY_SHOP })).toThrow(/either/);
    expect(() => readLiveSettings({ ...base, LIVE_SHOPIFY_CLIENT_ID: "id" })).toThrow(/either/);
    expect(() => readLiveSettings({ LIVE_SHOPIFY_SHOP: base.LIVE_SHOPIFY_SHOP, LIVE_SHOPIFY_CLIENT_ID: "id" })).toThrow(/either/);
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
});
