/**
 * Review pages by cards, not by drafts: a page holds about `budget` texts
 * and never splits a card (one item in one language) across two pages,
 * except a single card with more than `max` texts, which continues on the
 * next page. A page never holds more than `max` texts, so "Approve all" is
 * always one request. Pure; tests/unit/review-cards.test.ts.
 */

export interface CardRow {
  id: string;
  cardGid: string;
  locale: string;
}

export interface AssembledCard<R extends CardRow> {
  /** The card's GID and language. */
  key: string;
  rows: R[];
  /** The card started on the previous page. */
  continued: boolean;
  /** The card goes on on the next page. */
  continues: boolean;
}

export const cardKeyOf = (row: Pick<CardRow, "cardGid" | "locale">) => `${row.cardGid}|${row.locale}`;

/**
 * Walks the rows (in page order, one more than `max` read) card by card:
 * the first card is always taken (its first `max` rows when it has more),
 * further cards whole while the page stays within `budget` texts. Because
 * budget < rows read, a card cut by the read limit is only ever reached as
 * the first one. `cursorCard`: the card of the previous page's last row.
 */
export function assembleCards<R extends CardRow>(
  rows: readonly R[],
  options: { budget: number; max: number; cursorCard?: string | null },
): { cards: Array<AssembledCard<R>>; nextCursor: string | null } {
  const cards: Array<AssembledCard<R>> = [];
  let taken = 0;
  let i = 0;
  while (i < rows.length) {
    const key = cardKeyOf(rows[i]!);
    let end = i;
    while (end < rows.length && cardKeyOf(rows[end]!) === key) end++;
    const size = end - i;
    if (cards.length === 0) {
      const take = Math.min(size, options.max);
      cards.push({ key, rows: rows.slice(i, i + take), continued: Boolean(options.cursorCard && options.cursorCard === key), continues: false });
      taken = take;
      if (take < size) break;
    } else {
      if (taken + size > options.budget) break;
      cards.push({ key, rows: rows.slice(i, end), continued: false, continues: false });
      taken += size;
    }
    i = end;
  }
  const last = cards[cards.length - 1];
  if (last && taken < rows.length && cardKeyOf(rows[taken]!) === last.key) last.continues = true;
  return { cards, nextCursor: taken < rows.length && taken > 0 ? rows[taken - 1]!.id : null };
}
