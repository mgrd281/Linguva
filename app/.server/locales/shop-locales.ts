import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { dropOtherLocalesTx } from "../coverage/items";

import { MAX_ENABLED_LOCALES } from "../../lib/locale-limits";

export { MAX_ENABLED_LOCALES };

// Locales whose scripts are written right-to-left. Used for UI warnings.
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "ckb", "dv"]);

export interface ShopLocaleInfo {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
  rtl: boolean;
}

export const SHOP_LOCALES_QUERY = `#graphql
  query LinguvaShopLocales {
    shopLocales {
      locale
      name
      primary
      published
    }
  }
`;

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has(locale.toLowerCase().split("-")[0]!);
}

export interface LocaleSummary {
  locales: ShopLocaleInfo[];
  primary: ShopLocaleInfo | undefined;
  enabledCount: number;
  publishedCount: number;
  remainingEnabled: number;
}

/** Normalizes the raw `shopLocales` payload: primary first, then by name. */
export function summarizeLocales(
  raw: ReadonlyArray<{
    locale: string;
    name: string;
    primary: boolean;
    published: boolean;
  }>,
): LocaleSummary {
  const locales = raw
    .map((l) => ({ ...l, rtl: isRtlLocale(l.locale) }))
    .sort(
      (a, b) =>
        Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
    );
  return {
    locales,
    primary: locales.find((l) => l.primary),
    enabledCount: locales.length,
    publishedCount: locales.filter((l) => l.published).length,
    remainingEnabled: Math.max(0, MAX_ENABLED_LOCALES - locales.length),
  };
}

export class ShopifyGraphqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

/** Reads the shop's locales from Shopify (authoritative) and mirrors them. */
export async function fetchAndSyncShopLocales(
  admin: Pick<AdminApiContext, "graphql">,
  shopId: string,
  client: PrismaClient = defaultClient,
): Promise<LocaleSummary> {
  const response = await admin.graphql(SHOP_LOCALES_QUERY);
  const body = await response.json();
  if (!body.data?.shopLocales) {
    throw new ShopifyGraphqlError("shopLocales query returned no data");
  }
  const summary = summarizeLocales(body.data.shopLocales);
  await syncShopLocales(shopId, summary.locales, client);
  return summary;
}

/**
 * Mirrors the shop's locales. When its additional languages change (one
 * removed, or the primary language changed), what belonged to a language
 * that is no longer one goes with it: its coverage (so it is measured again
 * before it counts, if added back) and its pending drafts, which can't be
 * published any more (STALE, LOCALE_GONE).
 */
export async function syncShopLocales(
  shopId: string,
  locales: ShopLocaleInfo[],
  client: PrismaClient = defaultClient,
) {
  const syncedAt = new Date();
  await withTenant(
    shopId,
    async (tx) => {
      // Most page loads see the same locales; skip the writes then.
      const stored = await tx.shopLocale.findMany({ where: { shopId } });
      const same =
        stored.length === locales.length &&
        locales.every((l) =>
          stored.some((s) => s.locale === l.locale && s.name === l.name && s.primary === l.primary && s.published === l.published),
        );
      if (same) return;
      const before = new Set(stored.filter((s) => !s.primary).map((s) => s.locale));
      const targets = locales.filter((l) => !l.primary).map((l) => l.locale);
      if (stored.length === 0 || targets.length !== before.size || targets.some((l) => !before.has(l))) {
        await dropOtherLocalesTx(tx, shopId, targets);
        await tx.translationDraft.updateMany({
          where: { shopId, status: "PENDING", locale: { notIn: targets } },
          data: { status: "STALE", staleReason: "LOCALE_GONE" },
        });
      }
      await tx.shopLocale.deleteMany({
        where: { shopId, locale: { notIn: locales.map((l) => l.locale) } },
      });
      // Insert-if-missing, then update: safe when several pages sync at once
      // (an upsert can hit the unique constraint when two inserts race).
      await tx.shopLocale.createMany({
        data: locales.map((l) => ({ shopId, locale: l.locale, name: l.name, primary: l.primary, published: l.published, syncedAt })),
        skipDuplicates: true,
      });
      for (const l of locales) {
        await tx.shopLocale.update({
          where: { shopId_locale: { shopId, locale: l.locale } },
          data: { name: l.name, primary: l.primary, published: l.published, syncedAt },
        });
      }
    },
    client,
  );
}

/** The store's additional languages from the last sync, or null before the first one (nothing to tell them apart by). */
export async function storedTargetLocales(tx: TenantTx, shopId: string): Promise<string[] | null> {
  const rows = await tx.shopLocale.findMany({ where: { shopId }, select: { locale: true, primary: true } });
  return rows.length ? rows.filter((r) => !r.primary).map((r) => r.locale) : null;
}

/** Language names by code, from the last sync (no Shopify call). */
export async function storedLocaleNames(shopId: string, client: PrismaClient = defaultClient): Promise<Record<string, string>> {
  const rows = await withTenant(shopId, (tx) => tx.shopLocale.findMany({ where: { shopId }, select: { locale: true, name: true } }), client);
  return Object.fromEntries(rows.map((r) => [r.locale, r.name]));
}
