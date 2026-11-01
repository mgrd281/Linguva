/**
 * What each Shopify App Pricing plan includes, and its list price. Plans,
 * prices, trials and plan selection live in the Partner Dashboard (Shopify
 * hosts the plan page and creates the subscription); the app maps the
 * subscribed plan handle to entitlements and shows a hand-kept copy of the
 * prices (PLAN_PRICES), which must equal the Partner Dashboard. Handles must
 * match the plans configured there (docs/BILLING_DESIGN.md,
 * docs/PRICING_DECISION.md).
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

/**
 * Entitlements for a subscribed plan handle. Unknown handles get the free
 * plan (never more than paid for); the caller logs them.
 */
export function entitlementsFor(handle: string | null | undefined): Entitlements & { known: boolean } {
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
