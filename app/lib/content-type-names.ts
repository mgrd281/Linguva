/**
 * A content type in the merchant's words, the same wherever a tools page
 * names one (Coverage's rows and choices, the export's choice): the Content
 * page's names for Shopify's types ("Buttons & fixed texts", "Legal texts"),
 * image descriptions and extra details with the things they belong to
 * ("Products: image descriptions"), and the type's own label only where
 * neither exists. Types are grouped by the language page's areas. Pure;
 * tested in tests/unit/content-type-names.test.ts.
 */
import type { I18n, MessageKey } from "../i18n/i18n";
import { hasMessage, kindLabel } from "../i18n/labels";
import { isMetafieldCoverageType } from "./coverage-rules";
import { categoryOf, CATEGORY_IDS, type CategoryId } from "./language-categories";
import { IMAGE_COVERAGE_TYPES, isImageCoverageType } from "./resource-kinds";

/** The Content page's name of a type, if it has one. */
function partName(i18n: I18n, type: string): string | null {
  const key = `content.part.${type}.name`;
  return hasMessage(key) ? i18n.t(key as MessageKey) : null;
}

const ownerName = (i18n: I18n, owner: string) => partName(i18n, owner) ?? kindLabel(i18n, owner);

/** "Products", "Legal texts", "Products: image descriptions", "Pages: extra details". */
export function contentTypeName(i18n: I18n, type: string): string {
  if (isImageCoverageType(type)) return i18n.t("coverage.type.images", { owner: ownerName(i18n, IMAGE_COVERAGE_TYPES[type].parent) });
  if (isMetafieldCoverageType(type)) return i18n.t("coverage.type.customFields", { owner: ownerName(i18n, type.slice(0, -"_METAFIELD".length)) });
  return partName(i18n, type) ?? kindLabel(i18n, type);
}

/** An area of the language page, or the theme's texts and the notifications the percentage leaves out. */
export type TypeArea = CategoryId | "theme" | "notifications";

const AREA_ORDER: readonly TypeArea[] = [...CATEGORY_IDS, "theme", "notifications"];

/** The area's name as the language page writes it ("Menus & filters", "Texts of your theme"). */
export function areaName(i18n: I18n, area: TypeArea): string {
  return area === "theme" || area === "notifications" ? i18n.t(`language.extra.${area}.name`) : i18n.t(`language.category.${area}.name`);
}

/**
 * The types by area, in the language page's order of areas (types no area
 * claims last, in a group without a name), each group's types in the order
 * given.
 */
export function typesByArea(types: readonly string[]): Array<{ area: TypeArea | null; types: string[] }> {
  const groups = new Map<TypeArea | null, string[]>();
  for (const type of types) {
    const area = categoryOf(type);
    groups.set(area, [...(groups.get(area) ?? []), type]);
  }
  return [...AREA_ORDER, null].filter((area) => groups.has(area)).map((area) => ({ area, types: groups.get(area)! }));
}
