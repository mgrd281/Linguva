/**
 * The order of Review ("Übersetzungen prüfen"): one card per item and
 * language, products first, then collections, pages, blog posts and blogs,
 * in natural number order (Product/2 before Product/10), and inside a card
 * the texts in the order a merchant reads them (name, description, Google
 * texts, image texts, extra details, other texts, web address).
 *
 * Pure mirrors of the SQL expressions in app/.server/review/page.ts, which
 * sorts and pages in the database; tests/integration/review-cards.test.ts
 * checks that both give the same values for every kind of draft.
 */

/** Part `n` of a GID split at "/" (1-based), as SQL split_part(gid, '/', n): "Product" is part 4 of gid://shopify/Product/12. */
export function gidPart(gid: string, n: number): string {
  return gid.split("/")[n - 1] ?? "";
}

/** Card kinds in display order; any other kind comes after them. */
export const CARD_KIND_RANK: Readonly<Record<string, number>> = { Product: 1, Collection: 2, Page: 3, Article: 4, Blog: 5 };
export const OTHER_KIND_RANK = 9;

/** type_rank: the card's place by the kind of its GID. */
export function typeRank(cardGid: string): number {
  return CARD_KIND_RANK[gidPart(cardGid, 4)] ?? OTHER_KIND_RANK;
}

/** id_len: the length of the card GID's id, so shorter numbers come first (natural numeric order). */
export function idLength(cardGid: string): number {
  return [...gidPart(cardGid, 5)].length;
}

/** card_gid: the owner's GID for an image or custom field that has one, else the draft's own. */
export function cardGidOf(resourceGid: string, owner: string | null): string {
  return owner ?? resourceGid;
}

const NAME_KEYS = ["title", "name", "label"];
const DESCRIPTION_KEYS = ["body_html", "body", "summary_html", "description"];

/**
 * field_rank: a text's place inside its card. Texts of an image or custom
 * field in their owner's card come after the owner's own texts.
 */
export function fieldRank(key: string, attached: boolean): number {
  if (attached) return key === "alt" ? 50 : 60;
  if (NAME_KEYS.includes(key)) return 10;
  if (DESCRIPTION_KEYS.includes(key)) return 20;
  if (key === "meta_title") return 30;
  if (key === "meta_description") return 40;
  if (key === "alt") return 50;
  if (key === "value") return 60;
  if (key === "handle") return 90;
  return 70;
}
