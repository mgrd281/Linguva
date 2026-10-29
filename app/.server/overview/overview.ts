/**
 * The Overview page: the one next step, how complete each language is
 * (from the newest completed measurement only), the countries the store
 * sells to and their languages, and AI usage against the allowance.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { getConfig } from "../lib/config";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { countPendingDrafts } from "../review/drafts";
import { loadCoverageSummary } from "../coverage/summary";
import { COVERAGE_TYPES } from "../coverage/coverage";
import { headlineByLocale, measuredLocales as wholeLocales, unreadableTypes } from "../../lib/coverage-view";
import { addCounts, emptyCounts, HEADLINE_EXCLUDED_TYPES, totalOf } from "../../lib/coverage-rules";
import { CONTENT_TYPES, isContentType } from "../../lib/resource-kinds";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage } from "../usage/usage-ledger";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import { MAX_ENABLED_LOCALES } from "../../lib/locale-limits";
import { usageLevel } from "../../lib/usage";
import { analyzeCountries, countByStatus, missingLanguages } from "../../lib/country-coverage";
import type { MarketCountriesResult } from "../markets/countries";
import type { MessageRef } from "../../i18n/i18n";
import { measurementState } from "./measurement";
import { nextStep } from "./next-step";

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

export interface OverviewOptions {
  /** An AI provider is configured (no key: the AI steps are left out). */
  aiAvailable?: boolean;
  /** Background jobs can run here (Redis configured): measuring can be offered. */
  jobsAvailable?: boolean;
  /** The shop's markets and their countries (needs read_markets). */
  markets?: () => Promise<MarketCountriesResult>;
  /** Tests only: the time the measurement state is judged at. */
  now?: number;
}

export async function loadOverview(
  admin: Admin,
  shop: { id: string; name: string | null; shopDomain: string; installedAt: Date; shopifyShopGid: string | null },
  client: PrismaClient = defaultClient,
  options: OverviewOptions = {},
) {
  const aiAvailable = options.aiAvailable ?? true;
  const jobsAvailable = options.jobsAvailable ?? true;
  const [locales, settings, billing] = await Promise.all([
    fetchAndSyncShopLocales(admin, shop.id, client),
    getShopSettings(shop.id, client),
    shopBilling(admin, shop),
  ]);
  const [pendingDrafts, published, activeJobs, coverage, used, usedToday, markets] = await Promise.all([
    countPendingDrafts(shop.id, client),
    withTenant(shop.id, (tx) => tx.translationRevision.count({ where: { shopId: shop.id, origin: { in: ["AI", "MANUAL"] } } }), client),
    withTenant(shop.id, (tx) => tx.translationJob.count({ where: { shopId: shop.id, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } } }), client),
    loadCoverageSummary(shop.id, client),
    getMonthlyUsage(shop.id, undefined, client),
    getDailyUsage(shop.id, client),
    options.markets ? options.markets() : Promise.resolve(null),
  ]);
  const targets = locales.locales.filter((l) => !l.primary);
  const consent = hasCurrentAiConsent(settings);
  const firstTarget = targets[0]?.locale;

  // Percentages only from the newest completed measurement, for the languages it covered and
  // still has every type of: a first measurement under way has read only some types, and a
  // language published since (or whose rows went with it) has none, so their numbers would mislead.
  const measuredLocales = wholeLocales(coverage.lastCompleted, coverage.segments, COVERAGE_TYPES);
  const headline = headlineByLocale(coverage.counts);
  // A store with live translations (measured, made anywhere) is past its first translation.
  const liveTranslations = [...measuredLocales].some((locale) => (headline.get(locale)?.complete ?? 0) > 0);

  const allSteps: ChecklistStep[] = [
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
      detail: { key: aiAvailable ? "overview.checklist.firstTranslation.detail" : "overview.checklist.firstTranslation.detailManual" },
      done: published > 0 || liveTranslations,
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
  // Without an AI provider there is no consent to give and no bulk drafts to review.
  const checklist = aiAvailable ? allSteps : allSteps.filter((s) => s.id !== "consent" && s.id !== "review");

  // Content whose latest read didn't finish (skipped after errors, or left by a measurement that
  // stopped or got stuck): its figures may be older or incomplete. Only types the figures count.
  const measurement = measurementState(coverage.report, { jobsAvailable, now: options.now ?? Date.now() });
  const reading = measurement.state === "queued" || measurement.state === "waiting" || measurement.state === "running";
  const unread = new Set(
    coverage.segments
      .filter((s) => !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, s.resourceType))
      .filter((s) => s.status === "FAILED" || (s.status === "SCANNING" && !reading))
      .map((s) => s.locale),
  );
  const progress = targets.map((l) => {
    const measured = measuredLocales.has(l.locale);
    const tally = measured ? headline.get(l.locale) : undefined;
    return {
      locale: l.locale,
      name: l.name,
      published: l.published,
      measured,
      partial: measured && unread.has(l.locale),
      // Types the figures count that Linguva can't read (no access): never "fully translated" then.
      unchecked: measured ? unreadableTypes(coverage.segments, { locales: [l.locale], types: COVERAGE_TYPES }).length : 0,
      percent: tally?.percent ?? null,
      counts: tally?.counts ?? null,
      complete: tally?.complete ?? 0,
      total: tally?.total ?? 0,
    };
  });
  // Content types of the published languages Linguva has no access to, and where access is allowed
  // (a content type's page asks for its scope).
  const deniedTypes = unreadableTypes(coverage.segments, { locales: targets.filter((l) => l.published).map((l) => l.locale), types: COVERAGE_TYPES });
  const accessType = deniedTypes.find(isContentType);
  const unreadable = deniedTypes.length ? { types: deniedTypes.length, href: accessType ? `/app/content/${CONTENT_TYPES[accessType].slug}` : null } : null;
  // The store's share: every counted field of the measured published languages (as on the Coverage page).
  const shared = progress.filter((l) => l.published && l.measured && l.total > 0);
  const sum = emptyCounts();
  for (const l of shared) addCounts(sum, l.counts!);
  const publishedLanguages = progress.filter((l) => l.published).length;
  const storeShare = shared.length ? { complete: sum.complete, total: totalOf(sum), languages: shared.length, published: publishedLanguages } : null;

  // Countries the shop sells to, and whether they can read it in their language.
  const countries = !markets
    ? null
    : !markets.access
      ? { access: false as const }
      : "error" in markets
        ? { access: true as const, error: true as const }
        : (() => {
            const rows = analyzeCountries(
              markets.markets,
              { primary: locales.primary?.locale ?? null, published: targets.filter((l) => l.published).map((l) => l.locale), enabled: targets.map((l) => l.locale) },
              new Map(progress.map((l) => [l.locale, l.percent])),
            );
            return { access: true as const, rows, missing: missingLanguages(rows), counts: countByStatus(rows) };
          })();

  const firstTranslation = checklist.find((s) => s.id === "first-translation")!;
  const next = nextStep({
    targets: targets.map((l) => ({ locale: l.locale, name: l.name, published: l.published })),
    consent,
    firstTranslation: { done: firstTranslation.done, href: firstTranslation.href },
    pendingDrafts,
    aiAvailable,
    jobsAvailable,
    measuredLocales: [...measuredLocales],
    progress,
    unreadable,
    countries: countries && "rows" in countries ? countries : null,
    remainingLocales: locales.remainingEnabled,
  });

  const limits = aiLimitsFor(getConfig(), billing);
  return {
    primary: locales.primary?.name ?? null,
    primaryLocale: locales.primary?.locale ?? null,
    maxLocales: MAX_ENABLED_LOCALES,
    remainingLocales: locales.remainingEnabled,
    aiAvailable,
    checklist,
    progress,
    storeShare,
    unreadable,
    measuredAt: coverage.lastCompleted?.finishedAt ?? null,
    measurement,
    next,
    countries,
    pendingDrafts,
    activeJobs,
    usage: { used, limit: limits.limit, usedToday, dailyLimit: limits.dailyLimit, level: usageLevel(used, limits.limit) },
  };
}
