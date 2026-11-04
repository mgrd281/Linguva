/**
 * An area's list (app/components/CategoryList.tsx) and an area's card on the
 * language page (app/components/CategoryCard.tsx), rendered on the server:
 * each is one card with its edge on a phone too (never Polaris' flat
 * section), named by its one visible heading; the list's filters show only
 * while they can narrow it (or lead back to All), and its search runs as you
 * type, with no button; the card leads to its list, translating is the
 * page's next step (no button on the card), and a running translation that
 * still finds its texts wears the Jobs page's sign for it; the key to the
 * bars names only the states there are texts in (app/components/ItemStates.tsx).
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { CategoryCard, type LanguageCategory } from "../../app/components/CategoryCard";
import { CategoryList } from "../../app/components/CategoryList";
import { StateKey } from "../../app/components/ItemStates";
import { translator } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { emptyCounts, type StateCounts } from "../../app/lib/coverage-rules";

const en = translator("en");
const html = (node: ReactNode) => renderToStaticMarkup(createElement(StaticRouter, { location: "/app/languages/de/products" }, node));

/** In a data router: the search's form submits through it. */
async function routed(node: ReactNode, url = "http://localhost/app/languages/de/products?state=missing"): Promise<string> {
  const handler = createStaticHandler([{ id: "page", path: new URL(url).pathname, Component: () => node }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

type ItemCounts = { all: number; failed: number; outdated: number; missing: number; waiting: number; complete: number };

/** A product of the list in one state. */
const row = (n: number, state: "missing" | "complete") => ({
  id: `item-${n}`,
  type: "PRODUCT",
  reference: String(n),
  state,
  texts: [{ group: "title", state }],
  failureCode: null,
  href: `/app/products/${n}?lang=de`,
  smart: null,
  title: `Product ${n} jacket`,
  translated: state === "complete" ? `Jacke ${n}` : null,
  label: null,
  image: null,
});

function listData(counts: Partial<ItemCounts>, rows: Array<ReturnType<typeof row>>, state = "all", page?: { from: number; to: number; total: number; number: number; nextCursor: string | null }, searchable = false) {
  const all = { failed: 0, outdated: 0, missing: 0, waiting: 0, complete: 0, ...counts };
  return {
    category: { id: "products", searchable, review: null },
    language: { locale: "de" },
    filter: { state, q: "" },
    counts: { all: all.failed + all.outdated + all.missing + all.waiting + all.complete, ...all },
    rows,
    page: page ?? { from: 1, to: rows.length, total: rows.length, number: 1, nextCursor: null },
    titlesUnavailable: false,
    smart: null,
  };
}

const NAMES = { language: "German", locale: "de", primary: "English" };

function list(...args: Parameters<typeof listData>) {
  return html(createElement(CategoryList, { data: listData(...args) as never, i18n: en, names: NAMES }));
}

describe("an area's list", () => {
  it("is one card with its edge on a phone too, named by its heading in the type scale", () => {
    const markup = list({ missing: 2 }, [row(1, "missing"), row(2, "missing")]);
    expect(markup).toMatch(/^<section aria-labelledby="list-heading"><s-box background="base" border="base" borderRadius="large-100" padding="none" overflow="hidden">/);
    expect(markup).toContain('<h2 id="list-heading" class="lv-h2">Item by item</h2>');
    expect(markup).not.toContain("<s-section");
  });

  it("leaves out the filters while every item has one state: All and that state would show the same items", () => {
    const one = list({ missing: 2 }, [row(1, "missing"), row(2, "missing")]);
    expect(one).not.toContain('<nav aria-label="Show">');
    // The group's heading still names the state and its count.
    expect(one).toContain(">Missing</h3>");
    const two = list({ missing: 1, complete: 1 }, [row(1, "missing"), row(2, "complete")]);
    expect(two).toContain('<nav aria-label="Show">');
    expect(two).toContain('<span class="lv-filter" aria-current="true">All 2</span>');
  });

  it("goes on with the pages when every item has one state: no filter that would list the same items", () => {
    // 55 products all missing, 50 a page (a new store): the group's "View all" would open the same items.
    const rows = Array.from({ length: 50 }, (_, i) => row(i + 1, "missing"));
    const markup = list({ missing: 55 }, rows, "all", { from: 1, to: 50, total: 55, number: 1, nextCursor: "abc" });
    expect(markup).not.toContain("state=missing");
    expect(markup).not.toContain('<nav aria-label="Show">');
    expect(markup).toContain("Next page");
  });

  it("searches by name as you type: a search landmark in a GET form that keeps the filter, with no Search button", async () => {
    const data = listData({ missing: 2 }, [row(1, "missing"), row(2, "missing")], "missing", undefined, true);
    const markup = await routed(createElement(CategoryList, { data: data as never, i18n: en, names: NAMES, origin: "content" }));
    expect(markup).toMatch(/<form method="get" action="\/app\/languages\/de\/products" role="search"[^>]*>/);
    expect(markup).toContain('<input type="hidden" name="state" value="missing"/><input type="hidden" name="from" value="content"/><s-search-field name="q" label="Search by name"');
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain(">Search</");
  });

  it("keeps them on a chosen state, as the way back to All, even when nothing is left in it", () => {
    const failed = list({ missing: 2 }, [], "failed");
    expect(failed).toContain('<nav aria-label="Show">');
    expect(failed).toMatch(/<a class="lv-filter" href="\/app\/languages\/de\/products"[^>]*>All 2<\/a>/);
    expect(failed).toContain("Nothing in this group right now.");
  });
});

describe("an area's card on the language page", () => {
  const counts: StateCounts = { ...emptyCounts(), missing: 12 };
  const category = {
    id: "products",
    tier: "first",
    href: "/app/languages/de/products",
    items: 6,
    textTypes: ["PRODUCT"],
    tally: { counts, total: 12, complete: 0, percent: 0 },
    state: { kind: "ok" },
    review: null,
    job: null,
    bulk: null,
    automatic: false,
    payoff: null,
  } as unknown as LanguageCategory;

  const card = (extra: Record<string, unknown> = {}) =>
    html(createElement(CategoryCard, { category: { ...category, ...extra } as LanguageCategory, i18n: en, locale: "de", primaryName: "English", preview: null, featured: true }));

  it("is a native section with the card's edge, named by its one visible heading under the tier's", () => {
    const markup = card();
    expect(markup).toMatch(/^<section aria-labelledby="area-products"><s-box background="base" border="base" borderRadius="large-100" padding="base">/);
    expect(markup).toContain('<h4 id="area-products" class="lv-h3">Products</h4>');
    expect(markup).not.toContain("<s-section");
    expect(markup).not.toContain('aria-hidden="true">Products');
  });

  it("leads to its list; translating is the page's next step, never a button on the card", () => {
    const markup = card({ bulk: { items: 6, texts: { missing: 12, outdated: 0, failed: 0 }, chars: 1200, attached: false } });
    expect(markup).toContain('<s-link href="/app/languages/de/products" accessibilityLabel="View all 6: Products">View all 6');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('commandFor="language-translate"');
  });

  it("shows a running translation in the Jobs page's signs: finding its texts first, then translating them", () => {
    const finding = card({ job: { href: "/app/jobs/1", done: 0, total: 0, discoveryDone: false } });
    expect(finding).toContain('<s-icon type="search-list" tone="info" size="small"></s-icon><strong class="lv-strong">Finding texts</strong>');
    expect(finding).not.toContain("Translating");
    const translating = card({ job: { href: "/app/jobs/1", done: 3, total: 12, discoveryDone: true } });
    expect(translating).toContain('<s-icon type="in-progress" tone="info" size="small"></s-icon><strong class="lv-strong">Translating · 3 of 12</strong>');
    // In the card itself, not in a grey box inside it.
    expect(translating).not.toContain('background="subdued"');
  });
});

describe("the key to the bars", () => {
  const key = (counts?: StateCounts) => html(createElement(StateKey, { i18n: en, ...(counts ? { counts } : {}) }));
  const words = (markup: string) => [...markup.matchAll(/<s-text color="subdued">([^<]*)<\/s-text>/g)].map((m) => m[1]);

  it("names only the states there are texts in, and nothing without texts", () => {
    expect(words(key({ ...emptyCounts(), missing: 15 }))).toEqual(["Missing"]);
    // Drafts with and without notes both wait for approval.
    expect(words(key({ ...emptyCounts(), complete: 3, draft: 1, review: 1, missing: 2 }))).toEqual(["Done", "Waiting for approval", "Missing"]);
    expect(key(emptyCounts())).toBe("");
  });

  it("names all five without counts", () => {
    expect(words(key())).toEqual(["Done", "Waiting for approval", "Outdated", "Failed", "Missing"]);
  });
});
