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
import { loadCoverageSummary } from "../coverage/summary";
import { headlineByLocale } from "../../lib/coverage-view";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage } from "../usage/usage-ledger";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import { MAX_ENABLED_LOCALES } from "../../lib/locale-limits";
import { usageLevel } from "../../lib/usage";
import type { MessageRef } from "../../i18n/i18n";

type Admin = Pick<AdminApiContext, "graphql">;

export interface ChecklistStep {
  id: "language" | "consent" | "first-translation" | "review" | "publish-language";
  label: MessageRef;
  detail: MessageRef;
  done: boolean;
  href: string;
  action: MessageRef;
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
    loadCoverageSummary(shop.id, client),
    getMonthlyUsage(shop.id, undefined, client),
    getDailyUsage(shop.id, client),
  ]);
  const targets = locales.locales.filter((l) => !l.primary);
  const consent = hasCurrentAiConsent(settings);
  const firstTarget = targets[0]?.locale;

  const checklist: ChecklistStep[] = [
    {
      id: "language",
      label: { key: "overview.checklist.language.label" },
      detail: { key: "overview.checklist.language.detail" },
      done: targets.length > 0,
      href: "shopify://admin/settings/languages",
      action: { key: "overview.checklist.languageSettings" },
      external: true,
    },
    {
      id: "consent",
      label: { key: "overview.checklist.consent.label" },
      detail: { key: "overview.checklist.consent.detail" },
      done: consent,
      href: "/app/settings",
      action: { key: "overview.checklist.consent.action" },
    },
    {
      id: "first-translation",
      label: { key: "overview.checklist.firstTranslation.label" },
      detail: { key: "overview.checklist.firstTranslation.detail" },
      done: published > 0,
      href: firstTarget ? `/app/products?lang=${encodeURIComponent(firstTarget)}` : "/app/products",
      action: { key: "overview.checklist.firstTranslation.action" },
    },
    {
      id: "review",
      label: pendingDrafts
        ? { key: "overview.checklist.review.labelCount", vars: { count: pendingDrafts } }
        : { key: "overview.checklist.review.label" },
      detail: { key: "overview.checklist.review.detail" },
      done: published > 0 && pendingDrafts === 0,
      href: "/app/review",
      action: { key: "overview.checklist.review.action" },
    },
    {
      id: "publish-language",
      label: { key: "overview.checklist.publishLanguage.label" },
      detail: { key: "overview.checklist.publishLanguage.detail" },
      done: targets.some((l) => l.published),
      href: "shopify://admin/settings/languages",
      action: { key: "overview.checklist.languageSettings" },
      external: true,
    },
  ];

  // Share of complete fields per language (live coverage, published drafts only).
  const scanned = coverage.segments.some((seg) => seg.status === "SCANNED");
  const headline = headlineByLocale(coverage.counts);
  const progress = targets.map((l) => ({
    locale: l.locale,
    name: l.name,
    published: l.published,
    percent: scanned ? (headline.get(l.locale)?.percent ?? null) : null,
  }));

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
    coverageCheckedAt: coverage.report?.status === "COMPLETED" ? coverage.report.finishedAt : null,
    pendingDrafts,
    activeJobs,
    usage: { used, limit: limits.limit, usedToday, dailyLimit: limits.dailyLimit, level: usageLevel(used, limits.limit) },
  };
}
