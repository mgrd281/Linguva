/**
 * Where each Shopify content type appears on the Content page ("Inhalte"),
 * in the language page's areas (language-categories.ts), and what an area's
 * tile says. Pure, shared by server and UI; tested in
 * tests/unit/content-areas.test.ts.
 *
 * Every type is listed in exactly one place, decided by its live state:
 * in the store → its area's tile (theme and notification types: a part of
 * "More texts"); a missing permission → the permission card's row of its
 * scope; not in the store → the fold "Not in your store yet"; refused
 * although nothing can be granted → the fold "Not available to apps";
 * Shopify didn't answer → the warning banner.
 */
import type { HubStatus } from "../.server/translation/content-hub";
import type { IconName } from "./icons";
import { categoryOf, TIERS, type CategoryId, type CategoryState } from "./language-categories";
import type { TranslatableKind } from "./resource-kinds";

// Image descriptions and custom fields, translated with their owner: one map for both pages (the language page's steps use it too).
export { ATTACHED, hasAttached, type AttachedArea, type AttachedPart } from "./language-categories";

/** The 26 types of the page, area by area in the areas' order, each area's types in their own order. */
export const HUB_TYPES = [
  "PRODUCT",
  "COLLECTION",
  "MENU",
  "LINK",
  "FILTER",
  "PRODUCT_OPTION",
  "PRODUCT_OPTION_VALUE",
  "SHOP",
  "SHOP_POLICY",
  "DELIVERY_METHOD_DEFINITION",
  "PAYMENT_GATEWAY",
  "SELLING_PLAN_GROUP",
  "SELLING_PLAN",
  "METAOBJECT",
  "PAGE",
  "BLOG",
  "ARTICLE",
  "ONLINE_STORE_THEME_LOCALE_CONTENT",
  "ONLINE_STORE_THEME_JSON_TEMPLATE",
  "ONLINE_STORE_THEME_SECTION_GROUP",
  "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
  "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
  "ONLINE_STORE_THEME_APP_EMBED",
  "ONLINE_STORE_THEME",
  "EMAIL_TEMPLATE",
  "PACKING_SLIP_TEMPLATE",
] as const satisfies readonly TranslatableKind[];

export type HubType = (typeof HUB_TYPES)[number];

export function isHubType(value: string): value is HubType {
  return (HUB_TYPES as readonly string[]).includes(value);
}

/** The groups under "More texts": the theme's and the notifications' parts, in the order they are listed. */
export const GROUP_PARTS = {
  theme: [
    "ONLINE_STORE_THEME_LOCALE_CONTENT",
    "ONLINE_STORE_THEME_JSON_TEMPLATE",
    "ONLINE_STORE_THEME_SECTION_GROUP",
    "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
    "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
    "ONLINE_STORE_THEME_APP_EMBED",
    "ONLINE_STORE_THEME",
  ],
  notifications: ["EMAIL_TEMPLATE", "PACKING_SLIP_TEMPLATE"],
} as const satisfies Record<"theme" | "notifications", readonly HubType[]>;

export type GroupId = keyof typeof GROUP_PARTS;
export type GroupPart = (typeof GROUP_PARTS)[GroupId][number];

/**
 * The areas with a tile, in the language page's order. Image descriptions
 * and custom fields aren't: they are translated with their owners, so they
 * are a note in the owner's tile (ATTACHED).
 */
export const TILE_AREAS: readonly CategoryId[] = TIERS.flatMap((tier) => tier.categories).filter((id) => id !== "customFields" && id !== "images");

/** Each type's picture in the folds and the theme's and notifications' lists. */
export const PART_ICON: Readonly<Record<HubType, IconName>> = {
  PRODUCT: "product",
  COLLECTION: "collection",
  MENU: "menu",
  LINK: "link-list",
  FILTER: "filter",
  PRODUCT_OPTION: "variant",
  PRODUCT_OPTION_VALUE: "variant",
  SHOP: "search",
  SHOP_POLICY: "contract",
  DELIVERY_METHOD_DEFINITION: "delivery",
  PAYMENT_GATEWAY: "payment",
  SELLING_PLAN_GROUP: "order-repeat",
  SELLING_PLAN: "order-repeat",
  // Shopify's own pictures for metaobjects and for a theme's settings (a gear would read as Linguva's Settings).
  METAOBJECT: "metaobject",
  PAGE: "page",
  BLOG: "blog",
  ARTICLE: "blog",
  ONLINE_STORE_THEME_LOCALE_CONTENT: "button",
  ONLINE_STORE_THEME_JSON_TEMPLATE: "theme-template",
  ONLINE_STORE_THEME_SECTION_GROUP: "layout-header",
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: "layout-section",
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: "paint-brush-flat",
  ONLINE_STORE_THEME_APP_EMBED: "app-extension",
  // Not the theme's own picture: that is its group's row ("Texts of your theme").
  ONLINE_STORE_THEME: "text-block",
  EMAIL_TEMPLATE: "email",
  PACKING_SLIP_TEMPLATE: "package",
};

/** What each optional permission unlocks, as the permission card's chips show it (a lock on the card itself). */
export const SCOPE_ICON: Readonly<Record<string, IconName>> = {
  read_legal_policies: "contract",
  read_shipping: "delivery",
  read_online_store_navigation: "menu",
  read_metaobjects: "metaobject",
  read_themes: "theme",
};

/**
 * Columns for a row of `count` cards, so no row ends half empty: one card
 * the full width, two or three side by side, four as two by two.
 */
export function cardColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  return count % 3 === 0 || (count % 2 !== 0 && count > 3) ? 3 : 2;
}

/** Areas whose tiles show pictures of their items (from the language page's previews). */
export const PICTURE_AREAS: ReadonlySet<CategoryId> = new Set(["products", "collections", "blog"]);

/** Areas whose items have web addresses ("More texts" lists them while the language isn't counted). */
export const LINKED_AREAS: ReadonlySet<CategoryId> = new Set(["products", "collections", "pages", "blog"]);

export type Place =
  /** In the store: its area's tile. */
  | { kind: "tile"; area: CategoryId }
  /** In the store: a part of the theme's or the notifications' group under "More texts". */
  | { kind: "part"; extra: GroupId }
  /** Needs a permission: the permission card's row of its scope. */
  | { kind: "access"; scope: string }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "unknown" };

/** The one place a type is listed, by its live state. */
export function placeOf(entry: { type: string; status: HubStatus; scope: string | null }): Place {
  switch (entry.status) {
    case "has-content": {
      const area = categoryOf(entry.type);
      if (area === "theme" || area === "notifications") return { kind: "part", extra: area };
      // Every page type has an area (a unit test checks it); anything else can't be shown.
      return area ? { kind: "tile", area } : { kind: "unknown" };
    }
    case "needs-permission":
      // Only a type with a scope the merchant hasn't granted gets this status (content-hub.ts).
      return entry.scope ? { kind: "access", scope: entry.scope } : { kind: "unavailable" };
    case "empty":
      return { kind: "empty" };
    case "unavailable":
      return { kind: "unavailable" };
    case "unknown":
      return { kind: "unknown" };
  }
}

/**
 * What an area's tile (or a group's row) shows in the chosen language, in
 * this order of precedence:
 * - refused: a type is refused live (a permission is missing, or apps may
 *   not read it): no figure, the refused types named;
 * - recount: refused at the last count, readable now: count again;
 * - notCounted / counting: the language isn't fully counted, or a count
 *   reads the area now;
 * - incomplete: the last count didn't read it all (figure and bar);
 * - new: the count found nothing, but the store has some now;
 * - nothing: counted, nothing to translate;
 * - figure: the percentage, bar and open work.
 * Never a figure while a type is refused or being counted (COVERAGE_RULES).
 */
export type TileState = "refused" | "recount" | "notCounted" | "counting" | "incomplete" | "new" | "nothing" | "figure";

export interface TileStateInput {
  /** Types refused live: a permission the merchant can grant (needs-permission), and refused anyway (unavailable). */
  locked: readonly string[];
  unavailable: readonly string[];
  /** The area's scan state in the language (categoryState). */
  segment: CategoryState;
  /** The language is fully counted (measuredLocales). */
  measured: boolean;
  /** A count under way reads the language. */
  scanning: boolean;
  /** Texts counted in the language. */
  total: number;
  /** Items of the area's types the last count stored in the language, with or without texts. */
  itemsAll: number;
  /** Shopify has content of the area now (a probe found some). */
  live: boolean;
}

export function tileState(input: TileStateInput): TileState {
  if (input.locked.length || input.unavailable.length) return "refused";
  if (input.segment.kind === "no-access") return "recount";
  if (!input.measured || input.segment.kind === "counting") return input.scanning ? "counting" : "notCounted";
  if (input.segment.kind === "incomplete") return "incomplete";
  if (input.total === 0) return input.live && input.itemsAll === 0 ? "new" : "nothing";
  return "figure";
}

/** States that show a figure and a bar. */
export function showsFigure(state: TileState): boolean {
  return state === "figure" || state === "incomplete";
}
