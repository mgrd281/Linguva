/**
 * Server side of the coverage dashboard and its drill-down: languages (with
 * the market filter), the live counts, scan state, running jobs with a
 * reliable remaining time, and the actions (scan, translate gaps).
 */
import { randomUUID } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { redirect } from "react-router";
import { requireShop } from "../shopify/require-shop";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { fetchMarkets, MARKETS_SCOPE, MarketsAccessError } from "../markets/markets";
import { getQueues } from "../queue/client";
import { getTranslationProvider } from "../providers";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { shopBilling } from "../billing/billing";
import { allowedTargetLocales } from "../billing/subscription";
import { BackgroundJobsUnavailableError, startBulkJob, startCoverageReport } from "../jobs/start-job";
import { isBulkResourceType, type BulkResourceType } from "../jobs/bulk-jobs";
import { withTenant } from "../tenancy/with-tenant";
import { jobProgress } from "../../lib/job-display";
import { reliableEta } from "../../lib/eta";
import {
  IMAGE_COVERAGE_TYPES,
  isContentType,
  isImageCoverageType,
  itemEditorPath,
  kindOfGid,
  numericId,
  RESOURCE_KINDS,
  resourceTitle,
  type TranslatableKind,
} from "../../lib/resource-kinds";
import { isFieldGroup, isFieldState, isMetafieldCoverageType, type FieldGroup } from "../../lib/coverage-rules";
import { measuredLocales } from "../../lib/coverage-view";
import { AccessDeniedError } from "../shopify/translations-api";
import { translatableByIds } from "../shopify/attached-resources";
import { isSearchableType, searchIds } from "../shopify/search-ids";
import { COVERAGE_TYPES, segmentOf, STALE_REPORT_MS } from "./coverage";
import { listCoverageItems, loadCoverageSummary, type ItemStateFilter } from "./summary";
import { loadSmartCoverageNote, smartBadge, smartContext, smartWorkOn } from "../smart/panel";

/** Types with a title of their own (images and custom fields are named by their text or owner). */
function kindOfAny(type: string): TranslatableKind | null {
  return isContentType(type) || Object.hasOwn(RESOURCE_KINDS, type) ? (type as TranslatableKind) : null;
}

const ACTIVE_JOBS = ["PENDING", "DISCOVERING", "RUNNING"] as const;

/** The bulk job that translates a coverage row: images and custom fields go with their owner. */
export function bulkTargetOf(coverageType: string): { resourceType: BulkResourceType; includeAttached: boolean } | null {
  if (isImageCoverageType(coverageType)) return { resourceType: IMAGE_COVERAGE_TYPES[coverageType].parent, includeAttached: true };
  if (isMetafieldCoverageType(coverageType)) {
    const owner = coverageType.slice(0, -"_METAFIELD".length);
    return isBulkResourceType(owner) ? { resourceType: owner, includeAttached: true } : null;
  }
  return isBulkResourceType(coverageType) ? { resourceType: coverageType, includeAttached: false } : null;
}

const SEO_GROUPS: readonly FieldGroup[] = ["seo_title", "seo_description"];

type MarketsResult = Awaited<ReturnType<typeof readMarkets>>;
/**
 * The page refreshes every few seconds while a scan or job runs; scopes and
 * markets rarely change, so they are read at most once a minute per shop
 * (per process). Granting a scope takes effect within that minute.
 */
export const MARKETS_CACHE_MS = 60_000;
const marketsCache = new Map<string, { at: number; value: MarketsResult }>();

async function loadMarkets(shopId: string, admin: Parameters<typeof fetchMarkets>[0], isGranted: () => Promise<boolean>, now = Date.now()) {
  const cached = marketsCache.get(shopId);
  if (cached && now - cached.at < MARKETS_CACHE_MS) return cached.value;
  const value = await readMarkets(admin, await isGranted());
  marketsCache.set(shopId, { at: now, value });
  if (marketsCache.size > 1000) marketsCache.delete(marketsCache.keys().next().value!);
  return value;
}

/** Languages offered by each active market (markets need the optional read_markets scope). */
async function readMarkets(admin: Parameters<typeof fetchMarkets>[0], granted: boolean) {
  if (!granted) return { available: false as const, markets: [] };
  try {
    const markets = await fetchMarkets(admin);
    return {
      available: true as const,
      markets: markets
        .filter((m) => m.status === "ACTIVE")
        .map((m) => ({
          id: m.handle,
          name: m.name,
          locales: [...new Set(m.webPresences.flatMap((wp) => [wp.defaultLocale.locale, ...wp.alternateLocales.map((l) => l.locale)]))],
        })),
    };
  } catch (error) {
    if (error instanceof MarketsAccessError) return { available: false as const, markets: [] };
    throw error;
  }
}

export async function loadCoverageDashboard(request: Request) {
  const { admin, shop, scopes } = await requireShop(request);
  const url = new URL(request.url);
  const [locales, summary, settings, markets] = await Promise.all([
    fetchAndSyncShopLocales(admin, shop.id),
    loadCoverageSummary(shop.id),
    getShopSettings(shop.id),
    loadMarkets(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
  ]);
  const allTargets = locales.locales.filter((l) => !l.primary);
  const market = markets.markets.find((m) => m.id === url.searchParams.get("market")) ?? null;
  const targets = market ? allTargets.filter((l) => market.locales.includes(l.locale)) : allTargets;
  const requested = url.searchParams.get("lang");
  const selected = targets.find((l) => l.locale === requested) ?? targets.find((l) => l.published) ?? targets[0] ?? null;

  const names = new Map(locales.locales.map((l) => [l.locale, l.name]));
  const report = summary.report;
  const active = report?.status === "QUEUED" || report?.status === "RUNNING";
  // No progress for this long: it can be started again (createCoverageReport then replaces it).
  const stalled = Boolean(report && active && Date.now() - Date.parse(report.updatedAt) >= STALE_REPORT_MS);
  const current = report && active ? segmentOf(report, report.segmentIndex) : null;

  const smartState = await smartContext(await shopBilling(admin, shop), settings, allTargets.map((l) => l.locale));
  const [jobs, smart] = await Promise.all([
    withTenant(shop.id, (tx) =>
      tx.translationJob.findMany({ where: { shopId: shop.id, status: { in: [...ACTIVE_JOBS] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    ),
    loadSmartCoverageNote(shop.id, smartState),
  ]);
  const now = new Date();
  return {
    /** The smart schedule beside the figures (null while off), with the same state as Settings. */
    smart: smart
      ? {
          status: smart.status,
          mode: smart.mode,
          zone: smart.zone,
          nextCheck: smart.nextCheck,
          translating: smart.translating,
          excluded: smart.excluded,
          // Whether the language shown is one the schedule translates into.
          inSchedule: selected ? smart.scope.locales.includes(selected.locale) : true,
        }
      : null,
    shopName: shop.name ?? shop.shopDomain,
    primary: locales.primary ? { locale: locales.primary.locale, name: locales.primary.name } : null,
    // Published languages first (what customers see), then by name.
    targets: [...targets]
      .sort((a, b) => Number(b.published) - Number(a.published) || a.name.localeCompare(b.name))
      .map((l) => ({ locale: l.locale, name: l.name, published: l.published })),
    names: Object.fromEntries(locales.locales.map((l) => [l.locale, l.name])),
    selected: selected?.locale ?? null,
    markets: { available: markets.available, list: markets.markets.map((m) => ({ id: m.id, name: m.name })), selected: market?.id ?? null },
    idempotencyKey: randomUUID(),
    jobsAvailable: getQueues() !== null,
    canTranslate: getTranslationProvider() !== null && hasCurrentAiConsent(settings),
    coverageTypes: COVERAGE_TYPES,
    /** The newest completed measurement (a failed or stuck newer one has no full scan to show). */
    lastFullScan: summary.lastCompleted?.finishedAt ?? null,
    /** Languages whose figures are whole (as on the Overview): only these make up percentages. */
    measured: [...measuredLocales(summary.lastCompleted, summary.segments, COVERAGE_TYPES)],
    report: report
      ? {
          status: report.status,
          errorCode: report.errorCode,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          finishedAt: report.finishedAt,
          stalled,
          resourcesScanned: report.resourcesScanned,
          progress: { done: Math.min(report.segmentIndex, report.segments.length), total: report.segments.length },
          scanning: current ? { type: current.resourceType, language: names.get(current.locale) ?? current.locale } : null,
          // Segments are "TYPE|locale".
          locales: [...new Set(report.segments.map((s) => s.slice(s.indexOf("|") + 1)))],
        }
      : null,
    segments: summary.segments,
    counts: summary.counts,
    seo: summary.seo,
    jobs: jobs.map((j) => {
      const progress = jobProgress(j);
      return {
        id: j.id,
        resourceType: j.resourceType,
        locale: j.targetLocale,
        status: j.status,
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
        discoveryDone: j.discoveryDone,
        remainingMs: j.discoveryDone ? reliableEta({ done: progress.done, total: progress.total, startedAt: j.startedAt, now }) : null,
      };
    }),
  };
}

export type CoverageActionResult = { ok: true } | { error: string };

const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{8,80}$/;

/**
 * Starts measuring every additional language of the store (intent "run" of
 * the Coverage page, the Overview and a language page). A repeated key
 * starts nothing twice.
 */
export async function startMeasurement(
  admin: Pick<AdminApiContext, "graphql">,
  shop: { id: string },
  input: { idempotencyKey: string; requestedBy: string | null },
): Promise<CoverageActionResult> {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) return { error: "INVALID_REQUEST" };
  const locales = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary);
  if (!locales.length) return { error: "NO_LANGUAGES" };
  try {
    await startCoverageReport({ shopId: shop.id, locales: locales.map((l) => l.locale), requestedBy: input.requestedBy, idempotencyKey: input.idempotencyKey });
    return { ok: true };
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
}

/** Scan, or translate the gaps of one language and type (all fields or SEO only). */
export async function coverageAction(request: Request): Promise<CoverageActionResult | Response> {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return { error: "INVALID_REQUEST" };
  if (form.get("intent") === "run") return startMeasurement(admin, shop, { idempotencyKey, requestedBy: actorId });
  const locales = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary);
  try {
    const intent = form.get("intent");
    if (intent === "translate") {
      const locale = String(form.get("locale") ?? "");
      const target = bulkTargetOf(String(form.get("resourceType") ?? ""));
      const group = String(form.get("fieldGroup") ?? "");
      if (!locales.some((l) => l.locale === locale) || !target) return { error: "INVALID_REQUEST" };
      const billing = await shopBilling(admin, shop);
      if (!billing.entitlements.bulk) return { error: "PLAN_BULK" };
      if (!allowedTargetLocales(billing.entitlements, locales.map((l) => l.locale)).includes(locale)) return { error: "PLAN_LANGUAGE" };
      const seoOnly = isFieldGroup(group) && SEO_GROUPS.includes(group) && !target.includeAttached;
      // Bulk jobs translate only missing and outdated fields; failed items are tried again,
      // drafts waiting for review and protected translations are left alone.
      const { job } = await startBulkJob({
        shopId: shop.id,
        resourceType: target.resourceType,
        targetLocale: locale,
        requestedBy: actorId,
        idempotencyKey,
        fieldScope: seoOnly ? "SEO" : "ALL",
        includeAttached: target.includeAttached,
      });
      return redirect(`/app/jobs/${job.id}`);
    }
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
  return { error: "UNKNOWN_INTENT" };
}

/**
 * The items behind a number: one language, optionally one type, field group
 * and state, and a title search (types Shopify can search). Titles are read
 * live from Shopify for the visible page only (coverage stores no text).
 */
export async function loadCoverageItemsPage(request: Request) {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const param = (name: string) => {
    const value = url.searchParams.get(name);
    return value && value !== "all" ? value : null;
  };
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const targets = locales.locales.filter((l) => !l.primary);
  const locale = targets.find((l) => l.locale === param("lang"))?.locale ?? targets[0]?.locale ?? null;
  const type = COVERAGE_TYPES.includes(param("type") ?? "") ? param("type") : null;
  const groupParam = param("group");
  const fieldGroup = groupParam && isFieldGroup(groupParam) ? groupParam : null;
  const stateParam = param("state");
  const state: ItemStateFilter = stateParam && isFieldState(stateParam) ? stateParam : "incomplete";
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const after = param("after");
  const filter = { locale, type, fieldGroup, state, search };
  const base = {
    targets: targets.map((l) => ({ locale: l.locale, name: l.name, published: l.published })),
    filter,
    coverageTypes: COVERAGE_TYPES,
    searchable: isSearchableType(type),
    idempotencyKey: randomUUID(),
    jobsAvailable: getQueues() !== null,
    canTranslate: false,
    bulk: type ? bulkTargetOf(type) !== null : false,
    isFirstPage: !after,
  };
  if (!locale) return { ...base, items: [], nextCursor: null, searchUnavailable: false, smartNextCheck: null, smartZone: null };

  let resourceGids: string[] | null = null;
  const searchUnavailable = Boolean(search) && !isSearchableType(type);
  if (search && isSearchableType(type)) {
    try {
      resourceGids = await searchIds(admin, type, search);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
      resourceGids = [];
    }
  }
  const page = await listCoverageItems(shop.id, { locale, resourceType: type, fieldGroup, state, resourceGids, after, limit: 50 });
  // Titles: the items themselves, and the owners of custom fields.
  const ids = [...new Set(page.items.flatMap((i) => (i.parentGid ? [i.resourceGid, i.parentGid] : [i.resourceGid])))];
  let content: Awaited<ReturnType<typeof translatableByIds>> = new Map();
  try {
    content = await translatableByIds(admin, ids, locale);
  } catch {
    // Titles are a convenience: the list still works with ids.
  }
  const settings = await getShopSettings(shop.id);
  // What the smart schedule does with the listed items: translating now, left alone, or waiting for its next check (only while on).
  const smart = await loadSmartCoverageNote(shop.id, await smartContext(await shopBilling(admin, shop), settings, targets.map((l) => l.locale)));
  const work = smart ? await smartWorkOn(shop.id, locale, page.items) : null;
  const titleOf = (gid: string, kind: string) => {
    const c = content.get(gid);
    const k = kindOfAny(kind);
    return c && k ? resourceTitle(k, c.content) : null;
  };
  return {
    ...base,
    canTranslate: getTranslationProvider() !== null && hasCurrentAiConsent(settings),
    searchUnavailable,
    nextCursor: page.nextCursor,
    items: page.items.map((i) => {
      const ownerType = i.parentGid ? kindOfGid(i.parentGid) : null;
      return {
        id: i.id,
        resourceType: i.resourceType,
        title: i.parentGid && ownerType ? titleOf(i.parentGid, ownerType) : titleOf(i.resourceGid, i.resourceType),
        reference: numericId(i.resourceGid),
        // Images and custom fields are edited on their owner's page.
        href: itemEditorPath(i, locale),
        counts: i.counts,
        fields: i.fields,
        lastAttemptFailed: i.lastAttemptFailed,
        failureCode: i.failureCode,
        syncedAt: i.syncedAt,
        smart: work ? smartBadge(work, smart!, { ...i, locale }) : null,
      };
    }),
    smartNextCheck: smart?.nextCheck ?? null,
    smartZone: smart?.zone ?? null,
  };
}
