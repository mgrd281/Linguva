/**
 * The shop's languages as Shopify has them now, for background work (no
 * page load keeps the mirror fresh there): read with the shop's offline
 * session at most every few minutes per process, mirrored like a page load
 * does, and the stored mirror when Shopify can't be asked.
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { withTenant } from "../tenancy/with-tenant";
import { fetchAndSyncShopLocales, summarizeLocales, type LocaleSummary } from "./shop-locales";

export const CURRENT_LOCALES_MAX_AGE_MS = 5 * 60_000;

export interface CurrentLocales {
  primary: string | null;
  /** Additional languages in the order the app lists them everywhere (by name; the plan's language limit takes the first ones). */
  targets: string[];
  /** Read from Shopify by this call (false: a copy up to a few minutes old, or the stored mirror). */
  fresh: boolean;
}

const cache = new Map<string, { at: number; value: CurrentLocales }>();

/** Tests only. */
export function forgetCurrentLocales() {
  cache.clear();
}

export async function currentShopLocales(
  shopId: string,
  admin: () => Promise<Pick<AdminApiContext, "graphql">>,
  client: PrismaClient = defaultClient,
  now = Date.now(),
  /** 0: ask Shopify now (to confirm a change before acting on it). */
  maxAgeMs = CURRENT_LOCALES_MAX_AGE_MS,
): Promise<CurrentLocales> {
  const cached = cache.get(shopId);
  if (cached && now - cached.at < maxAgeMs) return { ...cached.value, fresh: false };
  try {
    const value = fromSummary(await fetchAndSyncShopLocales(await admin(), shopId, client), true);
    cache.set(shopId, { at: now, value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return value;
  } catch (error) {
    logger.warn({ shopId, err: (error as Error).name }, "shop languages: using the stored copy");
    const rows = await withTenant(shopId, (tx) => tx.shopLocale.findMany({ where: { shopId } }), client);
    // Sorted like a fresh read, so the plan's language limit picks the same languages either way.
    return fromSummary(summarizeLocales(rows), false);
  }
}

function fromSummary(summary: LocaleSummary, fresh: boolean): CurrentLocales {
  return { primary: summary.primary?.locale ?? null, targets: summary.locales.filter((l) => !l.primary).map((l) => l.locale), fresh };
}
