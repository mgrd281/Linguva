/**
 * The Overview page: the one next step and what else needs the merchant,
 * how complete the store and each language is (from the newest completed
 * measurement only), the translations running now, the countries the store
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
import { addCounts, coveragePercent, emptyCounts, HEADLINE_EXCLUDED_TYPES, totalOf } from "../../lib/coverage-rules";
import { reviewPayoff } from "../../lib/language-categories";
import { CONTENT_TYPES, isContentType } from "../../lib/resource-kinds";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage, getOwnKeyUsage, nextPeriodStart } from "../usage/usage-ledger";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import type { BillingStatus } from "../billing/subscription";
import type { ConsentToken } from "../../lib/engines";
import { usableOwnKey, type OwnKeySummary } from "../../lib/own-keys";
import { usesOwnKeys } from "../../lib/plans";
import { MAX_ENABLED_LOCALES } from "../../lib/locale-limits";
import { usageLevel } from "../../lib/usage";
import { analyzeCountries, countByStatus, missingLanguages } from "../../lib/country-coverage";
import type { MarketCountriesResult } from "../markets/countries";
import type { MessageRef } from "../../i18n/i18n";
import { ACTIVE_JOB_STATUSES } from "../jobs/bulk-jobs";
import { jobProgress } from "../../lib/job-display";
import { reliableEta } from "../../lib/eta";
import { measurementState } from "./measurement";
import { attention, nextStep } from "./next-step";

/** Running translations the Overview shows (the Jobs page has them all). */
export const OVERVIEW_JOBS = 4;

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
  /** The store's billing state when the caller read it already (tests: instead of asking Shopify). */
  billing?: BillingStatus;
  /**
   * The services the AI consent is about and who they are used under (shop-translation.ts facts):
   * absent, the environment's engines, as before. Own key plan: the shop's usable keys.
   */
  consent?: { configured: ConsentToken[]; payer: "linguva" | "merchant" };
  /** Own key plan (or a pending change to it): its keys and, when pending, when it starts (ownKeysForOverview). */
  ownKeys?: { access: "plan" | "pending"; keys: OwnKeySummary[]; startsOn: string | null } | null;
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
    options.billing ?? shopBilling(admin, shop),
  ]);
  const active = { shopId: shop.id, status: { in: [...ACTIVE_JOB_STATUSES] } };
  const [pendingDrafts, published, [activeJobs, running], coverage, used, usedToday, markets] = await Promise.all([
    countPendingDrafts(shop.id, client),
    withTenant(shop.id, (tx) => tx.translationRevision.count({ where: { shopId: shop.id, origin: { in: ["AI", "MANUAL"] } } }), client),
    withTenant(
      shop.id,
      (tx) =>
        Promise.all([
          tx.translationJob.count({ where: active }),
          tx.translationJob.findMany({
            where: active,
            orderBy: { createdAt: "asc" },
            take: OVERVIEW_JOBS,
            select: {
              id: true,
              resourceType: true,
              targetLocale: true,
              totalItems: true,
              succeededItems: true,
              skippedItems: true,
              failedItems: true,
              discoveryDone: true,
              startedAt: true,
              publishMode: true,
            },
          }),
        ]),
      client,
    ),
    loadCoverageSummary(shop.id, client),
    getMonthlyUsage(shop.id, undefined, client),
    getDailyUsage(shop.id, client),
    options.markets ? options.markets() : Promise.resolve(null),
  ]);
  const targets = locales.locales.filter((l) => !l.primary);
  const consent = hasCurrentAiConsent(settings, options.consent?.configured, options.consent?.payer);
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
  const total = totalOf(sum);
  const storeShare = shared.length
    ? {
        complete: sum.complete,
        total,
        counts: sum,
        languages: shared.length,
        published: publishedLanguages,
        /** The share once every waiting draft is approved, when that gains a point. */
        payoff: reviewPayoff({ counts: sum, complete: sum.complete, total, percent: coveragePercent(sum.complete, total) }),
      }
    : null;

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
  const stepInput = {
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
    // Own key plan: a key comes before the permission (which covers the keys' services).
    ...(options.ownKeys?.access === "plan" && !options.ownKeys.keys.some(usableOwnKey) ? { ownKeyMissing: true } : {}),
  };
  const next = nextStep(stepInput);
  const now = new Date(options.now ?? Date.now());
  const jobs = running.map((job) => {
    const progress = jobProgress(job);
    return {
      id: job.id,
      resourceType: job.resourceType,
      locale: job.targetLocale,
      done: progress.done,
      total: progress.total,
      percent: progress.percent,
      discoveryDone: job.discoveryDone,
      remainingMs: job.discoveryDone ? reliableEta({ done: progress.done, total: progress.total, startedAt: job.startedAt, now }) : null,
      /** The results wait in Review (DRAFT) or go live directly. */
      publishMode: job.publishMode,
    };
  });

  const limits = aiLimitsFor(getConfig(), billing);
  // Own key plan: no Linguva allowance to use up (its characters go through the shop's own keys).
  const ownKey = usesOwnKeys(billing.entitlements) ? { total: (await getOwnKeyUsage(shop.id, undefined, client)).total } : null;
  // A trial's allowance ends with the trial: when that comes before the
  // month's renewal, AI translation resumes then, not on the 1st.
  const trialEndsAt = !ownKey && billing.trialEndsAt && billing.trialEndsAt < nextPeriodStart(now) ? billing.trialEndsAt.toISOString() : null;
  return {
    shopName: shop.name,
    // The store's additional languages (the operator's translation services card counts them per engine).
    targetLocales: targets.map((l) => l.locale),
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
    attention: attention(stepInput, next),
    countries,
    pendingDrafts,
    activeJobs,
    jobs,
    /** The Own key plan or a pending change to it (its keys' summaries: hints only), else null. */
    ownKeys: options.ownKeys ?? null,
    usage: {
      used,
      limit: limits.limit,
      usedToday,
      dailyLimit: limits.dailyLimit,
      level: ownKey ? ("ok" as const) : usageLevel(used, limits.limit),
      trialEndsAt,
      ...(ownKey ? { ownKey } : {}),
    },
  };
}
