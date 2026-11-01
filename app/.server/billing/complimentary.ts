/**
 * Owner complimentary access (docs/BILLING_DESIGN.md §4): the operator's own
 * stores get every feature without a subscription, while their AI usage is
 * still metered and costed internally.
 *
 * A store qualifies only when BOTH hold:
 * 1. Server configuration: its Shopify shop GID is in COMPLIMENTARY_SHOP_GIDS.
 * 2. Database: an active ComplimentaryAccess row exists for it, created by
 *    the operator tool with the owner role (the app's runtime role can only
 *    read that table), with the same GID as Shop.shopifyShopGid.
 * The GID comes from Shopify (shop { id } with the store's own token), never
 * from a request. Shop names, domains and e-mail addresses are never used.
 */
import type { ComplimentaryAccess, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { getMonthlyUsage, getMonthlyUsageByProvider, periodKey } from "../usage/usage-ledger";
import { estimatedCostByProvider, estimatedCostUsd, PLANS, type Entitlements } from "../../lib/plans";

const SHOP_GID = /^gid:\/\/shopify\/Shop\/\d+$/;

/** Default monthly AI allowance for a complimentary store (the cost cap). */
export const DEFAULT_COMPLIMENTARY_CHARS = 2_000_000;

export function complimentaryEntitlements(access: Pick<ComplimentaryAccess, "monthlyCharLimit">): Entitlements {
  return { ...PLANS.business, plan: "complimentary", monthlyChars: access.monthlyCharLimit };
}

export function isActiveGrant(
  access: ComplimentaryAccess | null,
  shop: { shopifyShopGid: string | null },
  allowlist: readonly string[],
  now: Date = new Date(),
): access is ComplimentaryAccess {
  return Boolean(
    access &&
      !access.revokedAt &&
      (!access.expiresAt || access.expiresAt > now) &&
      shop.shopifyShopGid &&
      access.shopifyShopGid === shop.shopifyShopGid &&
      allowlist.includes(shop.shopifyShopGid),
  );
}

/** The shop's active complimentary access, or null. */
export async function activeComplimentaryAccess(
  shop: { id: string; shopifyShopGid: string | null },
  allowlist: readonly string[],
  client: PrismaClient = defaultClient,
  now: Date = new Date(),
): Promise<ComplimentaryAccess | null> {
  // Without a configured allowlist nothing can qualify: skip the query.
  if (!allowlist.length || !shop.shopifyShopGid || !allowlist.includes(shop.shopifyShopGid)) return null;
  const access = await withTenant(shop.id, (tx) => tx.complimentaryAccess.findUnique({ where: { shopId: shop.id } }), client);
  return isActiveGrant(access, shop, allowlist, now) ? access : null;
}

export class ComplimentaryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplimentaryAccessError";
  }
}

function requireText(value: string | undefined, what: string, max = 200): string {
  const text = value?.trim() ?? "";
  if (!text) throw new ComplimentaryAccessError(`${what} is required`);
  if (text.length > max) throw new ComplimentaryAccessError(`${what} is too long`);
  return text;
}

async function shopByGid(owner: PrismaClient, shopifyShopGid: string) {
  if (!SHOP_GID.test(shopifyShopGid)) throw new ComplimentaryAccessError("Expected a shop GID like gid://shopify/Shop/123");
  const shop = await owner.shop.findUnique({ where: { shopifyShopGid } });
  if (!shop) {
    throw new ComplimentaryAccessError("No installed shop has this GID. Install the app on the store and open it once first.");
  }
  return shop;
}

/**
 * Grants (or renews) complimentary access. Operator tool only: `owner` must
 * be a connection with the owner role (MIGRATION_DATABASE_URL).
 */
export async function grantComplimentaryAccess(
  owner: PrismaClient,
  input: { shopifyShopGid: string; reason: string; operator: string; monthlyCharLimit?: number; expiresAt?: Date | null },
) {
  const shop = await shopByGid(owner, input.shopifyShopGid);
  const reason = requireText(input.reason, "A reason");
  const operator = requireText(input.operator, "The operator", 100);
  const monthlyCharLimit = input.monthlyCharLimit ?? DEFAULT_COMPLIMENTARY_CHARS;
  if (!Number.isInteger(monthlyCharLimit) || monthlyCharLimit <= 0 || monthlyCharLimit > 100_000_000) {
    throw new ComplimentaryAccessError("The monthly character limit must be between 1 and 100,000,000");
  }
  if (input.expiresAt && input.expiresAt <= new Date()) throw new ComplimentaryAccessError("The expiry date is in the past");
  const data = {
    shopifyShopGid: input.shopifyShopGid,
    reason,
    grantedBy: operator,
    monthlyCharLimit,
    grantedAt: new Date(),
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  const access = await withTenant(
    shop.id,
    (tx) => tx.complimentaryAccess.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data }),
    owner,
  );
  await owner.auditLog.createMany({
    data: [
      {
        shopId: shop.id,
        actorType: "ADMIN",
        actorId: operator,
        action: "complimentary_access.granted",
        targetType: "Shop",
        targetId: input.shopifyShopGid,
        metadata: { reason, monthlyCharLimit, expiresAt: data.expiresAt?.toISOString() ?? null },
      },
    ],
  });
  return access;
}

export async function revokeComplimentaryAccess(
  owner: PrismaClient,
  input: { shopifyShopGid: string; reason: string; operator: string },
) {
  const shop = await shopByGid(owner, input.shopifyShopGid);
  const reason = requireText(input.reason, "A reason");
  const operator = requireText(input.operator, "The operator", 100);
  const updated = await withTenant(
    shop.id,
    (tx) =>
      tx.complimentaryAccess.updateMany({
        where: { shopId: shop.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: operator, revokeReason: reason },
      }),
    owner,
  );
  if (updated.count === 0) throw new ComplimentaryAccessError("This shop has no active complimentary access");
  await owner.auditLog.createMany({
    data: [
      {
        shopId: shop.id,
        actorType: "ADMIN",
        actorId: operator,
        action: "complimentary_access.revoked",
        targetType: "Shop",
        targetId: input.shopifyShopGid,
        metadata: { reason },
      },
    ],
  });
}

/**
 * Usage and estimated AI cost of every store with a complimentary grant
 * (active or not) for a month, for the operator's internal report. With
 * `ratesByProvider` (USD per million characters per engine) each row adds
 * its characters per engine and the cost at each engine's rate; without it,
 * one rate for every character, as before engines could be combined.
 */
export async function complimentaryUsageReport(
  owner: PrismaClient,
  options: { allowlist: readonly string[]; usdPerMillionChars: number; period?: string; ratesByProvider?: Readonly<Record<string, number>> },
) {
  const period = options.period ?? periodKey();
  // Shop isn't under RLS; each grant is read under its own tenant.
  const shops = await owner.shop.findMany({ where: { shopifyShopGid: { not: null } }, orderBy: { shopDomain: "asc" } });
  const rows = [];
  for (const shop of shops) {
    const access = await withTenant(shop.id, (tx) => tx.complimentaryAccess.findUnique({ where: { shopId: shop.id } }), owner);
    if (!access) continue;
    const chars = await getMonthlyUsage(shop.id, period, owner);
    const byProvider = options.ratesByProvider ? await getMonthlyUsageByProvider(shop.id, period, owner) : null;
    rows.push({
      // For the operator's reading only; decisions use the GID.
      shopDomain: shop.shopDomain,
      shopifyShopGid: shop.shopifyShopGid!,
      active: isActiveGrant(access, shop, options.allowlist),
      inAllowlist: options.allowlist.includes(shop.shopifyShopGid!),
      monthlyCharLimit: access.monthlyCharLimit,
      period,
      chars,
      ...(byProvider ? { byProvider } : {}),
      estimatedCostUsd: byProvider && options.ratesByProvider ? estimatedCostByProvider(byProvider, options.ratesByProvider) : estimatedCostUsd(chars, options.usdPerMillionChars),
      grantedBy: access.grantedBy,
      revokedAt: access.revokedAt,
      expiresAt: access.expiresAt,
    });
  }
  return rows;
}
