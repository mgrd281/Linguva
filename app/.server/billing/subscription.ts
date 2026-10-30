/**
 * Subscription state and entitlements per shop (Shopify App Pricing).
 *
 * - Shopify is authoritative. The Partner API is queried at most every
 *   SUBSCRIPTION_TTL_MS per shop, after a plan change (welcome link) and on
 *   demand; the result is cached in ShopSubscription (under RLS).
 * - "Couldn't check" never counts as "not subscribed": on Partner API errors
 *   the last known state is used, and a shop that was never checked gets the
 *   free plan without being sent to the plan page.
 * - Without Partner API settings, billing is off: every shop is unmetered
 *   (development and the time before plans exist).
 * - While a Shopify free trial runs, the AI allowance is capped at
 *   TRIAL_AI_CHARS (docs/PRICING_DECISION.md §10.2): a trial can't be used
 *   as a free first pass of the whole catalog. The cap only lowers the
 *   allowance, and it ends by the clock, not with the next check.
 */
import type { PrismaClient, ShopSubscription } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { withTenant } from "../tenancy/with-tenant";
import { entitlementsFor, PLANS, TRIAL_AI_CHARS, UNMETERED, type Entitlements } from "../../lib/plans";
import { activeComplimentaryAccess, complimentaryEntitlements } from "./complimentary";
import { fetchActiveSubscription, PartnerApiError, type PartnerApiSettings } from "./partner-api";

export const SUBSCRIPTION_TTL_MS = 6 * 60 * 60 * 1000;

export interface BillingDeps {
  prisma?: PrismaClient;
  settings: PartnerApiSettings | null;
  /** Shops without a subscription are sent to the plan selection page. */
  required: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Shop GIDs eligible for owner complimentary access (server configuration). */
  complimentaryGids?: readonly string[];
}

export interface BillingStatus {
  /** The entitlements come from billing: a plan, or complimentary access. */
  configured: boolean;
  /**
   * ACTIVE: subscribed; NONE: verified no subscription; UNKNOWN: couldn't
   * verify yet; COMPLIMENTARY: owner complimentary access (no subscription).
   */
  state: "ACTIVE" | "NONE" | "UNKNOWN" | "COMPLIMENTARY";
  entitlements: Entitlements;
  subscription: ShopSubscription | null;
  /** The cached state is older than the TTL because the Partner API failed. */
  stale: boolean;
  /** Send the merchant to the plan selection page (only with a verified NONE). */
  mustChoosePlan: boolean;
  /**
   * Set while a Shopify free trial runs (its end, from the cached
   * subscription): the AI allowance is capped at TRIAL_AI_CHARS until then.
   * Absent when no trial runs.
   */
  trialEndsAt?: Date;
}

const SHOP_ID_QUERY = `#graphql
  query LinguvaShopId {
    shop {
      id
    }
  }
`;

/** The shop's GID (needed by the Partner API), stored on first use. */
export async function ensureShopGid(
  admin: Pick<AdminApiContext, "graphql">,
  shop: { id: string; shopifyShopGid: string | null },
  client: PrismaClient = defaultClient,
): Promise<string | null> {
  if (shop.shopifyShopGid) return shop.shopifyShopGid;
  const response = await admin.graphql(SHOP_ID_QUERY);
  const gid = (await response.json()).data?.shop?.id ?? null;
  if (gid) await client.shop.update({ where: { id: shop.id }, data: { shopifyShopGid: gid } });
  return gid;
}

/**
 * The status a cached subscription row stands for. Exported for tests.
 * The trial is compared with the current time (deps.now), so the full
 * allowance starts exactly when the trial ends, even with a cached row.
 */
export function statusFrom(row: ShopSubscription | null, deps: BillingDeps, stale: boolean): BillingStatus {
  if (!row) {
    return { configured: true, state: "UNKNOWN", entitlements: PLANS.free, subscription: null, stale, mustChoosePlan: false };
  }
  if (row.state === "NONE") {
    return { configured: true, state: "NONE", entitlements: PLANS.free, subscription: row, stale, mustChoosePlan: deps.required };
  }
  const resolved = entitlementsFor(row.planHandle);
  if (!resolved.known) logger.warn({ plan: row.planHandle }, "unknown plan handle; using the free plan");
  const now = (deps.now ?? (() => new Date()))();
  // A running trial only ever lowers the allowance (never above the plan's).
  const trialEndsAt = row.trialEndsAt && row.trialEndsAt.getTime() > now.getTime() ? row.trialEndsAt : null;
  const entitlements: Entitlements = {
    plan: resolved.plan,
    monthlyChars: trialEndsAt ? Math.min(resolved.monthlyChars, TRIAL_AI_CHARS) : resolved.monthlyChars,
    maxTargetLocales: resolved.maxTargetLocales,
    bulk: resolved.bulk,
    glossary: resolved.glossary,
    autoPublish: resolved.autoPublish,
    smartAuto: resolved.smartAuto,
  };
  return { configured: true, state: "ACTIVE", entitlements, subscription: row, stale, mustChoosePlan: false, ...(trialEndsAt ? { trialEndsAt } : {}) };
}

/** Queries the Partner API now and updates the cache. */
export async function refreshSubscription(
  deps: BillingDeps,
  shop: { id: string; shopifyShopGid: string | null },
): Promise<ShopSubscription | null> {
  if (!deps.settings || !shop.shopifyShopGid) return null;
  const client = deps.prisma ?? defaultClient;
  const now = (deps.now ?? (() => new Date()))();
  const sub = await fetchActiveSubscription(deps.settings, shop.shopifyShopGid, deps.fetchImpl);
  const data = {
    state: sub ? ("ACTIVE" as const) : ("NONE" as const),
    planHandle: sub?.planHandle ?? null,
    pendingPlanHandle: sub?.pendingPlanHandle ?? null,
    billingPeriod: sub?.billingPeriod ?? null,
    trialEndsAt: sub?.trialEndsAt ?? null,
    cancelAtEndOfCycle: sub?.cancelAtEndOfCycle ?? false,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    checkedAt: now,
  };
  // Insert-if-missing, then update: pages load in parallel and may refresh
  // the cache at the same moment (an upsert can then hit the unique constraint).
  return withTenant(
    shop.id,
    async (tx) => {
      await tx.shopSubscription.createMany({ data: [{ shopId: shop.id, ...data }], skipDuplicates: true });
      return tx.shopSubscription.update({ where: { shopId: shop.id }, data });
    },
    client,
  );
}

/**
 * The shop's billing status and entitlements. Uses the cache while it is
 * fresh; `force` re-checks (for example after the welcome link). With
 * `minAgeMs`, a forced check reuses a successful check younger than that
 * (the Plan page's refresh); a failed check never updates `checkedAt`, so
 * it is asked again.
 */
export async function getBillingStatus(
  deps: BillingDeps,
  shop: { id: string; shopifyShopGid: string | null },
  options: { force?: boolean; minAgeMs?: number } = {},
): Promise<BillingStatus> {
  // Complimentary access needs no subscription and wins over any plan.
  const complimentary = await activeComplimentaryAccess(
    shop,
    deps.complimentaryGids ?? [],
    deps.prisma ?? defaultClient,
    (deps.now ?? (() => new Date()))(),
  );
  if (complimentary) {
    return {
      configured: true,
      state: "COMPLIMENTARY",
      entitlements: complimentaryEntitlements(complimentary),
      subscription: null,
      stale: false,
      mustChoosePlan: false,
    };
  }
  if (!deps.settings) {
    return { configured: false, state: "ACTIVE", entitlements: UNMETERED, subscription: null, stale: false, mustChoosePlan: false };
  }
  const client = deps.prisma ?? defaultClient;
  const now = (deps.now ?? (() => new Date()))().getTime();
  const cached = await withTenant(shop.id, (tx) => tx.shopSubscription.findUnique({ where: { shopId: shop.id } }), client);
  const age = cached ? now - cached.checkedAt.getTime() : Infinity;
  const fresh = age < SUBSCRIPTION_TTL_MS;
  const recent = options.minAgeMs !== undefined && age < options.minAgeMs;
  if (cached && fresh && (!options.force || recent)) return statusFrom(cached, deps, false);
  try {
    const row = await refreshSubscription(deps, shop);
    return statusFrom(row ?? cached, deps, !row && Boolean(cached));
  } catch (error) {
    if (!(error instanceof PartnerApiError)) throw error;
    logger.warn({ retryable: error.retryable }, "subscription check failed; using the last known state");
    return statusFrom(cached, deps, Boolean(cached));
  }
}

/**
 * The target languages a plan covers: the first N additional languages in
 * the order the app lists them (`summarizeLocales`: by language name), so
 * the editor, bulk jobs, coverage and automatic translation pick the same ones.
 */
export function allowedTargetLocales(entitlements: Entitlements, targets: readonly string[]): string[] {
  return targets.slice(0, entitlements.maxTargetLocales);
}
