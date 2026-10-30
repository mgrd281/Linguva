/**
 * Review's areas: every text waiting for approval keeps the area the
 * language pages give it (categoryTallies: Produkte, Bildbeschreibungen,
 * Zusatzinfos, Webadressen, …), even where it is shown inside its owner's
 * card, so the area chips add up to the total and a language page's
 * "N prüfen" link shows exactly those N texts. Pure; the SQL in
 * app/.server/review/page.ts computes the same own type (checked by
 * tests/integration/review-cards.test.ts), and tests/unit/review-areas.test.ts
 * covers every kind of draft.
 */
import { CATEGORIES, CATEGORY_IDS, EXTRAS, categoryOf, type CategoryId } from "./language-categories";
import { gidPart } from "./review-order";

/** Review's areas in chip order: the ten categories, then the theme, notifications, web addresses and anything else. */
export const AREA_KEYS = [...CATEGORY_IDS, "theme", "notifications", "urls", "other"] as const;
export type AreaKey = CategoryId | "theme" | "notifications" | "urls" | "other";

export function isAreaKey(value: string): value is AreaKey {
  return (AREA_KEYS as readonly string[]).includes(value);
}

/** GID kinds with their own editor: products, collections, pages, blog posts and blogs. */
export const RESOURCE_GID_KINDS: readonly string[] = ["Product", "Collection", "Page", "Article", "Blog"];

/** Coverage types of images and custom fields: their texts belong to an owner. */
export const ATTACHED_TYPES: readonly string[] = [...CATEGORIES.images.types, ...CATEGORIES.customFields.types];

/** Every type a category or the theme or notifications count; anything else is "other". */
export const KNOWN_TYPES: readonly string[] = [
  ...CATEGORY_IDS.flatMap((id) => CATEGORIES[id].types as readonly string[]),
  ...EXTRAS.theme.types,
  ...EXTRAS.notifications.types,
];

const PARENT_TYPE: Readonly<Record<string, string>> = { Product: "PRODUCT", Collection: "COLLECTION", Page: "PAGE", Article: "ARTICLE" };
const IMAGE_TYPE_OF_PARENT: Readonly<Record<string, string>> = { PRODUCT: "MEDIA_IMAGE", COLLECTION: "COLLECTION_IMAGE", ARTICLE: "ARTICLE_IMAGE" };

/**
 * own_type: the coverage type of a draft's own content. A bulk job's image
 * or custom field (it has its owner) by its owner's kind; a product,
 * collection, page, post, blog or product image by its GID; anything else by
 * its job's type (content-type jobs; smart checks of an image or a custom
 * field), else by what the coverage scan stored (imports have no job).
 */
export function ownType(draft: { resourceGid: string; parentGid: string | null }, jobType: string | null, coverageType: string | null): string | null {
  const kind = gidPart(draft.resourceGid, 4);
  if (draft.parentGid) {
    const parent = PARENT_TYPE[gidPart(draft.parentGid, 4)];
    if (!parent) return null;
    return kind === "Metafield" ? `${parent}_METAFIELD` : (IMAGE_TYPE_OF_PARENT[parent] ?? null);
  }
  if (RESOURCE_GID_KINDS.includes(kind)) return kind.toUpperCase();
  if (kind === "MediaImage") return "MEDIA_IMAGE";
  return jobType ?? coverageType ?? null;
}

/** The area of one text: web addresses of every type together, else the area of its own content ("other" for an unknown type). */
export function areaOf(key: string, type: string | null): AreaKey {
  if (key === "handle") return "urls";
  return (type ? categoryOf(type) : null) ?? "other";
}

/** The coverage types an area counts (web addresses and "other" are found by key and by exclusion instead). */
export function areaTypes(area: AreaKey): readonly string[] {
  if (area === "theme" || area === "notifications") return EXTRAS[area].types;
  if (area === "urls" || area === "other") return [];
  return CATEGORIES[area].types;
}

/** The old `type` parameter (RESOURCE_KINDS) as the area it now stands for: the item's own texts, as the coverage pages count them. */
export const LEGACY_TYPE_AREA: Readonly<Record<string, AreaKey>> = {
  PRODUCT: "products",
  COLLECTION: "collections",
  PAGE: "pages",
  ARTICLE: "blog",
  BLOG: "blog",
};

/**
 * A card's type (its meta line, icon and editor link): the owner's kind for
 * the five kinds with an editor, else the own type of the card's own texts
 * (menus, policies, theme texts, an image without a known owner, …).
 */
export function cardTypeOf(cardGid: string, drafts: ReadonlyArray<{ resourceGid: string; ownType: string | null }>): string | null {
  const kind = gidPart(cardGid, 4);
  if (RESOURCE_GID_KINDS.includes(kind)) return kind.toUpperCase();
  return drafts.find((d) => d.resourceGid === cardGid && d.ownType)?.ownType ?? null;
}

// What a bulk job stores as the title of an owner's image or custom field ("Jacket · Image", "Jacket · Care (custom field)").
const IMAGE_TITLE = /^(.*) · Image$/;
const FIELD_TITLE = /^(.*) · (.+) \(custom field\)$/;
const FIELD_NAME = /^(?:(.*) · )?(.+) \(custom field\)$/;

/**
 * A card's title from the stored titles: its own text's, else the owner's
 * title an image or custom field was stored with (without the English
 * suffix the job added); null when none was stored (the page then shows
 * the live title, the kind or "untitled").
 */
export function ownerTitle(cardGid: string, drafts: ReadonlyArray<{ resourceGid: string; parentGid: string | null; title: string | null }>): string | null {
  const own = drafts.find((d) => d.resourceGid === cardGid && !d.parentGid && d.title?.trim());
  if (own) return own.title!.trim();
  for (const d of drafts) {
    if (!d.parentGid || !d.title) continue;
    const owner = (IMAGE_TITLE.exec(d.title) ?? FIELD_TITLE.exec(d.title))?.[1]?.trim();
    if (owner) return owner;
  }
  return null;
}

/** A custom field's name from its stored title ("Jacket · Care (custom field)" → "Care"); null otherwise. */
export function customFieldName(title: string | null): string | null {
  const name = title ? FIELD_NAME.exec(title)?.[2]?.trim() : null;
  return name || null;
}
