/**
 * Review's pages by cards (app/lib/review-cards.ts): whole cards up to the
 * page's budget, a big first card alone, a card larger than a page split
 * with "continues" / "continued", and the cursor for the next page.
 */
import { describe, expect, it } from "vitest";
import { assembleCards, cardKeyOf } from "../../app/lib/review-cards";

/** Rows of cards in page order: [card number, texts]. */
function rows(...cards: Array<[number, number]>) {
  return cards.flatMap(([card, count]) =>
    Array.from({ length: count }, (_, i) => ({ id: `c${card}-${i + 1}`, cardGid: `gid://shopify/Product/${card}`, locale: "de" })),
  );
}

const sizes = (result: ReturnType<typeof assembleCards>) => result.cards.map((c) => c.rows.length);

describe("assembleCards", () => {
  const options = { budget: 50, max: 100 };

  it("takes whole cards while the page stays within its budget", () => {
    const result = assembleCards(rows([1, 20], [2, 20], [3, 20]), options);
    expect(sizes(result)).toEqual([20, 20]);
    expect(result.nextCursor).toBe("c2-20");
    expect(result.cards.every((c) => !c.continued && !c.continues)).toBe(true);
  });

  it("fills a page exactly to the budget and ends without a cursor when nothing is left", () => {
    expect(sizes(assembleCards(rows([1, 25], [2, 25], [3, 1]), options))).toEqual([25, 25]);
    const all = assembleCards(rows([1, 3], [2, 4]), options);
    expect(sizes(all)).toEqual([3, 4]);
    expect(all.nextCursor).toBeNull();
  });

  it("never splits a card of up to 100 texts: a first card of 51 to 100 stands alone", () => {
    const big = assembleCards(rows([1, 80], [2, 5]), options);
    expect(sizes(big)).toEqual([80]);
    expect(big.cards[0]!.continues).toBe(false);
    expect(big.nextCursor).toBe("c1-80");
    expect(sizes(assembleCards(rows([1, 100], [2, 1]), options))).toEqual([100]);
  });

  it("splits only a card with more than 100 texts, marked on both pages", () => {
    // The page reads max + 1 rows.
    const first = assembleCards(rows([1, 150]).slice(0, 101), options);
    expect(sizes(first)).toEqual([100]);
    expect(first.cards[0]).toMatchObject({ continued: false, continues: true });
    expect(first.nextCursor).toBe("c1-100");

    const second = assembleCards(rows([1, 150]).slice(100), { ...options, cursorCard: cardKeyOf(rows([1, 1])[0]!) });
    expect(sizes(second)).toEqual([50]);
    expect(second.cards[0]).toMatchObject({ continued: true, continues: false });
    expect(second.nextCursor).toBeNull();
  });

  it("marks a continued card only when the previous page ended in it", () => {
    const result = assembleCards(rows([2, 5], [3, 5]), { ...options, cursorCard: "gid://shopify/Product/1|de" });
    expect(result.cards[0]!.continued).toBe(false);
  });

  it("keys cards by item and language", () => {
    expect(cardKeyOf({ cardGid: "gid://shopify/Product/1", locale: "fr" })).toBe("gid://shopify/Product/1|fr");
    const mixed = [
      { id: "a", cardGid: "gid://shopify/Product/1", locale: "de" },
      { id: "b", cardGid: "gid://shopify/Product/1", locale: "fr" },
    ];
    expect(assembleCards(mixed, options).cards.map((c) => c.key)).toEqual(["gid://shopify/Product/1|de", "gid://shopify/Product/1|fr"]);
  });

  it("returns nothing for no rows", () => {
    expect(assembleCards([], options)).toEqual({ cards: [], nextCursor: null });
  });
});
