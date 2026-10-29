/**
 * Server side of a language's page, its previews and its category lists
 * (app/routes/app.languages_.$locale.tsx, …$locale_.previews.tsx and
 * …$locale_.$category.tsx): the language in the areas a merchant recognises
 * (app/lib/language-categories.ts), from the coverage reads the Coverage
 * page and the Overview use, so every figure adds up to the language's
 * percentage.
 *
 * - The page reads the kept counts and scan states, plus one indexed count
 *   of the items each "Translate" would start (its confirm dialog), and the
 *   shop's languages from Shopify.
 * - Previews and lists choose their items in the database, open work first,
 *   and read names, translations and pictures live from Shopify for what is
 *   shown only (coverage stores no merchant text). Previews are kept in
 *   memory for a minute per shop and language.
 * - Translating a category starts one bulk job per type bulk jobs translate,
 *   behind the Coverage page's plan, consent, provider and queue gates.
 */
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { redirect } from "react-router";
import { prisma as defaultClient } from "../lib/db";
import { getConfig } from "../lib/config";
import { logger } from "../lib/logger";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { currentShopLocales } from "../locales/current-locales";
import { fetchAndSyncShopLocales, type LocaleSummary } from "../locales/shop-locales";
import { loadCoverageState, loadCoverageSummary } from "../coverage/summary";
import { loadCounts } from "../coverage/items";
import { COVERAGE_TYPES } from "../coverage/coverage";
import { measurementState, type Measurement, type MeasurementState } from "../overview/measurement";
import type { MarketCountriesResult } from "../markets/countries";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import { allowedTargetLocales } from "../billing/subscription";
import { getMonthlyUsage } from "../usage/usage-ledger";
import { getQueues } from "../queue/client";
import { getTranslationProvider } from "../providers";
import { BackgroundJobsUnavailableError, startBulkJob } from "../jobs/start-job";
import { ACTIVE_JOB_STATUSES, isBulkResourceType, type BulkResourceType } from "../jobs/bulk-jobs";
import { translatableByIds } from "../shopify/attached-resources";
import { PREVIEW_NODE_TYPES, readPreviewNodes, type PreviewNode } from "../shopify/preview-nodes";
import { isSearchableType, searchIds, type SearchableType } from "../shopify/search-ids";
import { AccessDeniedError, type TranslatableResourceData } from "../shopify/translations-api";
import { loadSmartCoverageNote, smartBadge, smartContext, smartWorkOn, type SmartBadge, type SmartCoverageNote } from "../smart/panel";
import {
  countsInHeadline,
  emptyCounts,
  FIELD_GROUPS,
  FIELD_STATES,
  fieldGroupOf,
  HEADLINE_EXCLUDED_GROUPS,
  isFieldState,
  isMetafieldCoverageType,
  type StateCounts,
} from "../../lib/coverage-rules";
import { headlineByLocale, measuredLocales, tally, type CountInput, type Tally } from "../../lib/coverage-view";
import {
  bulkTypesOf,
  CATEGORIES,
  CATEGORY_IDS,
  categoryOf,
  categoryPath,
  categoryState,
  categoryTallies,
  EXTRA_IDS,
  isCategoryId,
  ITEM_STATE_OF,
  ITEM_STATES,
  nextSteps,
  reviewPayoff,
  stepCounts,
  textStates,
  tierOf,
  type CategoryId,
  type ItemState,
} from "../../lib/language-categories";
import { analyzeCountries } from "../../lib/country-coverage";
import { jobProgress } from "../../lib/job-display";
import type { Entitlements } from "../../lib/plans";
import { itemEditorPath, numericId, RESOURCE_KINDS } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;
type ShopRef = { id: string; shopifyShopGid: string | null };

/** Previews are read from Shopify at most once a minute per shop and language (per process). */
export const PREVIEWS_CACHE_MS = 60_000;
/** Image widths asked of Shopify's CDN: twice the shown size (96 px tiles, 64 px list thumbnails), for sharp screens. */
export const PREVIEW_IMAGE_WIDTH = 192;
export const ROW_IMAGE_WIDTH = 128;
/** Rows of a category list per page. */
export const CATEGORY_PAGE_SIZE = 50;

/** Measurements reading the store now (a stalled one can be started again). */
const UNDER_WAY: ReadonlySet<MeasurementState> = new Set(["queued", "waiting", "running"]);

/** Field states that are work to do: translating starts on these texts. */
const OPEN_STATES = ["missing", "outdated", "failed"] as const;
type OpenState = (typeof OPEN_STATES)[number];

/** CoverageItem.fieldStates entries ("group:state") of each item state, URL handles left out as the percentage leaves them out. */
const ENTRIES_OF = Object.fromEntries(
  ITEM_STATES.map((state) => [
    state,
    FIELD_GROUPS.filter((group) => !HEADLINE_EXCLUDED_GROUPS.includes(group)).flatMap((group) =>
      FIELD_STATES.filter((field) => ITEM_STATE_OF[field] === state).map((field) => `${group}:${field}`),
    ),
  ]),
) as Record<ItemState, string[]>;

const OPEN_ENTRIES = OPEN_STATES.flatMap((state) => ENTRIES_OF[state]);

/**
 * An item's one state as its place in ITEM_STATES (itemState, in SQL): the
 * first state any of its texts has, NULL when nothing but its URL handle is
 * counted. Array overlaps on the row itself, so lists order and filter by
 * it within the (shopId, locale, resourceType) range of the index.
 */
const RANK = Prisma.sql`CASE ${Prisma.join(
  ITEM_STATES.map((state, rank) => Prisma.sql`WHEN "fieldStates" && ${ENTRIES_OF[state]}::text[] THEN ${rank}::int`),
  " ",
)} END`;

interface ItemRow {
  id: string;
  resourceType: string;
  resourceGid: string;
  parentGid: string | null;
  sourceKeys: string[];
  fieldStates: string[];
  rank: number;
}

const stateOfRank = (rank: number): ItemState => ITEM_STATES[rank]!;

/** The state of one of an item's texts (fieldStates follow sourceKeys), as items show states. */
function stateOfKey(row: Pick<ItemRow, "sourceKeys" | "fieldStates">, key: string | null): ItemState | null {
  const entry = key === null ? undefined : row.fieldStates[row.sourceKeys.indexOf(key)];
  const state = entry?.slice(entry.indexOf(":") + 1);
  return state && isFieldState(state) ? ITEM_STATE_OF[state] : null;
}

/** Segments are "TYPE|locale": whether a measurement reads the language. */
const readsLocale = (segments: readonly string[], locale: string) => segments.some((s) => s.slice(s.indexOf("|") + 1) === locale);

/** A measurement under way reads the language now. */
function scanningOf(report: { segments: readonly string[] } | null, measurement: Measurement, locale: string) {
  return UNDER_WAY.has(measurement.state) && Boolean(report && readsLocale(report.segments, locale));
}

/**
 * The language of a route's :locale: one of the shop's additional languages
 * (404 otherwise). The primary language has no page of its own: its texts
 * are the originals, so it goes back to the Overview.
 */
async function targetLanguage(admin: Admin, shopId: string, locale: string, client: PrismaClient) {
  const locales = await fetchAndSyncShopLocales(admin, shopId, client);
  const language = locales.locales.find((l) => l.locale === locale);
  if (!language) throw new Response("Unknown language", { status: 404 });
  if (language.primary) throw redirect("/app");
  return { language, locales, targets: locales.locales.filter((l) => !l.primary).map((l) => l.locale) };
}

function languageOf(language: LocaleSummary["locales"][number]) {
  return { locale: language.locale, name: language.name, published: language.published, rtl: language.rtl };
}

function primaryOf(locales: LocaleSummary) {
  return locales.primary ? { locale: locales.primary.locale, name: locales.primary.name } : null;
}

/** Translation jobs into the language that are queued or running. */
function activeJobs(shopId: string, locale: string, client: PrismaClient) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.findMany({
        where: { shopId, targetLocale: locale, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, resourceType: true, totalItems: true, succeededItems: true, skippedItems: true, failedItems: true, discoveryDone: true },
      }),
    client,
  );
}

type ActiveJob = Awaited<ReturnType<typeof activeJobs>>[number];

/** A category's running translation, in items: its job's page, or the Jobs page when several of its types run. */
export interface CategoryJob {
  href: string;
  done: number;
  total: number;
  /** Every job has found all its items (until then, the total still grows). */
  discoveryDone: boolean;
}

function categoryJob(jobs: readonly ActiveJob[], category: CategoryId): CategoryJob | null {
  const own = jobs.filter((job) => categoryOf(job.resourceType) === category);
  if (!own.length) return null;
  const progress = own.map((job) => jobProgress(job));
  return {
    href: own.length === 1 ? `/app/jobs/${own[0]!.id}` : "/app/jobs",
    done: progress.reduce((n, p) => n + p.done, 0),
    total: progress.reduce((n, p) => n + p.total, 0),
    discoveryDone: own.every((job) => job.discoveryDone),
  };
}

/**
 * The category's texts waiting for approval, and Review showing them: with
 * Review's type filter where it has one (products, collections, pages, blog
 * posts and blogs, with their images and custom fields), else the language.
 */
function categoryReview(rows: readonly CountInput[], locale: string, category: CategoryId, figure: Tally) {
  const count = stepCounts(figure.counts).waiting;
  if (!count) return null;
  const waiting = (CATEGORIES[category].types as readonly string[]).filter((type) =>
    rows.some((r) => r.locale === locale && r.resourceType === type && countsInHeadline(r.resourceType, r.fieldGroup) && (r.state === "draft" || r.state === "review") && r.count > 0),
  );
  const params = new URLSearchParams({ lang: locale });
  if (waiting.length === 1 && Object.hasOwn(RESOURCE_KINDS, waiting[0]!)) params.set("type", waiting[0]!);
  return { count, href: `/app/review?${params}` };
}

/** Whether the smart schedule translates the category into the language (it is on, and its scope has them). */
function inSmartScope(note: SmartCoverageNote | null, locale: string, category: CategoryId) {
  return Boolean(
    note && note.status.state === "on" && note.scope.locales.includes(locale) && CATEGORIES[category].types.some((type) => note.scope.types.includes(type)),
  );
}

/**
 * Why translating in bulk can't start now: the app's setup first (nothing
 * the merchant can change), then the plan, the plan's languages and the AI
 * consent, the gates of the Coverage page and its action. Null: it can.
 */
export type BulkGate = "JOBS_UNAVAILABLE" | "AI_NOT_CONFIGURED" | "PLAN_BULK" | "PLAN_LANGUAGE" | "CONSENT_REQUIRED";

function bulkGate(input: { jobsAvailable: boolean; aiAvailable: boolean; entitlements: Entitlements; targets: readonly string[]; locale: string; consent: boolean }): BulkGate | null {
  if (!input.jobsAvailable) return "JOBS_UNAVAILABLE";
  if (!input.aiAvailable) return "AI_NOT_CONFIGURED";
  if (!input.entitlements.bulk) return "PLAN_BULK";
  if (!allowedTargetLocales(input.entitlements, input.targets).includes(input.locale)) return "PLAN_LANGUAGE";
  if (!input.consent) return "CONSENT_REQUIRED";
  return null;
}

/** Texts to translate of the given types in a language, by state: counted texts only (URL handles are never machine translated). */
function openTexts(rows: readonly CountInput[], locale: string, types: readonly string[]): Record<OpenState, number> {
  const texts = { missing: 0, outdated: 0, failed: 0 };
  for (const r of rows) {
    if (r.locale !== locale || !types.includes(r.resourceType) || !countsInHeadline(r.resourceType, r.fieldGroup)) continue;
    if ((OPEN_STATES as readonly string[]).includes(r.state)) texts[r.state as OpenState] += r.count;
  }
  return texts;
}

/**
 * What "Translate" starts jobs for: the category's types bulk jobs translate
 * (never policies, image descriptions or custom fields: bulkTypesOf) that
 * have texts to translate in the language.
 */
function typesToTranslate(rows: readonly CountInput[], locale: string, category: CategoryId): BulkResourceType[] {
  return bulkTypesOf(category)
    .filter(isBulkResourceType)
    .filter((type) => {
      const texts = openTexts(rows, locale, [type]);
      return texts.missing + texts.outdated + texts.failed > 0;
    });
}

/** What translating a category would do, for its confirm dialog. */
export interface BulkEstimate {
  /** The types it starts a job for. */
  types: BulkResourceType[];
  /** Texts to translate by state; outdated ones a person wrote or approved stay as they are, so these are at most. */
  texts: Record<OpenState, number>;
  /** Things of the category's kind with texts to translate ("29 products"); null for a category of several kinds. */
  items: number | null;
  /** Characters of those originals, what the AI is sent at most; null when some were read before their lengths were kept. */
  chars: number | null;
}

/** Items with texts to translate, and those of them read before the lengths of their originals were kept. */
type OpenItems = { items: number; unsized: number };

/** Per type: its open items (OpenItems). */
async function openItemCounts(tx: TenantTx, shopId: string, locale: string, types: readonly string[]): Promise<Map<string, OpenItems>> {
  if (!types.length) return new Map();
  const rows = await tx.$queryRaw<Array<{ resourceType: string; items: number; unsized: number }>>`
    SELECT "resourceType", count(*)::integer AS "items",
      count(*) FILTER (WHERE cardinality("sourceChars") < cardinality("sourceKeys"))::integer AS "unsized"
    FROM "CoverageItem"
    WHERE "shopId" = ${shopId}::uuid AND "locale" = ${locale} AND "resourceType" = ANY(${types}::text[])
      AND "fieldStates" && ${OPEN_ENTRIES}::text[]
    GROUP BY "resourceType"`;
  return new Map(rows.map((r) => [r.resourceType, { items: r.items, unsized: r.unsized }]));
}

/** Characters of the originals of texts to translate, per type (kept with the counts). */
async function openChars(tx: TenantTx, shopId: string, locale: string, types: readonly string[]) {
  if (!types.length) return new Map<string, number>();
  const rows = await tx.coverageCount.groupBy({
    by: ["resourceType"],
    where: { shopId, locale, resourceType: { in: [...types] }, fieldGroup: { notIn: [...HEADLINE_EXCLUDED_GROUPS] }, state: { in: [...OPEN_STATES] } },
    _sum: { chars: true },
  });
  return new Map(rows.map((r) => [r.resourceType, Number(r._sum.chars ?? 0)]));
}

/** What translating each category would do; `counted`: its types' open items when the caller has counted them already. */
async function bulkEstimates(
  tx: TenantTx,
  shopId: string,
  locale: string,
  rows: readonly CountInput[],
  categories: readonly CategoryId[],
  counted?: ReadonlyMap<string, OpenItems>,
) {
  const types = new Map(categories.map((id) => [id, typesToTranslate(rows, locale, id)]));
  const all = [...types.values()].flat();
  const [items, chars] = await Promise.all([counted ?? openItemCounts(tx, shopId, locale, all), openChars(tx, shopId, locale, all)]);
  return new Map(
    categories.map((id): [CategoryId, BulkEstimate | null] => {
      const own = types.get(id)!;
      if (!own.length) return [id, null];
      const itemTypes = CATEGORIES[id].itemTypes as readonly string[];
      const counted = own.filter((type) => itemTypes.includes(type)).reduce((n, type) => n + (items.get(type)?.items ?? 0), 0);
      return [
        id,
        {
          types: own,
          texts: openTexts(rows, locale, own),
          items: counted > 0 ? counted : null,
          chars: own.some((type) => (items.get(type)?.unsized ?? 0) > 0) ? null : own.reduce((n, type) => n + (chars.get(type) ?? 0), 0),
        },
      ];
    }),
  );
}

/** How the results of a bulk job go out: they wait on Review, or go live at once (the merchant's setting, on a plan that allows it). */
function publishModeOf(settings: { bulkPublishMode: string }, entitlements: Entitlements) {
  return settings.bulkPublishMode === "AUTO_PUBLISH" && entitlements.autoPublish ? ("AUTO_PUBLISH" as const) : ("DRAFT" as const);
}

/** AI characters left this month under the plan's allowance. */
function aiRemaining(billing: Parameters<typeof aiLimitsFor>[1], used: number) {
  return Math.max(0, aiLimitsFor(getConfig(), billing).limit - used);
}

export interface LanguagePageOptions {
  /** Background jobs can run here (Redis configured): counting and translating in bulk can be offered. */
  jobsAvailable?: boolean;
  /** An AI provider is configured. */
  aiAvailable?: boolean;
  /** The shop's markets and their countries (needs read_markets): where customers read the language. */
  markets?: () => Promise<MarketCountriesResult>;
  /** Tests only: the time the measurement state is judged at. */
  now?: number;
}

/**
 * Countries whose customers read the language in this store (the store
 * sells there and offers it there), and every country of the active markets
 * (localeCountry picks a flag among them). Empty without markets.
 */
function marketsFor(markets: MarketCountriesResult | null, locales: LocaleSummary, locale: string): { countries: Array<{ code: string; name: string }>; marketCountries: string[] } {
  if (!markets || !markets.access || "error" in markets) return { countries: [], marketCountries: [] };
  const targets = locales.locales.filter((l) => !l.primary);
  const rows = analyzeCountries(
    markets.markets,
    { primary: locales.primary?.locale ?? null, published: targets.filter((l) => l.published).map((l) => l.locale), enabled: targets.map((l) => l.locale) },
    new Map(),
  );
  return {
    countries: rows
      .filter((row) => row.languages.some((l) => l.available && l.locale === locale))
      .map((row) => ({ code: row.code, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    marketCountries: [...new Set(markets.markets.filter((m) => m.status === "ACTIVE").flatMap((m) => m.countries.map((c) => c.code.toUpperCase())))],
  };
}

/**
 * A language's page: how far it is (the Overview's figure), what to do next,
 * and each category with its figure, scan state, item count, running job,
 * texts waiting for approval and what translating it would do. Figures only
 * for a fully measured language (COVERAGE_RULES §3); 404 for a language the
 * shop doesn't have, the Overview for its primary language.
 */
export async function loadLanguagePage(admin: Admin, shop: ShopRef, locale: string, client: PrismaClient = defaultClient, options: LanguagePageOptions = {}) {
  const jobsAvailable = options.jobsAvailable ?? getQueues() !== null;
  const aiAvailable = options.aiAvailable ?? getTranslationProvider() !== null;
  const { language, locales, targets } = await targetLanguage(admin, shop.id, locale, client);
  const [summary, settings, billing, jobs, used, markets] = await Promise.all([
    loadCoverageSummary(shop.id, client),
    getShopSettings(shop.id, client),
    shopBilling(admin, shop),
    activeJobs(shop.id, locale, client),
    getMonthlyUsage(shop.id, undefined, client),
    options.markets ? options.markets() : Promise.resolve(null),
  ]);
  const measured = measuredLocales(summary.lastCompleted, summary.segments, COVERAGE_TYPES).has(locale);
  const [estimates, note] = await Promise.all([
    measured ? withTenant(shop.id, (tx) => bulkEstimates(tx, shop.id, locale, summary.counts, CATEGORY_IDS), client) : new Map<CategoryId, BulkEstimate | null>(),
    smartContext(billing, settings, targets).then((context) => loadSmartCoverageNote(shop.id, context, client)),
  ]);

  const measurement = measurementState(summary.report, { jobsAvailable, now: options.now ?? Date.now() });
  const scanning = scanningOf(summary.report, measurement, locale);
  const canCount = jobsAvailable && !UNDER_WAY.has(measurement.state);
  const gate = bulkGate({ jobsAvailable, aiAvailable, entitlements: billing.entitlements, targets, locale, consent: hasCurrentAiConsent(settings) });
  const tallies = categoryTallies(summary.counts, locale);
  const headline = headlineByLocale(summary.counts).get(locale) ?? tally(emptyCounts());
  const itemCount = (id: CategoryId) => {
    const types = CATEGORIES[id].itemTypes as readonly string[];
    return types.length ? summary.items.filter((i) => i.locale === locale && types.includes(i.resourceType)).reduce((n, i) => n + i.count, 0) : null;
  };
  const categories = CATEGORY_IDS.map((id) => ({
    id,
    tier: tierOf(id),
    href: categoryPath(locale, id),
    tally: tallies[id],
    state: categoryState(summary.segments, locale, id, { scanning }),
    /** Things its texts belong to (48 products); null for a category of several kinds (its description says what). */
    items: itemCount(id),
    review: categoryReview(summary.counts, locale, id, tallies[id]),
    job: categoryJob(jobs, id),
    /** What "Translate" would do; null when bulk jobs have nothing to translate here (its list can still be viewed). */
    bulk: estimates.get(id) ?? null,
    automatic: inSmartScope(note, locale, id),
  }));

  return {
    language: languageOf(language),
    primary: primaryOf(locales),
    ...marketsFor(markets, locales, locale),
    /** When the newest completed measurement finished. */
    measuredAt: summary.lastCompleted?.finishedAt ?? null,
    measured,
    measurement,
    /** A measurement under way reads this language. */
    scanning,
    canCount,
    /** Jobs translating into this language now (the page reloads while one runs or a measurement reads it). */
    activeJobs: jobs.length,
    // Figures only for a fully measured language: a measurement under way has read only part of it.
    headline: measured ? headline : null,
    steps: measured ? stepCounts(headline.counts) : null,
    payoff: measured ? reviewPayoff(headline) : null,
    categories: measured ? categories : [],
    extras: measured
      ? EXTRA_IDS.map((id) => ({ id, tally: tallies[id], state: id === "urls" ? null : categoryState(summary.segments, locale, id, { scanning }) }))
      : [],
    next: nextSteps({
      locale,
      measured,
      canCount,
      headline,
      categories: categories.map((c) => ({ id: c.id, tally: c.tally, state: c.state, bulk: gate === null && c.bulk !== null })),
    }),
    bulk: { gate, publishMode: publishModeOf(settings, billing.entitlements), aiRemaining: aiRemaining(billing, used) },
    smart: note ? { status: note.status, mode: note.mode, zone: note.zone, nextCheck: note.nextCheck, inSchedule: note.scope.locales.includes(locale) } : null,
    /** One key per page view: a repeated confirm starts nothing twice. */
    idempotencyKey: randomUUID(),
  };
}

export type LanguagePage = Awaited<ReturnType<typeof loadLanguagePage>>;

/** A Shopify CDN image at the width shown (Shopify's width parameter); null for anything but an http(s) URL. */
function sizedImage(image: PreviewNode["image"] | undefined, width: number) {
  if (!image) return null;
  try {
    const url = new URL(image.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.searchParams.set("width", String(width));
    return { url: url.toString(), alt: image.alt };
  } catch {
    return null;
  }
}

/** Plain-text kinds of Shopify's translatable content (no HTML, rich text, JSON lists or links). */
const PLAIN_TEXT = new Set(["SINGLE_LINE_TEXT_FIELD", "MULTI_LINE_TEXT_FIELD", "STRING"]);
/** Keys that name a thing (a menu's title, an option's name, a filter's label), shown before any other text. */
const NAME_KEYS = ["title", "name", "label"];

/**
 * The text an item is shown by, with its translation (the same key): its
 * name, else its first counted plain text, never a URL handle. Texts longer
 * than `max` are left out, or cut with "…" when `cut`.
 */
function shownText(data: TranslatableResourceData, row: Pick<ItemRow, "resourceType" | "sourceKeys">, max: number, cut: boolean) {
  const plain = data.content.filter(
    (c) => row.sourceKeys.includes(c.key) && fieldGroupOf(c.key, row.resourceType) !== "url" && PLAIN_TEXT.has(c.type) && c.value?.trim() && !/^[[{]/.test(c.value.trim()),
  );
  const chosen = [...plain.filter((c) => NAME_KEYS.includes(c.key)), ...plain.filter((c) => !NAME_KEYS.includes(c.key))].find(
    (c) => cut || c.value!.trim().length <= max,
  );
  if (!chosen) return null;
  const shorten = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  };
  return { key: chosen.key, original: shorten(chosen.value)!, translated: shorten(data.translations.find((t) => t.key === chosen.key)?.value) };
}

/** A read the page can do without (it shows icons or ids instead): null when it failed, never a failed page. */
async function settle<T>(shopId: string, what: string, read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    // A thrown Response is a Shopify timeout (admin-timeout.ts). Names only: a message may quote merchant data.
    logger.warn({ shopId, err: error instanceof Error ? error.name : "Response" }, `${what}: Shopify could not be read`);
    return null;
  }
}

/** Categories shown by pictures with their names; pages as a list of names; the rest as originals beside their translations. */
const PICTURE_CATEGORIES: ReadonlySet<CategoryId> = new Set(["products", "collections", "blog", "images"]);
const previewLimit = (category: CategoryId) => (PICTURE_CATEGORIES.has(category) ? 6 : 5);
/** Longest original a text preview shows: one short line beside its translation. */
const PREVIEW_TEXT_MAX = 60;

export interface PreviewItem {
  /** The coverage item (a stable key). */
  id: string;
  type: string;
  /** The item's one state (open work comes first). */
  state: ItemState;
  /** What the item is called in the original language: a title, an image's description, or one short text. Null: Shopify couldn't be read. */
  original: string | null;
  /** That text in the language as customers see it (an outdated translation too); null without one. */
  translated: string | null;
  /** The state of that text itself. */
  textState: ItemState | null;
  /** Custom fields: the field's name. */
  label: string | null;
  /** Products, collections, blog posts and product images: the picture, sized for a 96 px tile. */
  image: { url: string; alt: string | null } | null;
  /** The editor (images: their owner's, when known). */
  href: string | null;
}

export interface CategoryPreview {
  items: PreviewItem[];
  /** Shopify couldn't be read: the items have no names or pictures (the card shows icons). */
  error: boolean;
}

export type LanguagePreviews = Record<CategoryId, CategoryPreview>;

const previewsCache = new Map<string, { at: number; value: LanguagePreviews }>();

/** Tests only: forget cached previews. */
export function clearLanguagePreviewsCache() {
  previewsCache.clear();
}

/**
 * Up to six items per category to show on a language's cards (five for
 * texts and pages), open work first, with their names, translations and
 * pictures: one database query per category on the coverage index, then the
 * shown items read from Shopify (one read of each kind for every category).
 * Kept for a minute per shop and language; a failed read isn't kept. 404
 * unless the language is one of the shop's additional languages (as Shopify
 * had them in the last few minutes: no Shopify read per request).
 */
export async function loadLanguagePreviews(admin: Admin, shop: { id: string }, locale: string, client: PrismaClient = defaultClient, now = Date.now()) {
  const { targets } = await currentShopLocales(shop.id, async () => admin, client, now);
  if (!targets.includes(locale)) throw new Response("Unknown language", { status: 404 });
  const cacheKey = `${shop.id}|${locale}`;
  const cached = previewsCache.get(cacheKey);
  if (cached && now - cached.at < PREVIEWS_CACHE_MS) return cached.value;

  const picked = await withTenant(
    shop.id,
    async (tx) => {
      const rows = new Map<CategoryId, ItemRow[]>();
      for (const id of CATEGORY_IDS) {
        rows.set(
          id,
          await tx.$queryRaw<ItemRow[]>`
            SELECT * FROM (
              SELECT "id", "resourceType", "resourceGid", "parentGid", "sourceKeys", "fieldStates", ${RANK} AS "rank"
              FROM "CoverageItem"
              WHERE "shopId" = ${shop.id}::uuid AND "locale" = ${locale} AND "resourceType" = ANY(${CATEGORIES[id].types as readonly string[]}::text[])
            ) i
            WHERE "rank" IS NOT NULL
            ORDER BY "rank", "id"
            LIMIT ${previewLimit(id)}`,
        );
      }
      return rows;
    },
    client,
  );

  const all = [...picked.values()].flat();
  // Names and pictures, and custom fields' names; every other type (custom fields' values too) by its content.
  const nodeIds = all.filter((r) => PREVIEW_NODE_TYPES.has(r.resourceType) || isMetafieldCoverageType(r.resourceType)).map((r) => r.resourceGid);
  const contentIds = all.filter((r) => !PREVIEW_NODE_TYPES.has(r.resourceType)).map((r) => r.resourceGid);
  const [nodes, content] = await Promise.all([
    nodeIds.length ? settle(shop.id, "language previews", readPreviewNodes(admin, nodeIds, locale)) : new Map<string, PreviewNode>(),
    contentIds.length ? settle(shop.id, "language previews", translatableByIds(admin, contentIds, locale)) : new Map<string, TranslatableResourceData>(),
  ]);

  const value = Object.fromEntries(
    CATEGORY_IDS.map((id): [CategoryId, CategoryPreview] => {
      const rows = picked.get(id)!;
      const items = rows.flatMap((row): PreviewItem[] => {
        const base = { id: row.id, type: row.resourceType, state: stateOfRank(row.rank), href: itemEditorPath(row, locale) };
        const unread = { ...base, original: null, translated: null, textState: null, label: null, image: null };
        if (PREVIEW_NODE_TYPES.has(row.resourceType)) {
          if (!nodes) return [unread];
          const node = nodes.get(row.resourceGid);
          // Gone from Shopify since it was counted.
          if (!node) return [];
          return [{ ...base, original: node.text, translated: node.translated, textState: stateOfKey(row, node.key), label: null, image: sizedImage(node.image, PREVIEW_IMAGE_WIDTH) }];
        }
        if (!content) return [unread];
        const data = content.get(row.resourceGid);
        const shown = data ? shownText(data, row, PREVIEW_TEXT_MAX, false) : null;
        // Gone from Shopify, or nothing short enough to show beside its translation (a policy is one long text).
        if (!shown) return [];
        return [{ ...base, original: shown.original, translated: shown.translated, textState: stateOfKey(row, shown.key), label: nodes?.get(row.resourceGid)?.label ?? null, image: null }];
      });
      return [id, { items, error: rows.some((r) => (PREVIEW_NODE_TYPES.has(r.resourceType) ? nodes === null : content === null)) }];
    }),
  ) as LanguagePreviews;

  if (nodes !== null && content !== null) {
    previewsCache.set(cacheKey, { at: now, value });
    if (previewsCache.size > 1000) previewsCache.delete(previewsCache.keys().next().value!);
  }
  return value;
}

/** The list's state filter: one item state, or every item. */
export type ListState = ItemState | "all";

export interface CategoryListQuery {
  /** "all" (the default) or an item state (ITEM_STATES). */
  state?: string | null;
  /** Title search (categories of types Shopify can search). */
  q?: string | null;
  /** Where the previous page ended (its nextCursor). */
  after?: string | null;
}

export interface CategoryRow {
  /** The coverage item (a stable key). */
  id: string;
  type: string;
  /** The end of its Shopify id, to tell items apart where Shopify gave no name. */
  reference: string;
  state: ItemState;
  /** Each of its texts (field group, URL handle left out) with its state, in a fixed order. */
  texts: ReturnType<typeof textStates>;
  /** Its texts per state (URL handle left out). */
  counts: StateCounts;
  /** Why its last translation failed (a job item's code), when it did. */
  failureCode: string | null;
  /** The editor (custom fields and images: their owner's, when known). */
  href: string | null;
  smart: SmartBadge | null;
  /** Live from Shopify, null when it couldn't be read: its name in the original language (custom fields: their owner's). */
  title: string | null;
  /** That name in the language as customers see it; null without one. */
  translated: string | null;
  /** Custom fields: the field's name. */
  label: string | null;
  /** Products, collections, blog posts and product images: the picture, sized for a 64 px thumbnail. */
  image: { url: string; alt: string | null } | null;
}

/** Longest name a list row shows (longer ones are cut). */
const ROW_TEXT_MAX = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A list position: the last shown row's state rank and id ("2.<uuid>"). */
function parseCursor(value: string | null | undefined) {
  const match = /^(\d)\.(.+)$/.exec(value ?? "");
  const rank = Number(match?.[1]);
  return match && rank < ITEM_STATES.length && UUID.test(match[2]!) ? { rank, id: match[2]! } : null;
}

/** Shopify's title search over the category's searchable types (at most 100 matches each). */
async function searchCategory(admin: Admin, types: readonly SearchableType[], text: string) {
  const found = await Promise.all(
    types.map((type) =>
      searchIds(admin, type, text).catch((error: unknown) => {
        // A type the app may not read finds nothing.
        if (error instanceof AccessDeniedError) return [];
        throw error;
      }),
    ),
  );
  return found.flat();
}

/** Its texts per state, the URL handle left out (fieldStates "group:state"). */
function textCounts(fieldStates: readonly string[]): StateCounts {
  const counts = emptyCounts();
  for (const entry of fieldStates) {
    const group = entry.slice(0, entry.indexOf(":"));
    const state = entry.slice(entry.indexOf(":") + 1);
    if (isFieldState(state) && !(HEADLINE_EXCLUDED_GROUPS as readonly string[]).includes(group)) counts[state]++;
  }
  return counts;
}

/**
 * A category's items in a language, 50 a page: how many there are in each
 * state (each item in exactly one, so the filters add up to "all"), the
 * page in state order (open work first) then by id, keyset-paged, with a
 * title search for the types Shopify can search. Names, translations and
 * pictures of the shown rows are read live from Shopify (best effort: the
 * list works without them). Also the category's figure, texts waiting for
 * approval, running job and what translating it would do. 404 for an
 * unknown category or language.
 */
export async function loadCategoryItems(
  admin: Admin,
  shop: ShopRef,
  locale: string,
  category: string,
  query: CategoryListQuery = {},
  client: PrismaClient = defaultClient,
  options: Pick<LanguagePageOptions, "jobsAvailable" | "aiAvailable" | "now"> = {},
) {
  if (!isCategoryId(category)) throw new Response("Not found", { status: 404 });
  const jobsAvailable = options.jobsAvailable ?? getQueues() !== null;
  const aiAvailable = options.aiAvailable ?? getTranslationProvider() !== null;
  const { language, locales, targets } = await targetLanguage(admin, shop.id, locale, client);
  const types = CATEGORIES[category].types as readonly string[];
  const searchable = types.filter(isSearchableType);
  const state: ListState = (ITEM_STATES as readonly string[]).includes(query.state ?? "") ? (query.state as ItemState) : "all";
  const search = searchable.length ? (query.q ?? "").trim().slice(0, 100) : "";
  const cursor = parseCursor(query.after);
  // A search keeps Shopify's matches only, in the counts too, so the filters still add up.
  const gids = search ? await searchCategory(admin, searchable, search) : null;

  const [coverage, settings, billing, jobs, used] = await Promise.all([
    loadCoverageState(shop.id, client),
    getShopSettings(shop.id, client),
    shopBilling(admin, shop),
    activeJobs(shop.id, locale, client),
    getMonthlyUsage(shop.id, undefined, client),
  ]);

  const scope = Prisma.sql`"shopId" = ${shop.id}::uuid AND "locale" = ${locale} AND "resourceType" = ANY(${types}::text[])${
    gids ? Prisma.sql` AND "resourceGid" = ANY(${gids}::text[])` : Prisma.empty
  }`;
  const stateRank = state === "all" ? null : ITEM_STATES.indexOf(state);
  const { totals, rows, estimate } = await withTenant(
    shop.id,
    async (tx) => {
      // In one pass: items per type and state, how many come before this page (its position), and
      // those read before their originals' lengths were kept. Items with only a URL handle (no
      // rank) are left out afterwards: filtering them here would compute every rank twice.
      const groups = await tx.$queryRaw<Array<{ resourceType: string; rank: number | null; total: number; before: number; unsized: number }>>`
        SELECT "resourceType", "rank", count(*)::integer AS "total", ${
          cursor ? Prisma.sql`count(*) FILTER (WHERE ("rank", "id") <= (${cursor.rank}::int, ${cursor.id}::uuid))` : Prisma.sql`0`
        }::integer AS "before", count(*) FILTER (WHERE "unsized")::integer AS "unsized"
        FROM (
          SELECT "resourceType", "id", cardinality("sourceChars") < cardinality("sourceKeys") AS "unsized", ${RANK} AS "rank"
          FROM "CoverageItem"
          WHERE ${scope}
        ) i
        GROUP BY "resourceType", "rank"`;
      const totals = groups.filter((g): g is (typeof groups)[number] & { rank: number } => g.rank !== null);
      const rows = await tx.$queryRaw<Array<ItemRow & { lastAttemptFailed: boolean; failureCode: string | null }>>`
        SELECT * FROM (
          SELECT "id", "resourceType", "resourceGid", "parentGid", "sourceKeys", "fieldStates", "lastAttemptFailed", "failureCode", ${RANK} AS "rank"
          FROM "CoverageItem"
          WHERE ${scope}
        ) i
        WHERE "rank" IS NOT NULL${stateRank === null ? Prisma.empty : Prisma.sql` AND "rank" = ${stateRank}::int`}${
          cursor ? Prisma.sql` AND ("rank", "id") > (${cursor.rank}::int, ${cursor.id}::uuid)` : Prisma.empty
        }
        ORDER BY "rank", "id"
        LIMIT ${CATEGORY_PAGE_SIZE + 1}`;
      // Open items per type from the pass above, unless a search left items out of it.
      const open = new Map<string, OpenItems>();
      for (const g of totals) {
        if (!(OPEN_STATES as readonly string[]).includes(ITEM_STATES[g.rank]!)) continue;
        const sum = open.get(g.resourceType) ?? { items: 0, unsized: 0 };
        open.set(g.resourceType, { items: sum.items + g.total, unsized: sum.unsized + g.unsized });
      }
      const estimate = (await bulkEstimates(tx, shop.id, locale, coverage.counts, [category], gids ? undefined : open)).get(category) ?? null;
      return { totals, rows, estimate };
    },
    client,
  );
  const page = rows.slice(0, CATEGORY_PAGE_SIZE);

  // The shown rows' names and pictures; custom fields by their owner's name and their own.
  const metafield = (row: ItemRow) => isMetafieldCoverageType(row.resourceType);
  const nodeIds = [
    ...new Set(page.flatMap((r) => (PREVIEW_NODE_TYPES.has(r.resourceType) ? [r.resourceGid] : metafield(r) ? [r.resourceGid, ...(r.parentGid ? [r.parentGid] : [])] : []))),
  ];
  const contentIds = page.filter((r) => !PREVIEW_NODE_TYPES.has(r.resourceType) && !metafield(r)).map((r) => r.resourceGid);
  const [nodes, content] = await Promise.all([
    nodeIds.length ? settle(shop.id, "category list", readPreviewNodes(admin, nodeIds, locale)) : new Map<string, PreviewNode>(),
    contentIds.length ? settle(shop.id, "category list", translatableByIds(admin, contentIds, locale)) : new Map<string, TranslatableResourceData>(),
  ]);
  // What the smart schedule does with the shown rows: translating now, left alone, or waiting for its next check.
  const note = await loadSmartCoverageNote(shop.id, await smartContext(billing, settings, targets), client);
  const work = note ? await smartWorkOn(shop.id, locale, page, client) : null;

  const measured = measuredLocales(coverage.lastCompleted, coverage.segments, COVERAGE_TYPES).has(locale);
  const scanning = scanningOf(coverage.report, measurementState(coverage.report, { jobsAvailable, now: options.now ?? Date.now() }), locale);
  const figure = categoryTallies(coverage.counts, locale)[category];
  const counts = Object.fromEntries(ITEM_STATES.map((s, rank) => [s, totals.filter((t) => t.rank === rank).reduce((n, t) => n + t.total, 0)])) as Record<ItemState, number>;
  const shown = totals.filter((t) => stateRank === null || t.rank === stateRank);
  const before = shown.reduce((n, t) => n + t.before, 0);
  const last = page[page.length - 1];

  return {
    language: languageOf(language),
    primary: primaryOf(locales),
    measured,
    scanning,
    category: {
      id: category,
      tier: tierOf(category),
      state: categoryState(coverage.segments, locale, category, { scanning }),
      // Figures only for a fully measured language (COVERAGE_RULES §3).
      tally: measured ? figure : null,
      payoff: measured ? reviewPayoff(figure) : null,
      review: categoryReview(coverage.counts, locale, category, figure),
      job: categoryJob(jobs, category),
      /** Shopify can search its items by title. */
      searchable: searchable.length > 0,
    },
    filter: { state, q: search },
    /** Items per state; every item is in exactly one, so they add up to `all`. */
    counts: { all: Object.values(counts).reduce((n, c) => n + c, 0), ...counts },
    rows: page.map((row): CategoryRow => {
      const node = nodes?.get(row.resourceGid);
      const data = content?.get(row.resourceGid);
      const text = data ? shownText(data, row, ROW_TEXT_MAX, true) : null;
      return {
        id: row.id,
        type: row.resourceType,
        reference: numericId(row.resourceGid),
        state: stateOfRank(row.rank),
        texts: textStates(row.fieldStates),
        counts: textCounts(row.fieldStates),
        failureCode: row.lastAttemptFailed ? row.failureCode : null,
        href: itemEditorPath(row, locale),
        smart: work && note ? smartBadge(work, note, { locale, resourceType: row.resourceType, resourceGid: row.resourceGid, parentGid: row.parentGid, fields: row.fieldStates }) : null,
        ...(metafield(row)
          ? { title: (row.parentGid ? nodes?.get(row.parentGid)?.text : null) ?? null, translated: null, label: node?.label ?? null }
          : { title: node?.text ?? text?.original ?? null, translated: node?.translated ?? text?.translated ?? null, label: null }),
        image: sizedImage(node?.image, ROW_IMAGE_WIDTH),
      };
    }),
    page: {
      /** Positions of the shown rows among `total` (from 1), and the page's number. */
      from: page.length ? before + 1 : 0,
      to: before + page.length,
      total: shown.reduce((n, t) => n + t.total, 0),
      number: Math.floor(before / CATEGORY_PAGE_SIZE) + 1,
      nextCursor: rows.length > CATEGORY_PAGE_SIZE && last ? `${last.rank}.${last.id}` : null,
    },
    /** Shopify couldn't be read: rows show their kind and reference instead of names. */
    titlesUnavailable: nodes === null || content === null,
    bulk: {
      estimate,
      gate: bulkGate({ jobsAvailable, aiAvailable, entitlements: billing.entitlements, targets, locale, consent: hasCurrentAiConsent(settings) }),
      publishMode: publishModeOf(settings, billing.entitlements),
      aiRemaining: aiRemaining(billing, used),
    },
    smart: note ? { nextCheck: note.nextCheck, zone: note.zone } : null,
    /** One key per page view: a repeated confirm starts nothing twice. */
    idempotencyKey: randomUUID(),
  };
}

export type CategoryItems = Awaited<ReturnType<typeof loadCategoryItems>>;

export type TranslateCategoryError = "UNKNOWN_INTENT" | "INVALID_REQUEST" | "NOTHING_TO_TRANSLATE" | BulkGate;

/**
 * The language page's and a category list's action (intent
 * translate-category, after the merchant confirmed): one bulk job per type
 * of the category that bulk jobs translate and that has texts to translate
 * in the language, then that job's page (the Jobs page for several). Each
 * type's job has its own idempotency key derived from the form's, so a
 * repeated submit starts nothing twice; a type with a job already running
 * keeps that job (createBulkJob). The language comes from the route; the
 * shop's languages, plan and consent are checked again here.
 */
export async function translateCategoryAction(
  admin: Admin,
  shop: ShopRef,
  input: { locale: string; form: FormData; requestedBy: string | null },
  client: PrismaClient = defaultClient,
): Promise<{ error: TranslateCategoryError } | Response> {
  const { form, locale } = input;
  if (form.get("intent") !== "translate-category") return { error: "UNKNOWN_INTENT" };
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const category = String(form.get("category") ?? "");
  // Image descriptions and custom fields are never translated in bulk (a job would translate their owners).
  if (!/^[A-Za-z0-9-]{8,80}$/.test(idempotencyKey) || !isCategoryId(category) || !bulkTypesOf(category).length) return { error: "INVALID_REQUEST" };
  const targets = (await fetchAndSyncShopLocales(admin, shop.id, client)).locales.filter((l) => !l.primary).map((l) => l.locale);
  if (!targets.includes(locale)) return { error: "INVALID_REQUEST" };
  const billing = await shopBilling(admin, shop);
  const gate = bulkGate({
    jobsAvailable: getQueues() !== null,
    aiAvailable: getTranslationProvider() !== null,
    entitlements: billing.entitlements,
    targets,
    locale,
    consent: hasCurrentAiConsent(await getShopSettings(shop.id, client)),
  });
  if (gate) return { error: gate };
  const types = typesToTranslate(await loadCounts(shop.id, client), locale, category);
  if (!types.length) return { error: "NOTHING_TO_TRANSLATE" };
  // With the image descriptions and custom fields of the products, collections, pages and blog posts, when asked.
  const includeAttached = form.get("includeAttached") === "on";
  try {
    const jobs = [];
    for (const type of types) {
      // Bulk jobs translate only missing and outdated fields; failed items are tried again,
      // drafts waiting for review and protected translations are left alone.
      const { job } = await startBulkJob({
        shopId: shop.id,
        resourceType: type,
        targetLocale: locale,
        requestedBy: input.requestedBy,
        idempotencyKey: `${idempotencyKey}:${type}`,
        fieldScope: "ALL",
        includeAttached,
      });
      jobs.push(job);
    }
    return redirect(jobs.length === 1 ? `/app/jobs/${jobs[0]!.id}` : "/app/jobs");
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
}
