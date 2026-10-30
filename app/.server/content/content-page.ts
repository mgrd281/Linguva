/**
 * Server side of the Content page ("Inhalte", app/routes/app.content._index.tsx):
 * everything in the store Linguva can translate, in the language page's
 * areas, and how far one language is in each.
 *
 * - What the store has comes from the live probes (content-hub.ts, kept a
 *   minute per shop and granted scopes): every type is listed in exactly one
 *   place (content-areas.ts).
 * - How far a language is comes from the kept coverage counts and scan
 *   states, as on the language page: figures only for a fully counted
 *   language, never for an area with a refused or unread type.
 * - One indexed count of the stored items per type gives the "48 products"
 *   of the tiles, and tells a store whose content appeared after the last
 *   count from one with nothing to translate.
 * No merchant text leaves this module: types, counts and states only.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { loadCoverageState } from "../coverage/summary";
import { COVERAGE_TYPES } from "../coverage/coverage";
import { measurementState, scanningOf, UNDER_WAY } from "../overview/measurement";
import { loadMarketCountries, type MarketCountriesResult } from "../markets/countries";
import { MARKETS_SCOPE } from "../markets/markets";
import { shopBilling } from "../billing/billing";
import { allowedTargetLocales } from "../billing/subscription";
import { getQueues } from "../queue/client";
import { activeJobs, categoryJob } from "../jobs/active-jobs";
import { loadContentHub, requestableScopes, type HubStatus } from "../translation/content-hub";
import { itemsHref } from "../../components/Coverage";
import { countsInHeadline } from "../../lib/coverage-rules";
import { byType, headlineByLocale, measuredLocales, type Tally } from "../../lib/coverage-view";
import {
  ATTACHED,
  GROUP_PARTS,
  hasAttached,
  HUB_TYPES,
  LINKED_AREAS,
  PICTURE_AREAS,
  showsFigure,
  TILE_AREAS,
  tileState,
  type AttachedPart,
  type GroupId,
  type GroupPart,
  type HubType,
  type TileState,
} from "../../lib/content-areas";
import { chooseLanguage } from "../../lib/content-language";
import { localeCountry } from "../../lib/flags";
import { CATEGORIES, categoryOf, categoryPath, categoryState, categoryTallies, EXTRAS, tierOf, type CategoryId, type TierId } from "../../lib/language-categories";
import { kindMeta } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;
type ShopRef = { id: string; shopifyShopGid: string | null };

export interface ContentPageInput {
  /** The optional scopes the store granted (scopes.query()). */
  granted: readonly string[];
  /** The URL's ?lang and ?open (view choices: anything else is ignored). */
  lang: string | null;
  open: string | null;
}

export interface ContentPageOptions {
  /** Tests only: the time the cache and the measurement state are judged at. */
  now?: number;
  /** Background jobs can run here (Redis configured): counting can be offered. */
  jobsAvailable?: boolean;
}

export interface ContentArea {
  id: CategoryId;
  tier: TierId;
  /** The area's list in the chosen language (null without a language). */
  href: string | null;
  /** Things its texts belong to ("48 products"; null for an area of several kinds, or before any count). */
  items: number | null;
  /** Its types with counted texts (detailLine names subscriptions only when they have some). */
  textTypes: string[];
  /** Its texts by state in the chosen language: only in the states that show a figure. */
  tally: Tally | null;
  state: TileState;
  /** Types refused live: the card above unlocks the first, nothing unlocks the second. */
  locked: HubType[];
  unavailable: HubType[];
  /** A translation of its types into the chosen language runs now. */
  translating: boolean;
  /** Image descriptions and custom fields with texts: translated with this area's items. */
  attached: AttachedPart[];
  /** Pictures of its items can be shown (products, collections and blog posts of a counted language). */
  pictures: boolean;
}

export interface ContentGroup {
  tally: Tally | null;
  state: TileState;
  locked: HubType[];
  unavailable: HubType[];
  /**
   * Its types in the store, each with its list and figure (a group refused
   * in part still lists the parts Linguva may read: they have no other place).
   */
  parts: Array<{ type: GroupPart; href: string | null; tally: Tally | null }>;
}

/** Items the last count stored per type in one language: all of them, and those with texts to translate. */
export async function contentItemCounts(shopId: string, locale: string, client: PrismaClient = defaultClient): Promise<Map<string, { all: number; texts: number }>> {
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<Array<{ resourceType: string; all: number; texts: number }>>`
        SELECT "resourceType", count(*)::integer AS "all",
          count(*) FILTER (WHERE cardinality("sourceKeys") > 0)::integer AS "texts"
        FROM "CoverageItem"
        WHERE "shopId" = ${shopId}::uuid AND "locale" = ${locale}
        GROUP BY "resourceType"`,
    client,
  );
  return new Map(rows.map((r) => [r.resourceType, { all: r.all, texts: r.texts }]));
}

/** Every country the store sells to (active markets), for the chips' flags; none without markets. */
function marketCountriesOf(markets: MarketCountriesResult): string[] {
  if (!markets.access || "error" in markets) return [];
  return [...new Set(markets.markets.filter((m) => m.status === "ACTIVE").flatMap((m) => m.countries.map((c) => c.code.toUpperCase())))];
}

/**
 * The Content page: the store's languages and the one shown, every type in
 * its one place, each area's tile and the theme's and notifications' parts
 * in that language, what needs a permission, and what to count.
 */
export async function loadContentPage(admin: Admin, shop: ShopRef, input: ContentPageInput, client: PrismaClient = defaultClient, options: ContentPageOptions = {}) {
  const now = options.now ?? Date.now();
  const jobsAvailable = options.jobsAvailable ?? getQueues() !== null;
  const granted = input.granted;
  const [locales, entries, state, billing, markets] = await Promise.all([
    fetchAndSyncShopLocales(admin, shop.id, client),
    loadContentHub(admin, granted, { shopId: shop.id, now }),
    loadCoverageState(shop.id, client),
    shopBilling(admin, shop),
    loadMarketCountries(shop.id, admin, async () => granted.includes(MARKETS_SCOPE), now),
  ]);

  const targets = locales.locales.filter((l) => !l.primary);
  const measuredSet = measuredLocales(state.lastCompleted, state.segments, COVERAGE_TYPES);
  const headline = headlineByLocale(state.counts);
  const allowed = allowedTargetLocales(billing.entitlements, targets.map((l) => l.locale));
  const open = new Map([...headline].map(([locale, t]) => [locale, t.counts.missing + t.counts.outdated + t.counts.failed]));
  const locale = chooseLanguage({ requested: input.lang, targets, allowed, measured: measuredSet, open });
  const chosen = locale === null ? null : targets.find((l) => l.locale === locale)!;
  const measurement = measurementState(state.report, { jobsAvailable, now });
  const measured = locale !== null && measuredSet.has(locale);
  const scanning = locale !== null && scanningOf(state.report, measurement, locale);
  // Item counts are store facts (every language has the same items): from a counted language when this one isn't.
  const itemLocale = measured ? locale : (targets.find((l) => measuredSet.has(l.locale))?.locale ?? null);
  const [jobs, items] = await Promise.all([
    locale === null ? [] : activeJobs(shop.id, locale, client),
    itemLocale === null ? null : contentItemCounts(shop.id, itemLocale, client),
  ]);

  const status = new Map<string, HubStatus>(entries.map((e) => [e.type, e.status]));
  const statusOf = (type: string): HubStatus => status.get(type) ?? "unknown";
  const tallies = locale === null ? null : categoryTallies(state.counts, locale);
  const perType = locale === null ? null : byType(state.counts, locale);
  const segmentOf = (area: CategoryId | GroupId) => (locale === null ? ({ kind: "ok" } as const) : categoryState(state.segments, locale, area, { scanning }));
  const itemsOf = (types: readonly string[], key: "all" | "texts") => (items ? types.reduce((n, type) => n + (items.get(type)?.[key] ?? 0), 0) : 0);
  /** Types with texts in the counts, in any language (the tiles' notes). */
  const withTexts = new Set(state.counts.filter((r) => r.count > 0).map((r) => r.resourceType));
  const hubTypesOf = (area: CategoryId | GroupId) => HUB_TYPES.filter((type) => categoryOf(type) === area);

  /** A tile's or a group's state, with the types it refuses. */
  const stateOf = (area: CategoryId | GroupId, total: number) => {
    const types = hubTypesOf(area);
    const locked = types.filter((type) => statusOf(type) === "needs-permission");
    const unavailable = types.filter((type) => statusOf(type) === "unavailable");
    const live = types.some((type) => statusOf(type) === "has-content");
    const kind = tileState({
      locked,
      unavailable,
      segment: segmentOf(area),
      measured,
      scanning,
      total,
      itemsAll: itemsOf(area === "theme" || area === "notifications" ? EXTRAS[area].types : CATEGORIES[area].types, "all"),
      live,
    });
    return { kind, locked, unavailable, live };
  };

  const areas: ContentArea[] = TILE_AREAS.flatMap((id): ContentArea[] => {
    const tally = tallies?.[id] ?? null;
    const { kind, locked, unavailable, live } = stateOf(id, tally?.total ?? 0);
    // An area is shown when the store has some of its content now.
    if (!live) return [];
    const itemTypes = CATEGORIES[id].itemTypes as readonly string[];
    const textTypes = itemLocale
      ? (CATEGORIES[id].types as readonly string[]).filter((type) =>
          state.counts.some((r) => r.locale === itemLocale && r.resourceType === type && countsInHeadline(type, r.fieldGroup) && r.count > 0),
        )
      : [];
    const attached = hasAttached(id) ? (["images", "customFields"] as const).filter((part) => ATTACHED[id][part].some((type: string) => withTexts.has(type))) : [];
    return [
      {
        id,
        tier: tierOf(id),
        href: locale === null ? null : categoryPath(locale, id),
        items: itemTypes.length && items ? itemsOf(itemTypes, "texts") : null,
        textTypes,
        tally: locale !== null && showsFigure(kind) ? tally : null,
        state: kind,
        locked,
        unavailable,
        translating: locale !== null && categoryJob(jobs, id) !== null,
        attached: [...attached],
        pictures: measured && PICTURE_AREAS.has(id),
      },
    ];
  });

  const group = (id: GroupId): ContentGroup | null => {
    const tally = tallies?.[id] ?? null;
    const { kind, locked, unavailable, live } = stateOf(id, tally?.total ?? 0);
    // Shown when the store has some of it, or it is refused (the card or nobody can unlock it).
    if (!live && !locked.length && !unavailable.length) return null;
    const figure = locale !== null && showsFigure(kind);
    return {
      tally: figure ? tally : null,
      state: kind,
      locked,
      unavailable,
      // Every part in the store, also while another part is refused (the parts' one place is here).
      parts: (GROUP_PARTS[id] as readonly GroupPart[])
        .filter((type) => statusOf(type) === "has-content")
        .map((type) => ({
          type,
          href: locale === null ? null : `${kindMeta(type).path}?lang=${encodeURIComponent(locale)}`,
          tally: figure ? (perType?.get(type) ?? null) : null,
        })),
    };
  };

  // URL handles: once counted when the language has some; before, when an area with web addresses shows.
  const urls =
    locale === null || !tallies
      ? null
      : measured
        ? tallies.urls.total > 0
          ? { tally: tallies.urls, href: itemsHref({ lang: locale, group: "url" }) }
          : null
        : areas.some((a) => LINKED_AREAS.has(a.id))
          ? { tally: null, href: itemsHref({ lang: locale, group: "url" }) }
          : null;

  const needs = HUB_TYPES.filter((type) => statusOf(type) === "needs-permission");
  const scopeOf = new Map(entries.map((e) => [e.type, e.scope]));
  const denied = new Set(locale === null ? [] : state.segments.filter((s) => s.locale === locale && s.status === "DENIED").map((s) => s.resourceType));
  const marketCountries = marketCountriesOf(markets);
  const openParam = input.open === "theme" || input.open === "notifications" ? input.open : null;

  return {
    /** The store's additional languages in the app's order (the page sorts them for reading). */
    languages: targets.map((l) => {
      const figure = measuredSet.has(l.locale) ? headline.get(l.locale) : undefined;
      return {
        locale: l.locale,
        name: l.name,
        published: l.published,
        country: localeCountry(l.locale, marketCountries),
        measured: measuredSet.has(l.locale),
        complete: figure?.complete ?? 0,
        total: figure?.total ?? 0,
      };
    }),
    /** The language shown (null: the store has no additional language). */
    language: chosen ? { locale: chosen.locale, name: chosen.name, published: chosen.published } : null,
    /** The plan includes the language: the AI translates into it (editor, bulk, automatic, smart schedule). */
    planIncludes: locale !== null && allowed.includes(locale),
    /** Types refused at the last count that Linguva may read now: counting again adds them. */
    recount: HUB_TYPES.filter((type) => denied.has(type) && (statusOf(type) === "has-content" || statusOf(type) === "empty")),
    measuredAt: state.lastCompleted?.finishedAt ?? null,
    measured,
    scanning,
    measurement: { state: measurement.state, done: measurement.done, total: measurement.total },
    /** Counting can start (background jobs run here and no count is under way). */
    canCount: jobsAvailable && !UNDER_WAY.has(measurement.state),
    areas,
    extras: { theme: group("theme"), notifications: group("notifications"), urls },
    /** The missing permissions, in the allow-list's order, each with the types it unlocks. */
    access: requestableScopes()
      .filter((scope) => needs.some((type) => scopeOf.get(type) === scope))
      .map((scope) => ({ scope, types: needs.filter((type) => scopeOf.get(type) === scope) })),
    empty: HUB_TYPES.filter((type) => statusOf(type) === "empty"),
    unavailable: HUB_TYPES.filter((type) => statusOf(type) === "unavailable"),
    unknown: HUB_TYPES.filter((type) => statusOf(type) === "unknown"),
    /**
     * The store has nothing to translate at all: every type was checked and
     * is in a fold (none in a tile, the permission card or the "couldn't
     * check" banner, where content may be hiding).
     */
    nothing: HUB_TYPES.every((type) => statusOf(type) === "empty" || statusOf(type) === "unavailable"),
    open: openParam,
    /** One key per page view: a repeated "Count now" starts nothing twice. */
    idempotencyKey: randomUUID(),
  };
}

export type ContentPage = Awaited<ReturnType<typeof loadContentPage>>;
