/**
 * How translation coverage is counted (shared by the scan, the sync after
 * every write and the dashboard). Pure functions, tested in
 * tests/unit/coverage-rules.test.ts; the rules are explained to merchants on
 * the coverage page and in docs/COVERAGE_RULES.md.
 *
 * - A field counts only when its original has text: an empty original has
 *   nothing to translate and is left out (never "missing").
 * - Each field has exactly one state, by priority: complete (a current
 *   translation is live in Shopify) → needs review (an AI draft with quality
 *   notes waits) → draft (an AI draft waits) → failed (the last automatic
 *   attempt failed) → outdated (a translation exists but the original
 *   changed since) → missing.
 * - Drafts are never complete: customers don't see them until approved.
 * - A percentage is complete ÷ counted fields, rounded down, so 100 % means
 *   everything; with nothing to count there is no percentage (null), not 100 %.
 */

export const FIELD_STATES = ["complete", "review", "draft", "failed", "outdated", "missing"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

export function isFieldState(value: string): value is FieldState {
  return (FIELD_STATES as readonly string[]).includes(value);
}

/** Field groups shown across content types (titles of all products, SEO titles, …). */
export const FIELD_GROUPS = ["title", "description", "seo_title", "seo_description", "url", "alt", "value", "other"] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];

export function isFieldGroup(value: string): value is FieldGroup {
  return (FIELD_GROUPS as readonly string[]).includes(value);
}

const GROUP_BY_KEY: Record<string, FieldGroup> = {
  title: "title",
  name: "title",
  label: "title",
  body_html: "description",
  body: "description",
  summary_html: "description",
  description: "description",
  meta_title: "seo_title",
  meta_description: "seo_description",
  handle: "url",
  alt: "alt",
};

/** Custom fields are counted per owner type: PRODUCT_METAFIELD, COLLECTION_METAFIELD, … */
export function isMetafieldCoverageType(resourceType: string): boolean {
  return resourceType.endsWith("_METAFIELD");
}

/** The group of a Shopify translatable content key. Custom field values are "value". */
export function fieldGroupOf(key: string, resourceType: string): FieldGroup {
  if (isMetafieldCoverageType(resourceType)) return "value";
  return GROUP_BY_KEY[key] ?? "other";
}

/**
 * The state of one field whose original has text. `current`: a translation
 * that isn't outdated is live; `outdated`: a translation exists but its
 * original changed; `draft`/`review`: a pending AI draft (with quality notes
 * for review); `failed`: the item's last translation attempt failed.
 */
export function fieldState(input: {
  current: boolean;
  outdated: boolean;
  draft: boolean;
  review: boolean;
  failed: boolean;
}): FieldState {
  if (input.current) return "complete";
  if (input.review) return "review";
  if (input.draft) return "draft";
  if (input.failed) return "failed";
  if (input.outdated) return "outdated";
  return "missing";
}

/**
 * Content types left out of the headline percentage, and why. They are still
 * counted and shown on their own rows, marked "not in the total".
 * - Theme content: thousands of texts that come with the theme (and its
 *   apps), most never shown in a typical store; they would drown the
 *   catalog's figure.
 * - Notification templates: Liquid code, translated one by one with care.
 */
export const HEADLINE_EXCLUDED_TYPES: Readonly<Record<string, "theme" | "notifications">> = {
  ONLINE_STORE_THEME: "theme",
  ONLINE_STORE_THEME_LOCALE_CONTENT: "theme",
  ONLINE_STORE_THEME_JSON_TEMPLATE: "theme",
  ONLINE_STORE_THEME_SECTION_GROUP: "theme",
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: "theme",
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: "theme",
  ONLINE_STORE_THEME_APP_EMBED: "theme",
  EMAIL_TEMPLATE: "notifications",
  PACKING_SLIP_TEMPLATE: "notifications",
};

/**
 * Field groups left out of the headline: translated URLs are optional
 * (changing a handle changes the address customers and search engines know).
 */
export const HEADLINE_EXCLUDED_GROUPS: readonly FieldGroup[] = ["url"];

export function countsInHeadline(resourceType: string, group: string): boolean {
  return !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, resourceType) && !(HEADLINE_EXCLUDED_GROUPS as readonly string[]).includes(group);
}

export type StateCounts = Record<FieldState, number>;

export const emptyCounts = (): StateCounts => ({ complete: 0, review: 0, draft: 0, failed: 0, outdated: 0, missing: 0 });

export function totalOf(counts: StateCounts): number {
  return FIELD_STATES.reduce((n, s) => n + counts[s], 0);
}

export function addCounts(into: StateCounts, from: Partial<StateCounts>) {
  for (const s of FIELD_STATES) into[s] += from[s] ?? 0;
  return into;
}

/**
 * Share of complete fields in percent, rounded down (99.6 % is 99, so 100 is
 * only shown when everything is complete), or null when nothing is counted.
 */
export function coveragePercent(complete: number, total: number): number | null {
  if (total <= 0) return null;
  if (complete >= total) return 100;
  return Math.floor((complete / total) * 100);
}

/** "—" (nothing to count), "<1" (some, but under one percent) or the rounded-down number. */
export function percentText(complete: number, total: number): string {
  const value = coveragePercent(complete, total);
  if (value === null) return "—";
  if (value === 0 && complete > 0) return "<1";
  return String(value);
}

/** What to do next with fields in a state (the drill-down's action). */
export const STATE_ACTIONS: Readonly<Partial<Record<FieldState, "translate" | "review" | "retry">>> = {
  missing: "translate",
  outdated: "translate",
  failed: "retry",
  draft: "review",
  review: "review",
};
