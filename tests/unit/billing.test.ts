import type { ShopSubscription } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { entitlementsFor, planSelectionUrl, PLANS, TRIAL_AI_CHARS, UNMETERED } from "../../app/lib/plans";
import { fetchActiveSubscription, PartnerApiError } from "../../app/.server/billing/partner-api";
import { aiLimitsFor } from "../../app/.server/billing/billing";
import { statusFrom, type BillingDeps } from "../../app/.server/billing/subscription";
import { getConfig } from "../../app/.server/lib/config";
import { normaliseSmartSettings, type SmartSettingsInput } from "../../app/.server/smart/validate";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";
import * as plans from "../../app/lib/plans";
import { complimentaryEntitlements, DEFAULT_COMPLIMENTARY_CHARS } from "../../app/.server/billing/complimentary";

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

describe("trial allowance (docs/PRICING_DECISION.md §10.2)", () => {
  const NOW = new Date("2026-10-30T09:00:00Z");
  const deps: BillingDeps = { settings: PARTNER_SETTINGS, required: false, now: () => NOW };
  const row = (planHandle: string, trialEndsAt: Date | null): ShopSubscription => ({
    shopId: "00000000-0000-4000-8000-000000000001",
    state: "ACTIVE",
    planHandle,
    pendingPlanHandle: null,
    billingPeriod: "EVERY_30_DAYS",
    trialEndsAt,
    cancelAtEndOfCycle: false,
    currentPeriodEnd: new Date("2026-11-29T00:00:00Z"),
    checkedAt: NOW,
    updatedAt: NOW,
  });
  const config = getConfig({
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
    AI_DAILY_CHAR_LIMIT: "1000000",
  } as NodeJS.ProcessEnv);

  it("caps the allowance while a trial runs, and exposes the trial's end", () => {
    const ends = new Date("2026-11-05T00:00:00Z");
    const status = statusFrom(row("business", ends), deps, false);
    expect(status.entitlements).toEqual({ ...PLANS.business, monthlyChars: TRIAL_AI_CHARS });
    expect(status.entitlements.monthlyChars).toBe(TRIAL_AI_CHARS);
    expect(status.trialEndsAt).toEqual(ends);
    // Every limit follows: the monthly allowance and the daily cap (min(1,000,000, 100,000)).
    expect(aiLimitsFor(config, status)).toMatchObject({ limit: TRIAL_AI_CHARS, dailyLimit: TRIAL_AI_CHARS });
    // Only the allowance changes; the plan's features stay.
    expect(status).toMatchObject({ state: "ACTIVE", configured: true, mustChoosePlan: false, entitlements: { plan: "business", smartAuto: true, maxTargetLocales: 20 } });
  });

  it("gives the plan's allowance once the trial is over, and without a trial", () => {
    for (const trialEndsAt of [new Date("2026-10-29T00:00:00Z"), NOW, null]) {
      const status = statusFrom(row("pro", trialEndsAt), deps, false);
      expect(status.entitlements, String(trialEndsAt)).toEqual(PLANS.pro);
      expect(status.trialEndsAt, String(trialEndsAt)).toBeUndefined();
    }
  });

  it("follows the clock, not the cached check: the full allowance starts when the trial ends", () => {
    const ends = new Date("2026-10-30T12:00:00Z");
    const cached = row("starter", ends);
    expect(statusFrom(cached, { ...deps, now: () => new Date("2026-10-30T11:59:59Z") }, false).entitlements.monthlyChars).toBe(TRIAL_AI_CHARS);
    expect(statusFrom(cached, { ...deps, now: () => new Date("2026-10-30T12:00:01Z") }, false).entitlements.monthlyChars).toBe(300_000);
  });

  it("never raises an allowance: a plan or an unknown handle below the trial allowance keeps its own", () => {
    const ends = new Date("2026-11-05T00:00:00Z");
    expect(statusFrom(row("mystery", ends), deps, false).entitlements).toEqual(PLANS.free);
    expect(statusFrom(row("free", ends), deps, false).entitlements.monthlyChars).toBe(20_000);
  });

  it("applies to the last known state too, and leaves no subscription and NONE as they are", () => {
    expect(statusFrom(row("pro", new Date("2026-11-05T00:00:00Z")), deps, true)).toMatchObject({ stale: true, entitlements: { monthlyChars: TRIAL_AI_CHARS } });
    expect(statusFrom(null, deps, false)).toEqual({ configured: true, state: "UNKNOWN", entitlements: PLANS.free, subscription: null, stale: false, mustChoosePlan: false });
    const none = { ...row("pro", new Date("2026-11-05T00:00:00Z")), state: "NONE" as const, planHandle: null };
    expect(statusFrom(none, deps, false)).toMatchObject({ state: "NONE", entitlements: PLANS.free });
    expect(statusFrom(none, deps, false).trialEndsAt).toBeUndefined();
  });

  it("refuses smart schedule budgets above the trial allowance while a trial runs", () => {
    const form = (budget: string): SmartSettingsInput => ({
      mode: "daily",
      timeZone: "Europe/Berlin",
      times: ["03:00"],
      weekdays: [],
      locales: ["de"],
      resourceTypes: ["PRODUCT"],
      fieldGroups: "all",
      includeAttached: false,
      publishMode: "DRAFT",
      confirmPublish: false,
      replaceOutdatedMachine: true,
      dailyBudget: "",
      monthlyBudget: budget,
    });
    const context = (entitlements: typeof PLANS.business) => ({ targets: ["de"], allowed: ["de"], shopTimeZone: "Europe/Berlin", entitlements, currentPublishMode: "DRAFT" as const });
    const trial = statusFrom(row("business", new Date("2026-11-05T00:00:00Z")), deps, false).entitlements as typeof PLANS.business;
    expect(normaliseSmartSettings(form(String(TRIAL_AI_CHARS + 50_000)), context(trial))).toEqual({ ok: false, problem: "BUDGET" });
    expect(normaliseSmartSettings(form(String(TRIAL_AI_CHARS)), context(trial))).toMatchObject({ ok: true, value: { monthlyBudget: TRIAL_AI_CHARS } });
    expect(normaliseSmartSettings(form("150000"), context(PLANS.business))).toMatchObject({ ok: true, value: { monthlyBudget: 150_000 } });
  });
});

describe("the Own key plan (outside the ladder of four)", () => {
  const { OWN_KEY, OWN_KEY_HANDLES, OWN_KEY_PLAN } = plans;
  const NOW = new Date("2026-10-30T09:00:00Z");
  const deps: BillingDeps = { settings: PARTNER_SETTINGS, required: true, now: () => NOW };
  const row = (planHandle: string | null, trialEndsAt: Date | null = null, pendingPlanHandle: string | null = null): ShopSubscription => ({
    shopId: "00000000-0000-4000-8000-000000000002",
    state: "ACTIVE",
    planHandle,
    pendingPlanHandle,
    billingPeriod: "EVERY_30_DAYS",
    trialEndsAt,
    cancelAtEndOfCycle: false,
    currentPeriodEnd: new Date("2026-11-29T00:00:00Z"),
    checkedAt: NOW,
    updatedAt: NOW,
  });
  const LADDER = Object.keys(PLANS) as Array<keyof typeof PLANS>;

  it("pins the handles to exactly six (the handle, two spellings, the owner's test plan in the same three)", () => {
    expect(OWN_KEY).toBe("own-key");
    expect([...OWN_KEY_HANDLES]).toEqual(["own-key", "ownkey", "own_key", "own-key-test", "ownkeytest", "own_key_test"]);
    // Not part of the ladder: PLANS, and with it every price, icon and recommendation, keeps its four plans.
    expect(LADDER).toEqual(["free", "starter", "pro", "business"]);
    for (const handle of OWN_KEY_HANDLES) expect(Object.hasOwn(PLANS, handle), handle).toBe(false);
  });

  it("pins its entitlements: Pro's features, 0 included characters, no Smart Auto-Translate, own keys", () => {
    expect(OWN_KEY_PLAN).toEqual({
      plan: "own-key",
      monthlyChars: 0,
      maxTargetLocales: 10,
      bulk: true,
      glossary: true,
      autoPublish: true,
      smartAuto: false,
      ownKeys: true,
    });
    for (const feature of ["maxTargetLocales", "bulk", "glossary", "autoPublish", "smartAuto"] as const) {
      expect(OWN_KEY_PLAN[feature], feature).toBe(PLANS.pro[feature]);
    }
  });

  it("maps every own-key handle to the plan, known, and nothing else", () => {
    for (const handle of OWN_KEY_HANDLES) {
      expect(entitlementsFor(handle), handle).toEqual({ ...OWN_KEY_PLAN, known: true });
      expect(plans.isOwnKeyHandle(handle), handle).toBe(true);
      expect(plans.isKnownPlanHandle(handle), handle).toBe(true);
      expect(plans.planEntitlements(handle), handle).toBe(OWN_KEY_PLAN);
    }
    // Exact and case-sensitive: anything else is Free and unknown (the caller logs it).
    for (const handle of ["Own-Key", "OWN-KEY", "own-key ", " own-key", "ownkey-test", "own key", "own-keys", "own-key-test2", "own"]) {
      expect(entitlementsFor(handle), JSON.stringify(handle)).toEqual({ ...PLANS.free, known: false });
      expect(plans.isOwnKeyHandle(handle), JSON.stringify(handle)).toBe(false);
      expect(plans.isKnownPlanHandle(handle), JSON.stringify(handle)).toBe(false);
    }
    for (const handle of [null, undefined, ""]) expect(plans.isOwnKeyHandle(handle)).toBe(false);
  });

  it("leaves the four plans' handles as they were", () => {
    for (const handle of LADDER) {
      expect(entitlementsFor(handle), handle).toEqual({ ...PLANS[handle], known: true });
      expect(plans.isOwnKeyHandle(handle), handle).toBe(false);
      expect(plans.isKnownPlanHandle(handle), handle).toBe(true);
      expect(plans.planEntitlements(handle), handle).toBe(PLANS[handle]);
    }
    for (const handle of [null, undefined, "", "__proto__", "toString", "hasOwnProperty", "enterprise_custom"]) {
      expect(plans.isKnownPlanHandle(handle), String(handle)).toBe(false);
    }
  });

  it("copies ownKeys in statusFrom, for every spelling (the plan stays own-key)", () => {
    for (const handle of OWN_KEY_HANDLES) {
      const status = statusFrom(row(handle), deps, false);
      expect(status, handle).toMatchObject({ configured: true, state: "ACTIVE", mustChoosePlan: false });
      expect(status.entitlements, handle).toEqual(OWN_KEY_PLAN);
      expect(status.trialEndsAt, handle).toBeUndefined();
      expect(plans.usesOwnKeys(status.entitlements), handle).toBe(true);
    }
    // The last known state too (Partner API down).
    expect(statusFrom(row("own-key"), deps, true)).toMatchObject({ stale: true, entitlements: { ownKeys: true, plan: "own-key" } });
  });

  it("keeps ownKeys and 0 characters while Shopify reports a trial (the trial only ever lowers an allowance)", () => {
    const ends = new Date("2026-11-05T00:00:00Z");
    const status = statusFrom(row("own-key", ends), deps, false);
    expect(status.entitlements).toEqual(OWN_KEY_PLAN);
    expect(status.entitlements.monthlyChars).toBe(0);
    expect(status.trialEndsAt).toEqual(ends);
    // After the trial: the same.
    expect(statusFrom(row("own-key", ends), { ...deps, now: () => new Date("2026-11-06T00:00:00Z") }, false).entitlements).toEqual(OWN_KEY_PLAN);
  });

  it("never gives own keys to another plan, to Unmetered, to complimentary access or to a pending change", () => {
    for (const handle of LADDER) expect(Object.hasOwn(PLANS[handle], "ownKeys"), handle).toBe(false);
    expect(Object.hasOwn(UNMETERED, "ownKeys")).toBe(false);
    const complimentary = complimentaryEntitlements({ monthlyCharLimit: DEFAULT_COMPLIMENTARY_CHARS });
    expect(Object.hasOwn(complimentary, "ownKeys")).toBe(false);
    expect(complimentary).toEqual({ ...PLANS.business, plan: "complimentary", monthlyChars: DEFAULT_COMPLIMENTARY_CHARS });
    // statusFrom adds the field only when true: every other plan's entitlements have exactly today's keys.
    for (const handle of [...LADDER, "mystery", null]) {
      for (const trialEndsAt of [null, new Date("2026-11-05T00:00:00Z")]) {
        const entitlements = statusFrom(row(handle, trialEndsAt), deps, false).entitlements;
        expect(Object.hasOwn(entitlements, "ownKeys"), `${handle} ${String(trialEndsAt)}`).toBe(false);
        expect(Object.keys(entitlements), String(handle)).toEqual(Object.keys(PLANS.free));
      }
    }
    expect(Object.hasOwn(statusFrom(null, deps, false).entitlements, "ownKeys")).toBe(false);
    expect(Object.hasOwn(statusFrom({ ...row("own-key"), state: "NONE" }, deps, false).entitlements, "ownKeys")).toBe(false);
    // A pending change to Own key doesn't change today's plan (Shopify switches at the end of the cycle).
    const pending = statusFrom(row("pro", null, "own-key"), deps, false);
    expect(pending.entitlements).toEqual(PLANS.pro);
    expect(plans.usesOwnKeys(pending.entitlements)).toBe(false);
    // A handle that only looks like Own key is Free (and logged), never own keys.
    expect(statusFrom(row("Own-Key"), deps, false).entitlements).toEqual(PLANS.free);
  });

  it("answers usesOwnKeys only for an explicit true", () => {
    expect(plans.usesOwnKeys(OWN_KEY_PLAN)).toBe(true);
    expect(plans.usesOwnKeys({ ownKeys: true })).toBe(true);
    const others: Array<plans.Entitlements | { ownKeys?: boolean } | null | undefined> = [...LADDER.map((h) => PLANS[h]), UNMETERED, { ownKeys: false }, {}, null, undefined];
    for (const entitlements of others) {
      expect(plans.usesOwnKeys(entitlements), JSON.stringify(entitlements)).toBe(false);
    }
  });

  it("is reached through the Partner API like any plan", async () => {
    const sub = await fetchActiveSubscription(PARTNER_SETTINGS, SHOP, fakePartnerApi({ handle: "own-key" }).fetchImpl);
    expect(sub).toMatchObject({ planHandle: "own-key", pendingPlanHandle: null });
    expect(entitlementsFor(sub!.planHandle)).toMatchObject({ plan: "own-key", ownKeys: true, known: true });
  });
});
