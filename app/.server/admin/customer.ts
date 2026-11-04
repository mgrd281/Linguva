/**
 * One store in the admin console: its directory row plus six months of usage,
 * its languages, installations, recent jobs and two settings flags; and
 * "ask Shopify again" for its subscription. Ids, plans, dates and counts
 * only, never merchant content. Shop is read without a tenant (a global
 * table); everything else inside withTenant(shop.id).
 */
import type { PrismaClient } from "@prisma/client";
import { billingDeps } from "../billing/billing";
import { PartnerApiError } from "../billing/partner-api";
import { refreshSubscription } from "../billing/subscription";
import { getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { settleAll } from "../lib/settle";
import { withTenant } from "../tenancy/with-tenant";
import { periodKey } from "../usage/usage-ledger";
import { estimatedCostByProvider } from "../../lib/plans";
import { invalidateDirectoryCache, readShopFacts, rowContext, SHOP_SELECT, shopRow, type ShopRow } from "./directory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_STATUSES = ["PENDING", "DISCOVERING", "RUNNING", "COMPLETED", "CANCELLED", "FAILED"] as const;
const JOBS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MONTHS = 6;

/** The store's page in Shopify's admin, from its myshopify.com domain (null for any other domain). */
export function shopifyAdminUrl(shopDomain: string): string | null {
  const handle = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.exec(shopDomain)?.[1];
  return handle ? `https://admin.shopify.com/store/${handle}` : null;
}

/** The UTC month of `now` and the five before it, newest first ("2026-11", "2026-10", …). */
export function recentPeriods(now: Date, count = MONTHS): string[] {
  return Array.from({ length: count }, (_, i) => periodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
}

export interface CustomerDetail {
  shop: ShopRow;
  shopifyShopGid: string | null;
  adminUrl: string | null;
  /** The ComplimentaryAccess row as it stands (active: it applies now, with COMPLIMENTARY_SHOP_GIDS); null: never granted. */
  complimentary: null | { active: boolean; monthlyCharLimit: number; expiresAt: string | null; revokedAt: string | null; grantedAt: string };
  /** The current UTC month and the five before it, newest first. */
  usageByMonth: Array<{ period: string; chars: number; ownKeyChars: number; costUsd: number }>;
  /** Primary first, then by code. */
  locales: Array<{ locale: string; primary: boolean; published: boolean }>;
  /** Newest first, at most 20. */
  installations: Array<{ event: string; occurredAt: string }>;
  /** Jobs created in the last 30 days per status (every status, 0 included); the newest job ever. */
  jobs: { last30: Record<string, number>; lastAt: string | null };
  settings: { autoTranslateNew: boolean; smartAuto: boolean };
}

/** One store, or null for an id that isn't a shop UUID or isn't a shop. */
export async function loadCustomer(shopId: string, opts: { client?: PrismaClient; now?: Date; config?: AppConfig } = {}): Promise<CustomerDetail | null> {
  if (!UUID.test(shopId)) return null;
  const client = opts.client ?? defaultClient;
  const now = opts.now ?? new Date();
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: SHOP_SELECT });
  if (!shop) return null;
  const periods = recentPeriods(now);
  const since = new Date(now.getTime() - JOBS_WINDOW_MS);
  const [read, ctx] = await settleAll([
    withTenant(
      shop.id,
      async (tx) => {
        const facts = await readShopFacts(tx, shop, periods[0]!);
        const usage = await tx.usageLedger.groupBy({
          by: ["periodKey", "provider", "payer"],
          where: { shopId: shop.id, periodKey: { in: periods } },
          _sum: { chars: true },
        });
        const locales = await tx.shopLocale.findMany({
          where: { shopId: shop.id },
          select: { locale: true, primary: true, published: true },
          orderBy: [{ primary: "desc" }, { locale: "asc" }],
        });
        const installations = await tx.shopInstallation.findMany({
          where: { shopId: shop.id },
          select: { event: true, occurredAt: true },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 20,
        });
        const jobs = await tx.translationJob.groupBy({ by: ["status"], where: { shopId: shop.id, createdAt: { gte: since } }, _count: { _all: true } });
        const settings = await tx.shopSettings.findUnique({ where: { shopId: shop.id }, select: { autoTranslateNew: true } });
        const smart = await tx.smartAutoConfig.findUnique({ where: { shopId: shop.id }, select: { enabled: true } });
        return { facts, usage, locales, installations, jobs, settings, smart };
      },
      client,
    ),
    rowContext({ client, now, config: opts.config }),
  ]);
  const row = shopRow(read.facts, ctx);
  const usageByMonth = periods.map((period) => {
    const rows = read.usage.filter((u) => u.periodKey === period);
    const byProvider: Record<string, number> = {};
    let chars = 0;
    let ownKeyChars = 0;
    for (const u of rows) {
      const sum = u._sum.chars ?? 0;
      if (u.payer === "merchant") ownKeyChars += sum;
      else {
        chars += sum;
        const provider = u.provider ?? "deepl";
        byProvider[provider] = (byProvider[provider] ?? 0) + sum;
      }
    }
    return { period, chars, ownKeyChars, costUsd: estimatedCostByProvider(byProvider, ctx.rates) };
  });
  const last30: Record<string, number> = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0]));
  for (const job of read.jobs) last30[job.status] = job._count._all;
  const grant = read.facts.grant;
  return {
    shop: row,
    shopifyShopGid: shop.shopifyShopGid,
    adminUrl: shopifyAdminUrl(shop.shopDomain),
    complimentary: grant
      ? {
          active: row.complimentary,
          monthlyCharLimit: grant.monthlyCharLimit,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          grantedAt: grant.grantedAt.toISOString(),
        }
      : null,
    usageByMonth,
    locales: read.locales,
    installations: read.installations.map((i) => ({ event: i.event, occurredAt: i.occurredAt.toISOString() })),
    jobs: { last30, lastAt: row.lastJobAt },
    settings: { autoTranslateNew: read.settings?.autoTranslateNew ?? false, smartAuto: read.smart?.enabled ?? false },
  };
}

export type RefreshResult = { ok: true } | { ok: false; reason: "NOT_CONFIGURED" | "NO_GID" | "SHOPIFY_UNAVAILABLE" | "NOT_FOUND" };

/**
 * "Ask Shopify again": the store's subscription from the Partner API now,
 * into its cache (refreshSubscription, the same as the Plan page's refresh).
 * The route checked the admin's "refresh" capability. A successful check is
 * audited (admin.subscription.refreshed) and the directory is read again.
 */
export async function refreshCustomerSubscription(
  shopId: string,
  actor: { userId: string },
  opts: { client?: PrismaClient; config?: AppConfig; fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<RefreshResult> {
  if (!UUID.test(shopId)) return { ok: false, reason: "NOT_FOUND" };
  const client = opts.client ?? defaultClient;
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopifyShopGid: true } });
  if (!shop) return { ok: false, reason: "NOT_FOUND" };
  const deps = { ...billingDeps(opts.config ?? getConfig()), prisma: client, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.now ? { now: opts.now } : {}) };
  if (!deps.settings) return { ok: false, reason: "NOT_CONFIGURED" };
  // The GID is stored when the store first opens the app with billing configured; the console has no Admin API session to ask for it.
  if (!shop.shopifyShopGid) return { ok: false, reason: "NO_GID" };
  let row: Awaited<ReturnType<typeof refreshSubscription>>;
  try {
    row = await refreshSubscription(deps, shop);
  } catch (error) {
    if (!(error instanceof PartnerApiError)) throw error;
    logger.warn({ retryable: error.retryable }, "admin console: subscription check failed");
    return { ok: false, reason: "SHOPIFY_UNAVAILABLE" };
  }
  // createMany: the runtime role may only add to the audit log, never read it back.
  await client.auditLog.createMany({
    data: [
      {
        shopId: shop.id,
        actorType: "ADMIN",
        actorId: actor.userId,
        action: "admin.subscription.refreshed",
        targetType: "Shop",
        targetId: shop.id,
        metadata: { state: row?.state ?? null, planHandle: row?.planHandle ?? null },
      },
    ],
  });
  invalidateDirectoryCache();
  return { ok: true };
}
