import { describe, expect, it } from "vitest";
import { entitlementsFor, planSelectionUrl, PLANS, UNMETERED } from "../../app/lib/plans";
import { fetchActiveSubscription, PartnerApiError } from "../../app/.server/billing/partner-api";
import { aiLimitsFor } from "../../app/.server/billing/billing";
import { getConfig } from "../../app/.server/lib/config";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";

const SHOP = "gid://shopify/Shop/5678";

describe("plans", () => {
  it("maps known plan handles and gives unknown ones only the free plan", () => {
    expect(entitlementsFor("pro")).toMatchObject({ plan: "pro", bulk: true, known: true });
    expect(entitlementsFor("enterprise_custom")).toMatchObject({ plan: "free", bulk: false, known: false });
    expect(entitlementsFor("__proto__")).toMatchObject({ plan: "free", known: false });
    expect(entitlementsFor(null)).toMatchObject({ plan: "free" });
    expect(UNMETERED.bulk && UNMETERED.glossary && UNMETERED.autoPublish).toBe(true);
  });

  it("builds the hosted plan selection URL from validated parts only", () => {
    expect(planSelectionUrl("cool-shop.myshopify.com", "linguva")).toBe(
      "https://admin.shopify.com/store/cool-shop/charges/linguva/pricing_plans",
    );
    expect(() => planSelectionUrl("evil.com/x?.myshopify.com", "linguva")).toThrow();
    expect(() => planSelectionUrl("shop.myshopify.com", "../x")).toThrow();
  });

  it("takes AI limits from the plan when billing is on, from the environment otherwise", () => {
    const config = getConfig({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
      AI_DAILY_CHAR_LIMIT: "50000",
    } as NodeJS.ProcessEnv);
    expect(aiLimitsFor(config, { configured: true, entitlements: PLANS.starter })).toMatchObject({ limit: 300_000, dailyLimit: 50_000 });
    expect(aiLimitsFor(config, { configured: true, entitlements: PLANS.free })).toMatchObject({ limit: 20_000, dailyLimit: 20_000 });
    expect(aiLimitsFor(config, { configured: false, entitlements: UNMETERED })).toMatchObject({ limit: 20_000 });
  });
});

describe("Partner API client", () => {
  it("queries activeSubscription for the app and shop, with the token only in the header", async () => {
    const api = fakePartnerApi({ handle: "pro", trialEndsAt: "2026-11-10T00:00:00Z", pendingHandle: "business" });
    const sub = await fetchActiveSubscription(PARTNER_SETTINGS, SHOP, api.fetchImpl);
    expect(sub).toMatchObject({ planHandle: "pro", pendingPlanHandle: "business", cancelAtEndOfCycle: false });
    expect(sub!.trialEndsAt!.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(api.calls[0]!.url).toBe("https://partners.shopify.com/1234567/api/2026-10/graphql.json");
    expect(api.calls[0]!.token).toBe(PARTNER_SETTINGS.token);
    expect(JSON.stringify(api.calls[0]!.body)).not.toContain(PARTNER_SETTINGS.token);
    expect(api.calls[0]!.body).toMatchObject({ variables: { appId: "gid://shopify/App/42", shopId: SHOP } });
  });

  it("returns null for no subscription and throws (never 'not subscribed') on failures", async () => {
    expect(await fetchActiveSubscription(PARTNER_SETTINGS, SHOP, fakePartnerApi(null).fetchImpl)).toBeNull();
    await expect(fetchActiveSubscription(PARTNER_SETTINGS, SHOP, fakePartnerApi({ status: 429 }).fetchImpl)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(fetchActiveSubscription(PARTNER_SETTINGS, SHOP, fakePartnerApi({ status: 401 }).fetchImpl)).rejects.toMatchObject({
      retryable: false,
    });
    // Network errors and timeouts are "couldn't check" too.
    await expect(fetchActiveSubscription(PARTNER_SETTINGS, SHOP, fakePartnerApi(new TypeError("network")).fetchImpl)).rejects.toMatchObject({
      name: "PartnerApiError",
      retryable: true,
    });
    const api = fakePartnerApi(null);
    await expect(fetchActiveSubscription(PARTNER_SETTINGS, "gid://shopify/Shop/1 OR 1", api.fetchImpl)).rejects.toBeInstanceOf(PartnerApiError);
    expect(api.calls).toHaveLength(0);
  });
});
