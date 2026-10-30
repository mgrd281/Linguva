/**
 * App wiring for billing: configuration, per-request status and the AI
 * character limits that follow from the plan.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { complimentaryShopGids, getConfig, partnerApiSettings, type AppConfig } from "../lib/config";
import type { Entitlements } from "../../lib/plans";
import { ensureShopGid, getBillingStatus, type BillingDeps } from "./subscription";

export function billingDeps(config: AppConfig = getConfig()): BillingDeps {
  return {
    settings: partnerApiSettings(config),
    required: config.BILLING_REQUIRED === "true",
    complimentaryGids: complimentaryShopGids(config),
  };
}

export async function shopBilling(
  admin: Pick<AdminApiContext, "graphql">,
  shop: { id: string; shopifyShopGid: string | null },
  options: { force?: boolean; minAgeMs?: number } = {},
) {
  const deps = billingDeps();
  // The GID (from Shopify) identifies the shop to the Partner API and for
  // complimentary access.
  const needsGid = Boolean(deps.settings) || Boolean(deps.complimentaryGids?.length);
  const shopifyShopGid = needsGid ? await ensureShopGid(admin, shop) : shop.shopifyShopGid;
  return getBillingStatus(deps, { id: shop.id, shopifyShopGid }, options);
}

/**
 * AI character limits for a shop: the plan's monthly allowance when billing
 * is on (the env allowance otherwise), the daily cap never above it, and the
 * platform cap unchanged.
 */
export function aiLimitsFor(config: AppConfig, billing: { configured: boolean; entitlements: Entitlements }) {
  const monthly = billing.configured ? billing.entitlements.monthlyChars : config.AI_MONTHLY_CHAR_LIMIT;
  return {
    limit: monthly,
    dailyLimit: Math.min(config.AI_DAILY_CHAR_LIMIT ?? monthly, monthly),
    platformDailyLimit: config.AI_PLATFORM_DAILY_CHAR_LIMIT,
  };
}
