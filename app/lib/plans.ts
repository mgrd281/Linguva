/**
 * What each Shopify App Pricing plan includes. Prices, trials and plan
 * selection live in the Partner Dashboard (Shopify hosts the plan page and
 * creates the subscription); the app only maps the subscribed plan handle to
 * entitlements. Handles must match the plans configured in the Partner
 * Dashboard (docs/BILLING_DESIGN.md).
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
