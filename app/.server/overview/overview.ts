/**
 * The Overview page: a getting-started checklist for new merchants, how
 * complete each language is, AI usage against the allowance, and what
 * needs attention (drafts to review, running jobs).
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { getConfig } from "../lib/config";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { countPendingDrafts } from "../review/drafts";
import { loadCoverage } from "../coverage/coverage";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage } from "../usage/usage-ledger";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import { MAX_ENABLED_LOCALES } from "../../lib/locale-limits";
import { usageLevel } from "../../lib/usage";

type Admin = Pick<AdminApiContext, "graphql">;

export interface ChecklistStep {
  id: "language" | "consent" | "first-translation" | "review" | "publish-language";
  label: string;
  detail: string;
  done: boolean;
  href: string;
  action: string;
  external?: boolean;
}

export async function loadOverview(
  admin: Admin,
  shop: { id: string; name: string | null; shopDomain: string; installedAt: Date; shopifyShopGid: string | null },
  client: PrismaClient = defaultClient,
) {
  const [locales, settings, billing] = await Promise.all([
    fetchAndSyncShopLocales(admin, shop.id, client),
    getShopSettings(shop.id, client),
    shopBilling(admin, shop),
  ]);
  const [pendingDrafts, published, activeJobs, coverage, used, usedToday] = await Promise.all([
    countPendingDrafts(shop.id, client),
    withTenant(shop.id, (tx) => tx.translationRevision.count({ where: { shopId: shop.id, origin: { in: ["AI", "MANUAL"] } } }), client),
    withTenant(shop.id, (tx) => tx.translationJob.count({ where: { shopId: shop.id, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } } }), client),
    loadCoverage(shop.id, client),
    getMonthlyUsage(shop.id, undefined, client),
    getDailyUsage(shop.id, client),
  ]);
  const targets = locales.locales.filter((l) => !l.primary);
  const consent = hasCurrentAiConsent(settings);
  const firstTarget = targets[0]?.locale;

  const checklist: ChecklistStep[] = [
    {
      id: "language",
      label: "Add a language",
      detail: "Choose the languages you sell in, in Shopify's language settings.",
      done: targets.length > 0,
      href: "shopify://admin/settings/languages",
      action: "Open language settings",
      external: true,
    },
    {
      id: "consent",
      label: "Allow AI translation",
      detail: "AI drafts are reviewed by you before anything is published.",
      done: consent,
      href: "/app/settings",
      action: "Open settings",
    },
    {
      id: "first-translation",
      label: "Publish your first translation",
      detail: "Open a product, translate it with AI, check the result and publish.",
      done: published > 0,
      href: firstTarget ? `/app/products?locale=${encodeURIComponent(firstTarget)}` : "/app/products",
      action: "Translate products",
    },
    {
      id: "review",
      label: pendingDrafts ? `Review ${pendingDrafts.toLocaleString()} translation${pendingDrafts === 1 ? "" : "s"}` : "Review bulk translations",
      detail: "Bulk translations wait for your approval before customers see them.",
      done: published > 0 && pendingDrafts === 0,
      href: "/app/review",
      action: "Open Review",
    },
    {
      id: "publish-language",
      label: "Show a language to customers",
      detail: "Publish the language in Shopify when its translations are ready.",
      done: targets.some((l) => l.published),
      href: "shopify://admin/settings/languages",
      action: "Open language settings",
      external: true,
    },
  ];

  // Share of translated texts per language, from the latest finished coverage report.
  const finished = coverage?.report.status === "COMPLETED" ? coverage : null;
  const progress = targets.map((l) => {
    const rows = finished?.rows.filter((r) => r.locale === l.locale) ?? [];
    const withSource = rows.reduce((n, r) => n + r.groups.content.withSource + r.groups.seo.withSource, 0);
    const translated = rows.reduce((n, r) => n + r.groups.content.translated + r.groups.seo.translated, 0);
    return {
      locale: l.locale,
      name: l.name,
      published: l.published,
      percent: finished && withSource ? Math.round((translated / withSource) * 100) : null,
    };
  });

  const limits = aiLimitsFor(getConfig(), billing);
  return {
    shopName: shop.name ?? shop.shopDomain,
    installedAt: shop.installedAt.toISOString(),
    primary: locales.primary?.name ?? null,
    enabledCount: locales.enabledCount,
    maxLocales: MAX_ENABLED_LOCALES,
    publishedCount: locales.publishedCount,
    checklist,
    progress,
    coverageCheckedAt: finished?.report.finishedAt?.toISOString() ?? null,
    pendingDrafts,
    activeJobs,
    usage: { used, limit: limits.limit, usedToday, dailyLimit: limits.dailyLimit, level: usageLevel(used, limits.limit) },
  };
}
