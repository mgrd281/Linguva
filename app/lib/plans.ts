/**
 * What each Shopify App Pricing plan includes, and its list price. Plans,
 * prices, trials and plan selection live in the Partner Dashboard (Shopify
 * hosts the plan page and creates the subscription); the app maps the
 * subscribed plan handle to entitlements and shows a hand-kept copy of the
 * prices (PLAN_PRICES), which must equal the Partner Dashboard. Handles must
 * match the plans configured there: free, starter, pro and business (PLANS,
 * the ladder), and own-key with its aliases (OWN_KEY_HANDLES, the Own key
 * plan: OWN_KEY_PLAN) (docs/BILLING_DESIGN.md, docs/PRICING_DECISION.md).
 */

export interface Entitlements {
  plan: string;
  /** Characters sent to AI per month (translation memory reuse is free). */
  monthlyChars: number;
  /** Additional languages that can be translated. */
  maxTargetLocales: number;
  /** Bulk translation jobs. */
  bulk: boolean;
  /** Glossary rules and reuse of unreviewed machine memory. */
  glossary: boolean;
  /** Automatic publishing of bulk results. */
  autoPublish: boolean;
  /** Smart Auto-Translate: scheduled full checks with scope, budgets and activity (Business). */
  smartAuto: boolean;
  /**
   * The Own key plan: AI translation only with the merchant's own engine keys
   * (ShopEngineCredential), never Linguva's; no Linguva character limit applies to
   * those calls (usage-ledger payer "merchant"). Absent on every other plan.
   */
  ownKeys?: boolean;
}

export const PLANS = {
  free: { plan: "free", monthlyChars: 20_000, maxTargetLocales: 1, bulk: false, glossary: false, autoPublish: false, smartAuto: false },
  starter: { plan: "starter", monthlyChars: 300_000, maxTargetLocales: 3, bulk: true, glossary: false, autoPublish: false, smartAuto: false },
  pro: { plan: "pro", monthlyChars: 1_200_000, maxTargetLocales: 10, bulk: true, glossary: true, autoPublish: true, smartAuto: false },
  business: { plan: "business", monthlyChars: 4_000_000, maxTargetLocales: 20, bulk: true, glossary: true, autoPublish: true, smartAuto: true },
} as const satisfies Record<string, Entitlements>;

export type PlanHandle = keyof typeof PLANS;

/**
 * Plan prices in USD. They must equal the plans in the Partner Dashboard
 * (Shopify App Pricing) and the listing's pricing texts; Shopify's plan page
 * is authoritative. yearlyUsd null = no yearly price (Free; Business is
 * monthly only). docs/BILLING_DESIGN.md §2 has the table; a change touches
 * the Partner Dashboard, both listing languages and
 * tests/unit/plan-prices.test.ts on the same day (docs/PRICING_DECISION.md §9).
 * Own key: OWN_KEY_PRICE.
 */
export const PLAN_PRICES = {
  free: { monthlyUsd: 0, yearlyUsd: null },
  starter: { monthlyUsd: 29, yearlyUsd: 290 },
  pro: { monthlyUsd: 99, yearlyUsd: 990 },
  business: { monthlyUsd: 299, yearlyUsd: null },
} as const satisfies Record<PlanHandle, { monthlyUsd: number; yearlyUsd: number | null }>;

/**
 * Free trial on the paid plans: must equal "Free trial duration" in the
 * Partner Dashboard (0 there means 0 here, and no trial text anywhere).
 * 7 only together with the trial allowance below, which
 * app/.server/billing/subscription.ts applies while a trial runs.
 */
export const TRIAL_DAYS: number = 7;
/** AI characters per month while a Shopify trial runs (docs/PRICING_DECISION.md §10.2). */
export const TRIAL_AI_CHARS = 100_000;

/**
 * Everything enabled, for when billing isn't configured (development, before
 * launch), Smart Auto-Translate included; complimentary access gets the
 * Business entitlements too (complimentary.ts).
 */
export const UNMETERED: Entitlements = { ...PLANS.business, plan: "unmetered" };

/** Shopify App Pricing handle of the Own key plan (Partner Dashboard, docs/PRICING_DECISION.md §9). */
export const OWN_KEY = "own-key" as const;
/**
 * Every handle that means Own key: the handle, two spellings in case the Partner Dashboard refuses
 * the hyphen (so no redeploy is needed), and the owner's private test plan in the same three
 * spellings. Exact and case-sensitive; pinned in tests/unit/billing.test.ts.
 */
export const OWN_KEY_HANDLES = ["own-key", "ownkey", "own_key", "own-key-test", "ownkeytest", "own_key_test"] as const;
export type OwnKeyHandle = (typeof OWN_KEY_HANDLES)[number];
export function isOwnKeyHandle(handle: string | null | undefined): handle is OwnKeyHandle {
  return typeof handle === "string" && (OWN_KEY_HANDLES as readonly string[]).includes(handle);
}
/** Every handle the app maps: the four plans of the ladder, then Own key. */
export type KnownPlanHandle = PlanHandle | OwnKeyHandle;

/** Pro's features with the merchant's own keys instead of Linguva's AI characters. Not part of the ladder (PLANS). */
export const OWN_KEY_PLAN = {
  plan: OWN_KEY,
  monthlyChars: 0,
  maxTargetLocales: 10,
  bulk: true,
  glossary: true,
  autoPublish: true,
  smartAuto: false,
  ownKeys: true,
} as const satisfies Entitlements;

/** $49 a month, monthly only (must equal the Partner Dashboard). */
export const OWN_KEY_PRICE = { monthlyUsd: 49, yearlyUsd: null } as const;

export function isKnownPlanHandle(handle: string | null | undefined): handle is KnownPlanHandle {
  return isOwnKeyHandle(handle) || (typeof handle === "string" && handle !== "" && Object.hasOwn(PLANS, handle));
}
export function planEntitlements(handle: KnownPlanHandle): Entitlements {
  return isOwnKeyHandle(handle) ? OWN_KEY_PLAN : PLANS[handle];
}
export function planPrice(handle: KnownPlanHandle): { monthlyUsd: number; yearlyUsd: number | null } {
  return isOwnKeyHandle(handle) ? OWN_KEY_PRICE : PLAN_PRICES[handle];
}
/** Free trial days per plan (Partner Dashboard "Free trial duration"): none on Own key. */
export function trialDaysFor(handle: KnownPlanHandle): number {
  return isOwnKeyHandle(handle) ? 0 : TRIAL_DAYS;
}
/** The plan uses only the merchant's own keys. */
export function usesOwnKeys(entitlements: Pick<Entitlements, "ownKeys"> | null | undefined): boolean {
  return entitlements?.ownKeys === true;
}

/**
 * Entitlements for a subscribed plan handle. Unknown handles get the free
 * plan (never more than paid for); the caller logs them.
 */
export function entitlementsFor(handle: string | null | undefined): Entitlements & { known: boolean } {
  if (isOwnKeyHandle(handle)) return { ...OWN_KEY_PLAN, known: true };
  const plan = handle && Object.hasOwn(PLANS, handle) ? PLANS[handle as PlanHandle] : null;
  return plan ? { ...plan, known: true } : { ...PLANS.free, known: !handle };
}

/** Shopify's hosted plan selection page for this app and store. */
export function planSelectionUrl(shopDomain: string, appHandle: string): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(store) || !/^[a-z0-9][a-z0-9-]*$/.test(appHandle)) {
    throw new Error("Invalid store or app handle");
  }
  return `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`;
}

/** Estimated provider cost in USD for AI characters (internal reports only). */
export function estimatedCostUsd(chars: number, usdPerMillionChars: number): number {
  return Math.round((chars / 1_000_000) * usdPerMillionChars * 100) / 100;
}

/** Characters per rate: engines without a rate of their own (ledger rows without one, "mock") count at DeepL's. */
function charsByRate(usage: Readonly<Record<string, number>>, rates: Readonly<Record<string, number>>): Map<number, number> {
  const byRate = new Map<number, number>();
  for (const [provider, chars] of Object.entries(usage)) {
    if (chars <= 0) continue;
    const rate = rates[provider] ?? rates.deepl ?? 0;
    byRate.set(rate, (byRate.get(rate) ?? 0) + chars);
  }
  return byRate;
}

/**
 * Estimated provider cost in USD of a month's characters per engine (ledger
 * provider → characters) at each engine's rate. One engine: exactly
 * estimatedCostUsd of its characters.
 */
export function estimatedCostByProvider(usage: Readonly<Record<string, number>>, rates: Readonly<Record<string, number>>): number {
  const total = [...charsByRate(usage, rates)].reduce((sum, [rate, chars]) => sum + (chars / 1_000_000) * rate, 0);
  return Math.round(total * 100) / 100;
}

/** The rate a month's characters were translated at: one engine's own rate, or the blend of several (USD per million). */
export function effectiveRatePerMillion(usage: Readonly<Record<string, number>>, rates: Readonly<Record<string, number>>): number {
  const byRate = charsByRate(usage, rates);
  if (byRate.size === 0) return rates.deepl ?? 0;
  if (byRate.size === 1) return [...byRate.keys()][0]!;
  const chars = [...byRate.values()].reduce((a, b) => a + b, 0);
  return [...byRate].reduce((sum, [rate, c]) => sum + rate * c, 0) / chars;
}
