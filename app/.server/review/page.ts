/**
 * Review's page ("Übersetzungen prüfen", app/routes/app.review.tsx): the
 * texts waiting for approval as cards, one per item and language, with an
 * image's or a custom field's texts inside their owner's card, paged by
 * whole cards (app/lib/review-cards.ts), plus the counts of the page's tabs
 * and chips. Every text keeps the area the language pages give it
 * (app/lib/review-areas.ts), so the counts add up and match theirs.
 *
 * All reads in the database, inside withTenant (RLS): no Shopify call.
 * Sorting and paging are raw SQL (Prisma can't order by an expression);
 * the expressions are static text, every value is a parameter. The owner
 * of an image or custom field drafted without one (a smart check of the
 * image itself, an import) is the one the coverage scan stored
 * (CoverageItem.parentGid), looked up only for those drafts. The order's
 * pure mirror is app/lib/review-order.ts; searchPendingDrafts in
 * drafts.ts stays as it is for its other callers.
 */
import { Prisma, type PrismaClient, type TranslationDraft } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { sanitizeHtml } from "../lib/sanitize-html";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { isRtlLocale, storedShopLocales } from "../locales/shop-locales";
import { peekMarketCountries } from "../markets/countries";
import { loadCounts } from "../coverage/items";
import { draftToken, escapeLike, isHumanDraft } from "./drafts";
import { fieldGroupOf, type FieldGroup } from "../../lib/coverage-rules";
import { headlineByLocale } from "../../lib/coverage-view";
import { categoryOf, reviewPayoff } from "../../lib/language-categories";
import { editorPathFor } from "../../lib/resource-kinds";
import { richTextPreviewOrNull } from "../../lib/rich-text-preview";
import { structuredItems } from "../../lib/structured-preview";
import { chosen } from "../../lib/select-all";
import { assembleCards, cardKeyOf } from "../../lib/review-cards";
import { readIssues, type ReviewIssue } from "../../lib/review-hints";
import {
  AREA_KEYS,
  areaOf,
  areaTypes,
  ATTACHED_TYPES,
  cardTypeOf,
  customFieldName,
  isAreaKey,
  KNOWN_TYPES,
  LEGACY_TYPE_AREA,
  ownerTitle,
  type AreaKey,
} from "../../lib/review-areas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** About this many texts a page; never more than REVIEW_PAGE_MAX (one "Approve all" request, MAX_DRAFTS_PER_ACTION). */
export const REVIEW_PAGE_BUDGET = 50;
export const REVIEW_PAGE_MAX = 100;
/** Matches the indexed search hands over; more fall back to scanning (as searchPendingDrafts). */
const SEARCH_MATCHES = 5000;
const SEO_KEYS = ["meta_title", "meta_description"];

export type ReviewGroup = "content" | "seo" | "handle";

export interface ReviewFilter {
  locale: string | null;
  area: AreaKey | null;
  flagged: boolean;
  /** Trimmed, at most 100 characters. */
  search: string | null;
  jobId: string | null;
  group: ReviewGroup | null;
  /** Id of the previous page's last draft. */
  after: string | null;
}

/** Review's URL parameters ("all" counts as no filter; `type` is the old name of an area). */
export function parseReviewFilter(params: URLSearchParams): ReviewFilter {
  const q = (name: string) => chosen(params.get(name));
  const area = q("area");
  const type = q("type");
  const group = q("group");
  const search = q("q")?.trim().slice(0, 100) || null;
  const uuid = (value: string | null) => (value && UUID.test(value) ? value : null);
  return {
    locale: q("lang"),
    area: area && isAreaKey(area) ? area : type && Object.hasOwn(LEGACY_TYPE_AREA, type) ? LEGACY_TYPE_AREA[type]! : null,
    flagged: q("flagged") === "1",
    search,
    jobId: uuid(q("job")),
    group: group === "content" || group === "seo" || group === "handle" ? group : null,
    after: uuid(q("after")),
  };
}

// ---------------------------------------------------------------- SQL (static text; values are parameters)

const KIND = Prisma.sql`split_part(d."resourceGid", '/', 4)`;
const PARENT_TYPE = Prisma.sql`CASE split_part(d."parentGid", '/', 4) WHEN 'Product' THEN 'PRODUCT' WHEN 'Collection' THEN 'COLLECTION' WHEN 'Page' THEN 'PAGE' WHEN 'Article' THEN 'ARTICLE' END`;

/**
 * One row per draft with what it is ordered and grouped by: its owner (an
 * image's or custom field's product, collection, page or post), its card
 * and its own type (review-areas.ts ownType). The coverage look-up runs
 * only for drafts without a stored owner that may have one, and for imports
 * of other content (their type).
 */
function draftRows(where: Prisma.Sql) {
  return Prisma.sql`
    SELECT d."id", d."locale", d."resourceGid", d."key", d."issues", o."owner", COALESCE(o."owner", d."resourceGid") AS "cardGid", o."ownType"
    FROM "TranslationDraft" d
    LEFT JOIN "TranslationJob" j ON j."id" = d."jobId" AND j."shopId" = d."shopId"
    LEFT JOIN LATERAL (
      SELECT c."parentGid", c."resourceType"
      FROM "CoverageItem" c
      WHERE d."parentGid" IS NULL
        AND ${KIND} NOT IN ('Product', 'Collection', 'Page', 'Article', 'Blog')
        AND (j."resourceType" IS NULL OR j."resourceType" = ANY(${ATTACHED_TYPES}::text[]))
        AND c."shopId" = d."shopId" AND c."locale" = d."locale" AND c."resourceGid" = d."resourceGid"
    ) cov ON true
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(d."parentGid", CASE WHEN d."jobId" IS NULL OR j."resourceType" = ANY(${ATTACHED_TYPES}::text[]) THEN cov."parentGid" END) AS "owner",
        CASE
          WHEN d."parentGid" IS NOT NULL THEN
            CASE WHEN ${KIND} = 'Metafield' THEN ${PARENT_TYPE} || '_METAFIELD'
                 ELSE CASE ${PARENT_TYPE} WHEN 'PRODUCT' THEN 'MEDIA_IMAGE' WHEN 'COLLECTION' THEN 'COLLECTION_IMAGE' WHEN 'ARTICLE' THEN 'ARTICLE_IMAGE' END
            END
          WHEN ${KIND} IN ('Product', 'Collection', 'Page', 'Article', 'Blog') THEN upper(${KIND})
          WHEN ${KIND} = 'MediaImage' THEN 'MEDIA_IMAGE'
          ELSE COALESCE(j."resourceType", cov."resourceType")
        END AS "ownType"
    ) o
    WHERE ${where}`;
}

// Over draftRows (x): the sort values (review-order.ts).
const TYPE_RANK = Prisma.sql`CASE split_part(x."cardGid", '/', 4) WHEN 'Product' THEN 1 WHEN 'Collection' THEN 2 WHEN 'Page' THEN 3 WHEN 'Article' THEN 4 WHEN 'Blog' THEN 5 ELSE 9 END`;
const ID_LEN = Prisma.sql`length(split_part(x."cardGid", '/', 5))`;
const FIELD_RANK = Prisma.sql`CASE
  WHEN x."owner" IS NOT NULL THEN CASE WHEN x."key" = 'alt' THEN 50 ELSE 60 END
  WHEN x."key" IN ('title', 'name', 'label') THEN 10
  WHEN x."key" IN ('body_html', 'body', 'summary_html', 'description') THEN 20
  WHEN x."key" = 'meta_title' THEN 30
  WHEN x."key" = 'meta_description' THEN 40
  WHEN x."key" = 'alt' THEN 50
  WHEN x."key" = 'value' THEN 60
  WHEN x."key" = 'handle' THEN 90
  ELSE 70 END`;
const SORT_TUPLE = Prisma.sql`(${TYPE_RANK}, ${ID_LEN}, x."cardGid", x."locale", ${FIELD_RANK}, x."resourceGid", x."key", x."id")`;
const SORT_ORDER = Prisma.sql`${TYPE_RANK}, ${ID_LEN}, x."cardGid", x."locale", ${FIELD_RANK}, x."resourceGid", x."key", x."id"`;

interface SortTuple {
  typeRank: number;
  idLen: number;
  cardGid: string;
  locale: string;
  fieldRank: number;
  resourceGid: string;
  key: string;
  id: string;
}

const cursorAfter = (c: SortTuple) =>
  Prisma.sql`${SORT_TUPLE} > (${c.typeRank}::int, ${c.idLen}::int, ${c.cardGid}::text, ${c.locale}::text, ${c.fieldRank}::int, ${c.resourceGid}::text, ${c.key}::text, ${c.id}::uuid)`;
const cursorUpTo = (c: SortTuple) =>
  Prisma.sql`${SORT_TUPLE} <= (${c.typeRank}::int, ${c.idLen}::int, ${c.cardGid}::text, ${c.locale}::text, ${c.fieldRank}::int, ${c.resourceGid}::text, ${c.key}::text, ${c.id}::uuid)`;

/** The area filter over draftRows (x): web addresses by key, "other" by exclusion, any area by its types. */
function areaCondition(area: AreaKey | null) {
  if (!area) return Prisma.sql`TRUE`;
  if (area === "urls") return Prisma.sql`x."key" = 'handle'`;
  if (area === "other") return Prisma.sql`x."key" <> 'handle' AND (x."ownType" IS NULL OR NOT (x."ownType" = ANY(${KNOWN_TYPES}::text[])))`;
  return Prisma.sql`x."key" <> 'handle' AND x."ownType" = ANY(${areaTypes(area)}::text[])`;
}

const FLAGGED = Prisma.sql`d."issues" IS NOT NULL AND d."issues" <> '[]'::jsonb`;

function groupCondition(group: ReviewGroup | null) {
  if (group === "seo") return Prisma.sql`d."key" = ANY(${SEO_KEYS}::text[])`;
  if (group === "handle") return Prisma.sql`d."key" = 'handle'`;
  if (group === "content") return Prisma.sql`NOT (d."key" = ANY(${[...SEO_KEYS, "handle"]}::text[]))`;
  return Prisma.sql`TRUE`;
}

/** Pending drafts of the shop in its current languages, in the job's and the old field group's scope (what every count shares). */
function scopeCondition(shopId: string, targets: string[] | null, filter: Pick<ReviewFilter, "jobId" | "group">) {
  return Prisma.join(
    [
      Prisma.sql`d."shopId" = ${shopId}::uuid`,
      Prisma.sql`d."status" = 'PENDING'`,
      targets ? Prisma.sql`d."locale" = ANY(${targets}::text[])` : Prisma.sql`TRUE`,
      filter.jobId ? Prisma.sql`d."jobId" = ${filter.jobId}::uuid` : Prisma.sql`TRUE`,
      groupCondition(filter.group),
    ],
    " AND ",
  );
}

// ---------------------------------------------------------------- the page

export interface ReviewFacets {
  /** Waiting texts in the current languages, in scope (job, group). */
  total: number;
  languages: Array<{ locale: string; count: number }>;
  /** Within the chosen language: each text in its own area. */
  areas: Array<{ area: AreaKey; count: number }>;
  /** Texts with quality notes within the chosen language and area. */
  flagged: number;
}

interface FacetRow {
  locale: string;
  ownType: string | null;
  handle: boolean;
  flagged: boolean;
  count: number;
}

/** The counts of the page's language tabs, area chips and "With notes", from one grouped scan; they add up by construction. */
export function facetsOf(rows: readonly FacetRow[], filter: Pick<ReviewFilter, "locale" | "area">): ReviewFacets {
  const languages = new Map<string, number>();
  const areas = new Map<AreaKey, number>();
  let total = 0;
  let flagged = 0;
  for (const row of rows) {
    total += row.count;
    languages.set(row.locale, (languages.get(row.locale) ?? 0) + row.count);
    if (filter.locale && row.locale !== filter.locale) continue;
    const area = areaOf(row.handle ? "handle" : "", row.ownType);
    areas.set(area, (areas.get(area) ?? 0) + row.count);
    if (row.flagged && (!filter.area || filter.area === area)) flagged += row.count;
  }
  if (filter.locale && !languages.has(filter.locale)) languages.set(filter.locale, 0);
  if (filter.area && !areas.has(filter.area)) areas.set(filter.area, 0);
  return {
    total,
    languages: [...languages].map(([locale, count]) => ({ locale, count })),
    areas: AREA_KEYS.filter((area) => areas.has(area))
      .map((area) => ({ area, count: areas.get(area)! })),
    flagged,
  };
}

export interface ReviewPageRow extends SortTuple {
  owner: string | null;
  ownType: string | null;
}

export interface ReviewPageResult {
  facets: ReviewFacets;
  /** The page's drafts in order, card by card (rows of the page query plus the draft itself). */
  cards: Array<{ key: string; continued: boolean; continues: boolean; rows: Array<ReviewPageRow & { draft: TranslationDraft }> }>;
  matching: number;
  /** Position of the page among the matching texts (1-based), with a cursor; else from 1. */
  from: number;
  nextCursor: string | null;
}

/**
 * One page of cards for the filter, the matching count, the page's
 * position and the facets; every pending draft appears exactly once across
 * the pages (strict keyset on a total order that ends with the id; the
 * cursor's sort values are read whatever its status now).
 */
export async function searchReviewPage(
  shopId: string,
  filter: ReviewFilter,
  options: { targets: string[] | null; budget?: number; max?: number } = { targets: null },
  client: PrismaClient = defaultClient,
): Promise<ReviewPageResult> {
  const budget = options.budget ?? REVIEW_PAGE_BUDGET;
  const max = options.max ?? REVIEW_PAGE_MAX;
  return withTenant(
    shopId,
    async (tx) => {
      const scope = scopeCondition(shopId, options.targets, filter);
      let text = Prisma.sql`TRUE`;
      if (filter.search) {
        // Three characters or more: the indexed search (SECURITY_MODEL §5l), as searchPendingDrafts.
        let ids: string[] | null = null;
        if ([...filter.search].length >= 3) {
          const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM linguva_draft_search(${filter.search}, ${SEARCH_MATCHES + 1}::int)`;
          if (found.length <= SEARCH_MATCHES) ids = found.map((r) => r.id);
        }
        const pattern = `%${escapeLike(filter.search)}%`;
        text = ids
          ? Prisma.sql`d."id" = ANY(${ids}::uuid[])`
          : Prisma.sql`(d."resourceTitle" ILIKE ${pattern} OR d."sourceValue" ILIKE ${pattern} OR d."value" ILIKE ${pattern})`;
      }
      const where = Prisma.join(
        [scope, filter.locale ? Prisma.sql`d."locale" = ${filter.locale}` : Prisma.sql`TRUE`, filter.flagged ? FLAGGED : Prisma.sql`TRUE`, text],
        " AND ",
      );
      const area = areaCondition(filter.area);
      const cursor = filter.after ? await cursorTuple(tx, shopId, filter.after) : null;

      const rows = await tx.$queryRaw<ReviewPageRow[]>`
        SELECT x."id", x."cardGid", x."locale", x."resourceGid", x."key", x."owner", x."ownType",
               ${TYPE_RANK} AS "typeRank", ${ID_LEN} AS "idLen", ${FIELD_RANK} AS "fieldRank"
        FROM (${draftRows(where)}) x
        WHERE ${area} AND ${cursor ? cursorAfter(cursor) : Prisma.sql`TRUE`}
        ORDER BY ${SORT_ORDER}
        LIMIT ${max + 1}`;
      const [{ count: matching }] = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS "count" FROM (${draftRows(where)}) x WHERE ${area}`;
      const before = cursor
        ? (await tx.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS "count" FROM (${draftRows(where)}) x WHERE ${area} AND ${cursorUpTo(cursor)}`)[0]!.count
        : 0;
      const facetRows = await tx.$queryRaw<FacetRow[]>`
        SELECT x."locale", x."ownType", (x."key" = 'handle') AS "handle",
               (x."issues" IS NOT NULL AND x."issues" <> '[]'::jsonb) AS "flagged", count(*)::int AS "count"
        FROM (${draftRows(scope)}) x
        GROUP BY 1, 2, 3, 4`;

      const assembled = assembleCards(rows, { budget, max, cursorCard: cursor ? cardKeyOf(cursor) : null });
      const ids = assembled.cards.flatMap((c) => c.rows.map((r) => r.id));
      const drafts = ids.length ? await tx.translationDraft.findMany({ where: { shopId, id: { in: ids } } }) : [];
      const byId = new Map(drafts.map((d) => [d.id, d]));
      return {
        facets: facetsOf(facetRows, filter),
        cards: assembled.cards
          .map((card) => ({
            key: card.key,
            continued: card.continued,
            continues: card.continues,
            // A draft removed between the two reads is left out.
            rows: card.rows.flatMap((row) => (byId.has(row.id) ? [{ ...row, draft: byId.get(row.id)! }] : [])),
          }))
          .filter((card) => card.rows.length > 0),
        matching,
        from: before + 1,
        nextCursor: assembled.nextCursor,
      };
    },
    client,
  );
}

/** The sort values of the previous page's last draft, whatever its status now (it may have been approved meanwhile); null if unknown. */
async function cursorTuple(tx: TenantTx, shopId: string, id: string): Promise<SortTuple | null> {
  const [row] = await tx.$queryRaw<SortTuple[]>`
    SELECT ${TYPE_RANK} AS "typeRank", ${ID_LEN} AS "idLen", x."cardGid", x."locale", ${FIELD_RANK} AS "fieldRank", x."resourceGid", x."key", x."id"
    FROM (${draftRows(Prisma.sql`d."shopId" = ${shopId}::uuid AND d."id" = ${id}::uuid`)}) x`;
  return row ?? null;
}

/**
 * The owners and own types of some drafts, any status, by id (Review's
 * pictures): the same look-up as the page's. RLS keeps another shop's ids
 * out; the GIDs come from the database, never from the browser.
 */
export async function draftOwners(tx: TenantTx, shopId: string, ids: readonly string[]) {
  if (!ids.length) return [];
  return tx.$queryRaw<Array<{ id: string; locale: string; resourceGid: string; key: string; owner: string | null; cardGid: string; ownType: string | null }>>`
    SELECT x."id", x."locale", x."resourceGid", x."key", x."owner", x."cardGid", x."ownType"
    FROM (${draftRows(Prisma.sql`d."shopId" = ${shopId}::uuid AND d."id" = ANY(${[...ids]}::uuid[])`)}) x`;
}

// ---------------------------------------------------------------- what the page shows

const looksLikeHtml = (text: string) => /<\/?[a-z][a-z0-9]*[\s>/]/i.test(text);

export type ReviewTextKind = "plain" | "html" | "richText" | "list" | "handle";

export interface ReviewDraft {
  id: string;
  /** The version shown (draftToken): approving or rejecting needs it unchanged. */
  token: string;
  key: string;
  /** This text's own area (the chips, and the counts the page updates itself). */
  area: AreaKey;
  group: FieldGroup;
  /** The text's own coverage type (Name vs Titel). */
  type: string | null;
  /** A custom field's name from the stored title (the live name replaces it once pictures load). */
  fieldName: string | null;
  kind: ReviewTextKind;
  source: string;
  value: string;
  /** Sanitised HTML of the original (HTML and rich text). */
  sourcePreview: string | null;
  /** Sanitised HTML of the translation (HTML and rich text), shown until the merchant edits it. */
  valuePreview: string | null;
  listType: string | null;
  issues: ReviewIssue[];
  /** A person's import (CSV), not AI. */
  fromImport: boolean;
}

export interface ReviewCard {
  /** Id of its first draft. */
  key: string;
  /** The item (its GID): the same item can have a card per language. */
  item: string;
  locale: string;
  /** Right-to-left language: texts and text areas get dir="rtl". */
  rtl: boolean;
  /** The owner's area (meta line, icon). */
  area: AreaKey;
  /** The card's type, for the "untitled" fallback in words. */
  kindWord: string | null;
  title: string | null;
  href: string | null;
  continued: boolean;
  continues: boolean;
  drafts: ReviewDraft[];
}

function draftView(row: ReviewPageRow & { draft: TranslationDraft }): ReviewDraft {
  const d = row.draft;
  const listType = d.valueType && structuredItems(d.valueType, d.value) && structuredItems(d.valueType, d.sourceValue) ? d.valueType : null;
  const richSource = listType ? null : richTextPreviewOrNull(d.sourceValue);
  const kind: ReviewTextKind = listType
    ? "list"
    : richSource !== null
      ? "richText"
      : d.key === "handle"
        ? "handle"
        : looksLikeHtml(d.sourceValue) || d.valueType === "HTML"
          ? "html"
          : "plain";
  const preview = (html: string | null) => (html === null ? null : sanitizeHtml(html));
  return {
    id: d.id,
    token: draftToken(d),
    key: d.key,
    area: areaOf(d.key, row.ownType),
    group: fieldGroupOf(d.key, row.ownType ?? ""),
    type: row.ownType,
    fieldName: customFieldName(d.resourceTitle),
    kind,
    source: d.sourceValue,
    value: d.value,
    sourcePreview: kind === "richText" ? preview(richSource) : kind === "html" ? preview(d.sourceValue) : null,
    valuePreview: kind === "richText" ? preview(richTextPreviewOrNull(d.value) ?? "") : kind === "html" ? preview(d.value) : null,
    listType,
    issues: readIssues(d.issues),
    fromImport: isHumanDraft(d.provider),
  };
}

/** The page's cards as the browser gets them. */
export function reviewCards(cards: ReviewPageResult["cards"]): ReviewCard[] {
  return cards.map((card) => {
    const first = card.rows[0]!;
    const cardGid = first.cardGid;
    const type = cardTypeOf(cardGid, card.rows);
    return {
      key: first.id,
      item: cardGid,
      locale: first.locale,
      rtl: isRtlLocale(first.locale),
      area: (type ? categoryOf(type) : null) ?? "other",
      kindWord: type,
      title: ownerTitle(
        cardGid,
        card.rows.map((r) => ({ resourceGid: r.resourceGid, parentGid: r.draft.parentGid, title: r.draft.resourceTitle })),
      ),
      href: editorPathFor(cardGid, first.locale, type),
      continued: card.continued,
      continues: card.continues,
      drafts: card.rows.map(draftView),
    };
  });
}

/**
 * Everything the page shows: the filter, the store's languages (as stored,
 * no Shopify call), the job of a job filter, the counts, the payoff for a
 * page of one language, the cards, and the languages' figures when nothing
 * waits at all.
 */
export async function loadReviewPage(shopId: string, params: URLSearchParams, client: PrismaClient = defaultClient) {
  const filter = parseReviewFilter(params);
  const locales = await storedShopLocales(shopId, client);
  // A job of another shop, or none: no job filter (and no chip).
  const job = filter.jobId
    ? await withTenant(
        shopId,
        (tx) => tx.translationJob.findFirst({ where: { shopId, id: filter.jobId! }, select: { createdAt: true, resourceType: true, targetLocale: true } }),
        client,
      )
    : null;
  if (!job) filter.jobId = null;
  const result = await searchReviewPage(shopId, filter, { targets: locales.targets }, client);
  const cards = reviewCards(result.cards);
  const size = cards.reduce((n, c) => n + c.drafts.length, 0);

  // The payoff of a page of one language, and the languages' figures when nothing waits: the language pages' own numbers.
  const single = filter.locale ?? (result.facets.languages.length === 1 ? result.facets.languages[0]!.locale : null);
  const needsCounts = single !== null || result.facets.total === 0;
  const headline = needsCounts ? headlineByLocale(await loadCounts(shopId, client)) : null;
  const payoffPercent = single && headline?.get(single) ? reviewPayoff(headline.get(single)!) : null;

  return {
    filter,
    primaryLocale: locales.primary,
    names: locales.names,
    published: Object.fromEntries((locales.targets ?? []).map((l) => [l, locales.published[l] ?? true])),
    marketCountries: peekMarketCountries(shopId),
    job: job ? { createdAt: job.createdAt.toISOString(), resourceType: job.resourceType, targetLocale: job.targetLocale } : null,
    facets: result.facets,
    payoff: single && payoffPercent !== null ? { locale: single, percent: payoffPercent } : null,
    page: {
      cards,
      size,
      matching: result.matching,
      from: size ? result.from : 0,
      to: size ? result.from + size - 1 : 0,
      nextCursor: result.nextCursor,
      isFirstPage: !filter.after,
    },
    languages:
      result.facets.total === 0 ? (locales.targets ?? []).map((locale) => ({ locale, percent: headline?.get(locale)?.percent ?? null })) : null,
  };
}

export type ReviewPageData = Awaited<ReturnType<typeof loadReviewPage>>;
