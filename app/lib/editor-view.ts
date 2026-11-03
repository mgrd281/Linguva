/**
 * The translation editor's view logic (app/components/ResourceTranslationEditor.tsx), pure and shared
 * by its parts; tested in tests/unit/editor-view.test.ts:
 *
 * - the order of an item's texts: Review's (app/lib/review-order.ts fieldRank: name, description,
 *   Google texts, other texts, web address last), Shopify's order among equals;
 * - which texts are open (missing, or outdated because the original changed): the only ones AI and
 *   the translation memory fill, as the image descriptions and bulk jobs already do;
 * - each text's one state, where "back" leads (the area list a merchant opens items from) and the
 *   storefront path of the Google preview.
 */
import { categoryOf, isCategoryId, type CategoryId } from "./language-categories";
import { fieldRank } from "./review-order";

/** What the view needs of a text: the loader's main fields and the image descriptions and extra details alike. */
export interface TextFacts {
  key: string;
  translation: string;
  outdated: boolean;
  /** Machine-translatable (a web address isn't). */
  machine: boolean;
}

/** Google texts and the texts after them start here (fieldRank: meta_title 30, other texts 70, web address 90). */
const AFTER_DESCRIPTION = 30;

/** Review's order (name, description, Google texts, other texts, web address); Shopify's among equals. */
export function orderTexts<T extends { key: string }>(fields: readonly T[]): T[] {
  return fields
    .map((field, index) => ({ field, index, rank: fieldRank(field.key, false) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.field);
}

/** Where the Google preview goes in ordered texts: after the name and description, before the Google texts (or the end). */
export function googlePreviewIndex(ordered: readonly { key: string }[]): number {
  const index = ordered.findIndex((field) => fieldRank(field.key, false) >= AFTER_DESCRIPTION);
  return index === -1 ? ordered.length : index;
}

/** Missing (no translation yet) or outdated (its original changed since). */
export function isOpen(text: Pick<TextFacts, "translation" | "outdated">): boolean {
  return !text.translation || text.outdated;
}

/** The texts AI may write now: machine-translatable and open. Texts already translated stay as they are. */
export function openForAi<T extends TextFacts>(texts: readonly T[]): T[] {
  return texts.filter((text) => text.machine && isOpen(text));
}

/** A web address is optional and left out of the item's count, as on the language pages (COVERAGE_RULES: URL handles). */
export const isWebAddress = (key: string) => key === "handle";

/** "2 of 5 texts to translate": the item's texts and its image descriptions and extra details, web addresses left out. */
export function textCounts(texts: readonly Pick<TextFacts, "key" | "translation" | "outdated">[]): { open: number; total: number } {
  const counted = texts.filter((text) => !isWebAddress(text.key));
  return { open: counted.filter(isOpen).length, total: counted.length };
}

/**
 * A text's one state, beside its name and on its tile, from what its field holds now: a draft (AI's or
 * the memory's) or the merchant's own change while it differs from what is published; then published
 * just now, outdated, translated, not translated.
 */
export type TextState = "draft" | "memory" | "edited" | "published" | "outdated" | "translated" | "missing";

export function textState(input: {
  /** What the field holds now (typed, drafted or published). */
  current: string;
  /** What Shopify has. */
  translation: string;
  outdated: boolean;
  draft: { from: "ai" | "memory"; value: string } | null;
  /** Saved with the page's last Publish. */
  published: boolean;
}): TextState {
  if (input.current !== input.translation) {
    if (input.draft && input.current === input.draft.value) return input.draft.from === "memory" ? "memory" : "draft";
    return "edited";
  }
  if (input.published) return "published";
  if (input.translation) return input.outdated ? "outdated" : "translated";
  return "missing";
}

/** The memory's suggestions for these keys only (the open texts when it was asked): the others stay as they are. */
export function pickDrafts<T extends { drafts: Record<string, string>; scores?: Record<string, number> }>(result: T, keys: ReadonlySet<string>): T {
  const pick = <V>(values: Record<string, V> | undefined) => (values ? Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key))) : values);
  return { ...result, drafts: pick(result.drafts) ?? {}, ...(result.scores ? { scores: pick(result.scores) } : {}) };
}

/**
 * The area list an item is opened from (/app/languages/<locale>/<area>): products, collections, pages,
 * blog posts and blogs, menus, legal texts, … Null for the theme's texts and notifications, whose lists
 * are under Content.
 */
export function editorArea(kind: string): CategoryId | null {
  const area = categoryOf(kind);
  return area && isCategoryId(area) ? area : null;
}

/** The storefront path in the Google preview's example address: a blog post lives under its blog (…/blogs/<blog>/<post>). */
export function storefrontSegment(kind: string, plural: string): string {
  return kind === "ARTICLE" ? "blogs/…" : plural;
}
