import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";

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
      await tx.shopLocale.deleteMany({
        where: { shopId, locale: { notIn: locales.map((l) => l.locale) } },
      });
      for (const l of locales) {
        await tx.shopLocale.upsert({
          where: { shopId_locale: { shopId, locale: l.locale } },
          create: {
            shopId,
            locale: l.locale,
            name: l.name,
            primary: l.primary,
            published: l.published,
            syncedAt,
          },
          update: {
            name: l.name,
            primary: l.primary,
            published: l.published,
            syncedAt,
          },
        });
      }
    },
    client,
  );
}

/** Language names by code, from the last sync (no Shopify call). */
export async function storedLocaleNames(shopId: string, client: PrismaClient = defaultClient): Promise<Record<string, string>> {
  const rows = await withTenant(shopId, (tx) => tx.shopLocale.findMany({ where: { shopId }, select: { locale: true, name: true } }), client);
  return Object.fromEntries(rows.map((r) => [r.locale, r.name]));
}
