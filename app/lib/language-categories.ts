/**
 * A language's content in areas a merchant recognises, for the language page
 * and its lists. Pure, shared by server and UI; tested in
 * tests/unit/language-categories.test.ts.
 *
 * - Ten categories in three tiers, in the order customers meet them: what
 *   they see first, what they read before buying, and what brings visitors.
 *   Every type the coverage scan reads belongs to exactly one category or
 *   extra, and the categories count exactly the texts the language's
 *   percentage counts (headlineByLocale), so their figures add up to it.
 * - Three extras the percentage leaves out (coverage-rules.ts): the theme's
 *   texts, notification templates and the URL handles of every type.
 * - What a category's scan state is, what to do next in a language, and the
 *   one state of an item in a list.
 * - Image descriptions and custom fields go with their owners (ATTACHED): a
 *   translation of products can include them, so they get no step of their
 *   own while their owner has one.
 */
import type { Tint } from "../components/IconSquare";
import {
  coveragePercent,
  emptyCounts,
  FIELD_GROUPS,
  HEADLINE_EXCLUDED_GROUPS,
  HEADLINE_EXCLUDED_TYPES,
  isFieldGroup,
  isFieldState,
  type FieldGroup,
  type FieldState,
  type StateCounts,
} from "./coverage-rules";
import { tally, type CountInput, type Tally } from "./coverage-view";
import type { IconName } from "./icons";
import { CONTENT_TYPES, isContentType, RESOURCE_KINDS } from "./resource-kinds";

/** The tiers and their categories, in display order. Ids are URL slugs. */
export const TIERS = [
  { id: "first", categories: ["products", "collections", "navigation", "options"] },
  { id: "beforeBuying", categories: ["checkout", "customFields", "metaobjects"] },
  { id: "content", categories: ["pages", "blog", "images"] },
] as const;

export type TierId = (typeof TIERS)[number]["id"];
export type CategoryId = (typeof TIERS)[number]["categories"][number];

export const CATEGORY_IDS: readonly CategoryId[] = TIERS.flatMap((tier) => tier.categories);

const TIER_INDEX = new Map<CategoryId, number>(TIERS.flatMap((tier, index) => tier.categories.map((id) => [id, index] as const)));

/**
 * Per category: `types`, the coverage types of its texts; `itemTypes`, the
 * types of the things its item count names ("48 products"; none where its
 * texts belong to things of many kinds); `icon`, its Polaris icon (Shopify's
 * own for the place); `tint`, the colour of its icon square (a place, never
 * a state: no two areas of a tier share one, and image descriptions and
 * extra details take their products' blue).
 */
export const CATEGORIES = {
  products: { types: ["PRODUCT"], itemTypes: ["PRODUCT"], icon: "product", tint: "blue" },
  collections: { types: ["COLLECTION"], itemTypes: ["COLLECTION"], icon: "collection", tint: "violet" },
  navigation: { types: ["MENU", "LINK", "FILTER"], itemTypes: [], icon: "menu", tint: "slate" },
  options: { types: ["PRODUCT_OPTION", "PRODUCT_OPTION_VALUE"], itemTypes: [], icon: "variant", tint: "amber" },
  checkout: {
    types: ["SHOP", "SHOP_POLICY", "DELIVERY_METHOD_DEFINITION", "PAYMENT_GATEWAY", "SELLING_PLAN_GROUP", "SELLING_PLAN"],
    itemTypes: [],
    icon: "cart",
    tint: "green",
  },
  customFields: { types: ["PRODUCT_METAFIELD", "COLLECTION_METAFIELD", "PAGE_METAFIELD", "ARTICLE_METAFIELD"], itemTypes: [], icon: "metafields", tint: "blue" },
  metaobjects: { types: ["METAOBJECT"], itemTypes: ["METAOBJECT"], icon: "metaobject", tint: "rose" },
  pages: { types: ["PAGE"], itemTypes: ["PAGE"], icon: "page", tint: "teal" },
  blog: { types: ["BLOG", "ARTICLE"], itemTypes: ["ARTICLE"], icon: "blog", tint: "amber" },
  images: { types: ["MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE"], itemTypes: ["MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE"], icon: "image-alt", tint: "blue" },
} as const satisfies Record<CategoryId, { types: readonly string[]; itemTypes: readonly string[]; icon: IconName; tint: Tint }>;

/** Image descriptions and custom fields: translated with the things they belong to (ATTACHED). */
export type AttachedPart = "images" | "customFields";

export function isAttachedPart(id: string): id is AttachedPart {
  return id === "images" || id === "customFields";
}

/**
 * Per owner area, the coverage types of its image descriptions and custom
 * fields: a bulk job of the owner with "Also translate image descriptions
 * and extra details" (includeAttached) translates them with its items.
 */
export const ATTACHED = {
  products: { images: ["MEDIA_IMAGE"], customFields: ["PRODUCT_METAFIELD"] },
  collections: { images: ["COLLECTION_IMAGE"], customFields: ["COLLECTION_METAFIELD"] },
  pages: { images: [], customFields: ["PAGE_METAFIELD"] },
  blog: { images: ["ARTICLE_IMAGE"], customFields: ["ARTICLE_METAFIELD"] },
} as const satisfies Partial<Record<CategoryId, Record<AttachedPart, readonly string[]>>>;

export type AttachedArea = keyof typeof ATTACHED;

/** The owner areas, in the areas' order. */
export const ATTACHED_AREAS = Object.keys(ATTACHED) as AttachedArea[];

export function hasAttached(area: CategoryId): area is AttachedArea {
  return Object.hasOwn(ATTACHED, area);
}

/** Open texts of image descriptions and of extra details. */
export type AttachedOpen = Record<AttachedPart, number>;

const OWNER_OF = new Map<string, readonly [AttachedArea, AttachedPart]>(
  ATTACHED_AREAS.flatMap((area) => (["images", "customFields"] as const).flatMap((part) => (ATTACHED[area][part] as readonly string[]).map((type) => [type, [area, part] as const] as const))),
);

/**
 * Per owner area, the texts to translate (missing, outdated, failed) of its
 * image descriptions and extra details in a language: what translating the
 * owner with them would also do. URL handles never count.
 */
export function attachedOpen(rows: readonly CountInput[], locale: string): Record<AttachedArea, AttachedOpen> {
  const open = Object.fromEntries(ATTACHED_AREAS.map((area) => [area, { images: 0, customFields: 0 }])) as Record<AttachedArea, AttachedOpen>;
  for (const row of rows) {
    if (row.locale !== locale || (HEADLINE_EXCLUDED_GROUPS as readonly string[]).includes(row.fieldGroup)) continue;
    if (row.state !== "missing" && row.state !== "outdated" && row.state !== "failed") continue;
    const owner = OWNER_OF.get(row.resourceType);
    if (owner) open[owner[0]][owner[1]] += row.count;
  }
  return open;
}

/** Areas the language's percentage leaves out, shown last ("not in the N %"). */
export const EXTRA_IDS = ["theme", "notifications", "urls"] as const;
export type ExtraId = (typeof EXTRA_IDS)[number];
export type AreaId = CategoryId | ExtraId;

const excludedTypes = (reason: "theme" | "notifications") =>
  Object.keys(HEADLINE_EXCLUDED_TYPES).filter((type) => HEADLINE_EXCLUDED_TYPES[type] === reason);

/** Per extra: `types` as for categories (URL handles are a field group of every type instead), and its icon. */
export const EXTRAS = {
  theme: { types: excludedTypes("theme"), icon: "theme" },
  notifications: { types: excludedTypes("notifications"), icon: "email" },
  urls: { types: [], icon: "link" },
} as const satisfies Record<ExtraId, { types: readonly string[]; icon: string }>;

const typesOf = (area: CategoryId | "theme" | "notifications"): readonly string[] =>
  area === "theme" || area === "notifications" ? EXTRAS[area].types : CATEGORIES[area].types;

const AREA_OF_TYPE = new Map<string, CategoryId | "theme" | "notifications">(
  ([...CATEGORY_IDS, "theme", "notifications"] as const).flatMap((area) => typesOf(area).map((type) => [type, area] as const)),
);

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}

export function tierOf(category: CategoryId): TierId {
  return TIERS[TIER_INDEX.get(category)!]!.id;
}

/** A coverage type's category (or extra, for theme and notification types); null for a type coverage doesn't read. */
export function categoryOf(resourceType: string): CategoryId | "theme" | "notifications" | null {
  return AREA_OF_TYPE.get(resourceType) ?? null;
}

/**
 * The category's types bulk jobs translate (SUPPORTED_BULK_RESOURCE_TYPES):
 * none for policies (legal texts, one by one), image alt text or custom
 * fields (a job for them would translate their owners), so images and
 * custom fields can only be viewed, and Shop & checkout leaves policies out.
 */
export function bulkTypesOf(category: CategoryId): string[] {
  return typesOf(category).filter((type) => Object.hasOwn(RESOURCE_KINDS, type) || (isContentType(type) && CONTENT_TYPES[type].bulk));
}

/**
 * The language's fields by state per category and extra. A category counts
 * a row exactly when the percentage does (countsInHeadline: a counted type,
 * not a URL handle), so the categories add up to headlineByLocale; URL
 * handles of every type are the "urls" extra, theme and notification types
 * their own.
 */
export function categoryTallies(rows: readonly CountInput[], locale: string): Record<AreaId, Tally> {
  const sums = new Map<AreaId, StateCounts>([...CATEGORY_IDS, ...EXTRA_IDS].map((id) => [id, emptyCounts()]));
  for (const row of rows) {
    if (row.locale !== locale) continue;
    const area = (HEADLINE_EXCLUDED_GROUPS as readonly string[]).includes(row.fieldGroup) ? "urls" : categoryOf(row.resourceType);
    if (area) sums.get(area)![row.state] += row.count;
  }
  return Object.fromEntries([...sums].map(([id, counts]) => [id, tally(counts)])) as Record<AreaId, Tally>;
}

/** The three steps of a translation, in texts: to translate (missing, outdated, failed), waiting for approval, live. */
export function stepCounts(counts: StateCounts) {
  return { open: counts.missing + counts.outdated + counts.failed, waiting: counts.draft + counts.review, live: counts.complete };
}

/** The percentage once every waiting draft is approved, rounded down like the percentage itself (null: nothing counted). */
export function payoffPercent(figure: Pick<Tally, "counts" | "total">): number | null {
  return coveragePercent(figure.counts.complete + figure.counts.draft + figure.counts.review, figure.total);
}

/** payoffPercent where it is worth saying: drafts wait, and approving them gains at least one point. */
export function reviewPayoff(figure: Tally): number | null {
  const payoff = payoffPercent(figure);
  return stepCounts(figure.counts).waiting > 0 && payoff !== null && payoff >= (figure.percent ?? 0) + 1 ? payoff : null;
}

export type CategoryState =
  | { kind: "ok" }
  /** A measurement under way is reading it. */
  | { kind: "counting" }
  /** Not fully read: skipped after errors, left by a measurement that stopped, or not read yet. Count again. */
  | { kind: "incomplete" }
  /**
   * Linguva may not read these types: never counted. `href`: the Content page's permission card, which
   * asks Shopify for every missing permission at once (null when none of them has one to ask for).
   */
  | { kind: "no-access"; types: string[]; href: string | null };

/** The Content page's card that asks for every missing permission at once, in a language. */
export function contentAccessPath(locale: string): string {
  return `/app/content?lang=${encodeURIComponent(locale)}#content-access`;
}

/**
 * A category's (or the theme's or notifications') scan state in a language,
 * from the CoverageSegment rows of its types. `scanning`: a measurement
 * under way reads this language; it will read the types it hasn't reached
 * (no row yet, or `ahead`), but not those it skipped.
 */
export function categoryState(
  segments: ReadonlyArray<{ locale: string; resourceType: string; status: string; ahead?: boolean }>,
  locale: string,
  area: CategoryId | "theme" | "notifications",
  options: { scanning: boolean },
): CategoryState {
  const types = typesOf(area);
  const rows = new Map(segments.filter((s) => s.locale === locale && types.includes(s.resourceType)).map((s) => [s.resourceType, s]));
  const denied = types.filter((type) => rows.get(type)?.status === "DENIED");
  if (denied.length) {
    // Only a permission the merchant can give leads anywhere: one Shopify screen for all of them.
    const permission = denied.some((type) => isContentType(type) && CONTENT_TYPES[type].scope !== null);
    return { kind: "no-access", types: denied, href: permission ? contentAccessPath(locale) : null };
  }
  const unread = types.filter((type) => rows.get(type)?.status !== "SCANNED");
  if (!unread.length) return { kind: "ok" };
  const reading = (type: string) => {
    const row = rows.get(type);
    return !row || row.status === "SCANNING" || Boolean(row.ahead);
  };
  return options.scanning && unread.every(reading) ? { kind: "counting" } : { kind: "incomplete" };
}

/**
 * Why translating in bulk can't start, where the merchant can change it: the
 * AI permission (or a translation service it doesn't cover), the own key, the
 * plan or the plan's languages. The app's own setup (background jobs, the
 * operator's AI) isn't one: nothing on these pages fixes it.
 */
export const UNLOCK_GATES = ["CONSENT_REQUIRED", "ENGINE_CONSENT", "OWN_KEY_MISSING", "OWN_KEY_REFUSED", "PLAN_BULK", "PLAN_LANGUAGE"] as const;
export type UnlockGate = (typeof UNLOCK_GATES)[number];

export function isUnlockGate(code: string | null | undefined): code is UnlockGate {
  return (UNLOCK_GATES as readonly string[]).includes(code ?? "");
}

/** Where a gate is lifted: the AI permission or the keys in Settings, or the Plan page. */
export function unlockHref(gate: UnlockGate): string {
  if (gate === "CONSENT_REQUIRED" || gate === "ENGINE_CONSENT") return "/app/settings?section=ai";
  if (gate === "OWN_KEY_MISSING" || gate === "OWN_KEY_REFUSED") return "/app/settings?section=keys";
  return "/app/plan";
}

export type LanguageStep =
  /** The language isn't counted yet: count the store. */
  | { kind: "count" }
  /** Drafts wait for approval; `payoff`: the percentage once approved (reviewPayoff). */
  | { kind: "review"; count: number; payoff: number | null; href: string }
  /** Translating can't start until the merchant lifts this (the AI permission, a key, the plan): its fix. */
  | { kind: "unlock"; gate: UnlockGate; href: string }
  /**
   * A category has texts to translate: translate them in bulk (after confirming), or open its list when bulk
   * isn't possible. `attached`: its items' image descriptions and extra details that also wait, translated
   * with them (none for image descriptions and extra details themselves).
   */
  | { kind: "category"; category: CategoryId; missing: number; outdated: number; failed: number; attached: AttachedOpen; action: "translate" | "view"; href: string }
  /** These categories weren't fully read: count the store again. */
  | { kind: "recount"; categories: CategoryId[] }
  /** Linguva may not read these categories: allow access (`href`: the Content page's permission card). */
  | { kind: "access"; categories: CategoryId[]; href: string | null }
  /** Everything was read, and every counted text is translated and live. */
  | { kind: "done" };

const MAX_STEPS = 3;
const NO_ATTACHED: AttachedOpen = { images: 0, customFields: 0 };

export interface LanguageStepsInput {
  locale: string;
  /** Fully measured (measuredLocales); otherwise the only step is to count. */
  measured: boolean;
  /** A measurement can start now (background jobs available, none under way). */
  canCount: boolean;
  /** The language's figure (headlineByLocale). */
  headline: Tally;
  /**
   * Every category, those without texts too: its figure (categoryTallies),
   * its state (categoryState), and `bulk`: translating can start jobs for it
   * now (bulk types with open texts, and plan, consent, provider and queue
   * allow it); for an owner of image descriptions and extra details,
   * `attached`: theirs that wait (attachedOpen).
   */
  categories: ReadonlyArray<{ id: CategoryId; tally: Tally; state: CategoryState; bulk: boolean; attached?: AttachedOpen }>;
  /** A measurement is under way: types it hasn't reached yet still show their last read, so never "done". */
  scanning?: boolean;
  /** Translating in bulk waits for the merchant (an UnlockGate) while there is something to translate: its fix comes next. */
  unlock?: UnlockGate | null;
}

/**
 * Up to three next steps for a language. Approving comes first: drafts are
 * done work, only waiting to go live. Then what keeps translating from
 * starting, where the merchant can lift it. Then the categories with texts
 * to translate, the first tier first and within a tier the most open texts
 * first; image descriptions and extra details go with their owner's step
 * (a step of their own only for those whose owner has nothing else to
 * translate). Then content that wasn't read, never "done" over it. The
 * first step's action is the page's one primary button.
 */
export function nextSteps(input: LanguageStepsInput): LanguageStep[] {
  if (!input.measured) return input.canCount ? [{ kind: "count" }] : [];
  const steps: LanguageStep[] = [];
  const waiting = stepCounts(input.headline.counts).waiting;
  if (waiting > 0) {
    steps.push({ kind: "review", count: waiting, payoff: reviewPayoff(input.headline), href: `/app/review?lang=${encodeURIComponent(input.locale)}` });
  }
  if (input.unlock) steps.push({ kind: "unlock", gate: input.unlock, href: unlockHref(input.unlock) });
  const order = (id: CategoryId) => CATEGORY_IDS.indexOf(id);
  const inOrder = [...input.categories].sort((a, b) => order(a.id) - order(b.id));
  const own = (c: (typeof inOrder)[number]) => stepCounts(c.tally.counts).open;
  const attachedOf = (c: (typeof inOrder)[number]) => (isAttachedPart(c.id) ? NO_ATTACHED : (c.attached ?? NO_ATTACHED));
  // Image descriptions and extra details whose owner has a step of its own go with it.
  const covered = { images: 0, customFields: 0 };
  for (const c of inOrder) {
    if (isAttachedPart(c.id) || own(c) === 0) continue;
    covered.images += attachedOf(c).images;
    covered.customFields += attachedOf(c).customFields;
  }
  const open = inOrder
    .filter((c) => (isAttachedPart(c.id) ? own(c) > covered[c.id] : own(c) > 0))
    .map((c) => ({ ...c, work: own(c) + attachedOf(c).images + attachedOf(c).customFields }))
    .sort((a, b) => TIER_INDEX.get(a.id)! - TIER_INDEX.get(b.id)! || b.work - a.work || order(a.id) - order(b.id));
  for (const c of open.slice(0, Math.max(0, MAX_STEPS - steps.length))) {
    steps.push({
      kind: "category",
      category: c.id,
      missing: c.tally.counts.missing,
      outdated: c.tally.counts.outdated,
      failed: c.tally.counts.failed,
      attached: attachedOf(c),
      action: c.bulk ? "translate" : "view",
      href: categoryPath(input.locale, c.id),
    });
  }
  const incomplete = inOrder.filter((c) => c.state.kind === "incomplete").map((c) => c.id);
  if (steps.length < MAX_STEPS && incomplete.length && input.canCount) steps.push({ kind: "recount", categories: incomplete });
  const denied = inOrder.flatMap((c) => (c.state.kind === "no-access" ? [{ id: c.id, href: c.state.href }] : []));
  if (steps.length < MAX_STEPS && denied.length) {
    steps.push({ kind: "access", categories: denied.map((c) => c.id), href: denied.find((c) => c.href)?.href ?? null });
  }
  if (steps.length) return steps;
  const settled = !input.scanning && input.categories.every((c) => c.state.kind === "ok");
  return settled && input.headline.total > 0 && input.headline.complete >= input.headline.total ? [{ kind: "done" }] : [];
}

/**
 * The one state of an item in a list, by rank: failed, outdated, missing,
 * waiting for approval (draft or review), complete. Open work comes first,
 * and every item is in exactly one group, so the groups add up.
 */
export const ITEM_STATES = ["failed", "outdated", "missing", "waiting", "complete"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** A field's state as items show it: drafts with and without quality notes both wait for approval. */
export const ITEM_STATE_OF: Readonly<Record<FieldState, ItemState>> = {
  complete: "complete",
  review: "waiting",
  draft: "waiting",
  failed: "failed",
  outdated: "outdated",
  missing: "missing",
};

const worse = (a: ItemState, b: ItemState) => (ITEM_STATES.indexOf(a) <= ITEM_STATES.indexOf(b) ? a : b);

/**
 * Per text of an item (field group, in FIELD_GROUPS order) its state, the
 * worst of the group's fields, from CoverageItem.fieldStates ("group:state").
 * URL handles are left out, as the percentage leaves them out.
 */
export function textStates(fieldStates: readonly string[]): Array<{ group: FieldGroup; state: ItemState }> {
  const byGroup = new Map<FieldGroup, ItemState>();
  for (const entry of fieldStates) {
    const at = entry.indexOf(":");
    const group = entry.slice(0, at);
    const state = entry.slice(at + 1);
    if (!isFieldGroup(group) || !isFieldState(state) || (HEADLINE_EXCLUDED_GROUPS as readonly string[]).includes(group)) continue;
    const current = byGroup.get(group);
    byGroup.set(group, current ? worse(current, ITEM_STATE_OF[state]) : ITEM_STATE_OF[state]);
  }
  return FIELD_GROUPS.filter((group) => byGroup.has(group)).map((group) => ({ group, state: byGroup.get(group)! }));
}

/** An item's one state: the worst of its texts; null when nothing but its URL handle is counted. */
export function itemState(fieldStates: readonly string[]): ItemState | null {
  return textStates(fieldStates).reduce<ItemState | null>((state, text) => (state ? worse(state, text.state) : text.state), null);
}

/** The language page (app/routes/app.languages_.$locale.tsx). */
export function languagePath(locale: string): string {
  return `/app/languages/${encodeURIComponent(locale)}`;
}

/** A category's list in a language (app/routes/app.languages_.$locale_.$category.tsx). */
export function categoryPath(locale: string, category: CategoryId): string {
  return `${languagePath(locale)}/${category}`;
}

/**
 * Where a language's page or an area's list was opened from: Content
 * ("Inhalte") gives it the trail "Inhalte › Deutsch › Produkte", so the way
 * back leads where the merchant came from; anything else the Overview's.
 * A view choice of the address (`?from=content`), nothing more.
 */
export type Origin = "content" | null;

export function originOf(value: string | null | undefined): Origin {
  return value === "content" ? "content" : null;
}

/** An address on the language pages that keeps where the merchant came from. */
export function withOrigin(href: string, origin: Origin): string {
  if (!origin) return href;
  const at = href.indexOf("#");
  const [path, hash] = at < 0 ? [href, ""] : [href.slice(0, at), href.slice(at)];
  return `${path}${path.includes("?") ? "&" : "?"}from=${origin}${hash}`;
}
