/**
 * Review's control card (app/components/ReviewControls.tsx) and "All reviewed": the languages in the shared
 * picker (Content's chips with their counts, the current one in the chosen look; a select above six that opens
 * a language at once), the areas and "With notes" as an area list's filter pills (ui.css .lv-filter, no Polaris
 * chips), and the languages of "All reviewed" as links without their figures (a language's share is on its
 * own page, the Overview and Coverage).
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { ReviewPageData } from "../../app/.server/review/page";
import { ReviewControls, type PageActions } from "../../app/components/ReviewControls";
import { ReviewPage } from "../../app/components/ReviewPage";
import { translator } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import type { Facets, ReviewQuery } from "../../app/lib/review-view";

const en = translator("en");

/** In a data router: the search's and the picker's forms submit through it. */
async function routed(node: ReactNode, url: string): Promise<string> {
  const handler = createStaticHandler([{ id: "review", path: new URL(url).pathname, Component: () => node }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

const QUERY: ReviewQuery = { locale: "de", area: null, flagged: false, search: null, jobId: null, group: null };
const FACETS: Facets = {
  total: 9,
  languages: [
    { locale: "de", count: 5 },
    { locale: "fr", count: 3 },
    { locale: "ar", count: 1 },
  ],
  areas: [
    { area: "products", count: 6 },
    { area: "collections", count: 3 },
  ],
  flagged: 2,
};
const NO_ACTIONS: PageActions = { total: 0, undecided: 0, approvable: 0, allOnPage: true, busy: false, approving: false, waiting: false, blocked: null };

function pageData(facets: Facets, extra: Partial<ReviewPageData> = {}): ReviewPageData {
  return {
    filter: { ...QUERY, after: null },
    primaryLocale: "en",
    names: {},
    published: Object.fromEntries(facets.languages.map((l) => [l.locale, l.locale !== "ar"])),
    marketCountries: null,
    job: null,
    facets,
    payoff: null,
    page: { cards: [], size: 0, matching: 0, from: 0, to: 0, nextCursor: null, isFirstPage: true },
    languages: null,
    ...extra,
  } as unknown as ReviewPageData;
}

const controls = (facets: Facets, query: ReviewQuery = QUERY) =>
  routed(
    createElement(ReviewControls, { data: pageData(facets), facets, query, actions: NO_ACTIONS, previewsFailed: false, i18n: en }),
    `http://localhost/app/review?lang=${query.locale ?? ""}`,
  );

describe("Review's languages", () => {
  it("are Content's chips with their counts: the current one in the chosen look, the others links named as they read", async () => {
    const html = await controls(FACETS);
    // The wide card's row wraps; a phone's swipes. Never the old grey tabs.
    expect(html).toContain('<nav aria-label="Languages"><ul class="lv-langs">');
    expect(html).toContain('<nav aria-label="Languages"><ul class="lv-langs lv-langs--swipe">');
    expect(html).not.toContain("lv-review-tabs");
    expect(html).not.toContain('background="strong"');
    expect(html.match(/<span class="lv-lang" aria-current="page">/g)).toHaveLength(2);
    expect(html).toMatch(/<span class="lv-lang" aria-current="page">.*?<strong class="lv-strong">German<\/strong>.*?>5<\/span><\/s-grid><\/span>/);
    // "All" first (no flag), the visible languages by name, the hidden one last, saying so.
    const names = [...html.matchAll(/<a class="lv-lang" href="([^"]*)"[^>]*><span class="lv-sr">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
    expect(names.slice(0, 3)).toEqual([
      ["/app/review", "All 9"],
      ["/app/review?lang=fr", "French 3"],
      ["/app/review?lang=ar", "Arabic hidden 1"],
    ]);
  });

  it("are one select above six languages that opens a language as soon as it is picked, Show only without scripts", async () => {
    const many: Facets = { ...FACETS, languages: ["de", "fr", "es", "it", "nl", "pt", "ja"].map((locale, i) => ({ locale, count: i + 1 })), total: 28 };
    const html = await controls(many);
    expect(html).not.toContain('class="lv-lang"');
    expect(html).toContain('<s-select name="lang" label="Language" value="de">');
    expect(html).toContain('<s-option value="de">German – 1 waiting</s-option>');
    // The kept filters go with the no-script form; its "Show" waits inside <noscript>.
    expect(html).toMatch(/<noscript>.*Show.*<\/noscript>/);
    expect(html).not.toMatch(/<\/noscript>[^]*?<s-button[^>]*type="submit"/);
  });
});

describe("Review's areas and notes", () => {
  it("are an area list's filter pills: the chosen one in the chosen look, the others links, never Polaris chips", async () => {
    const html = await controls(FACETS);
    expect(html).not.toMatch(/<s-chip|<s-clickable-chip/);
    expect(html).toContain('<nav aria-label="Areas" style="flex:0 1 auto;min-width:0"><ul class="lv-filters">');
    // A phone's row stays one line (it swipes).
    expect(html).toContain('<nav aria-label="Areas" style="flex:none"><ul class="lv-filters" style="flex-wrap:nowrap">');
    expect(html).toContain('<span class="lv-filter" aria-current="true">All areas 9</span>');
    expect(html).toMatch(/<a class="lv-filter" href="\/app\/review\?lang=de&amp;area=products"[^>]*><s-icon type="[a-z-]+" size="small"><\/s-icon>Products 6<\/a>/);
    expect(html).toMatch(/<a class="lv-filter" href="\/app\/review\?lang=de&amp;flagged=1"[^>]*><s-icon type="alert-triangle" size="small"><\/s-icon>With notes 2<\/a>/);
  });

  it("chosen, “With notes” is the way back to every text, named for what it does", async () => {
    const html = await controls(FACETS, { ...QUERY, flagged: true });
    expect(html).toContain('<a class="lv-filter" aria-current="true" aria-label="Remove filter: With notes 2" href="/app/review?lang=de"');
  });

  it("search as you type: a search landmark, no Search button", async () => {
    const html = await controls(FACETS);
    expect(html).toMatch(/<form method="get" action="[^"]*" role="search"[^>]*><input type="hidden" name="lang" value="de"\/><s-search-field name="q" label="Search"/);
    expect(html).not.toMatch(/lv-btn__label">Search</);
  });
});

describe("All reviewed", () => {
  it("links every language, visible ones first, without its figure or a bar", async () => {
    const empty: Facets = { total: 0, languages: [], areas: [], flagged: 0 };
    const data = pageData(empty, {
      published: { de: true, fr: false },
      languages: [
        { locale: "fr", percent: 12 },
        { locale: "de", percent: 40 },
      ],
    } as Partial<ReviewPageData>);
    const html = await routed(createElement(ReviewPage, { data }), "http://localhost/app/review");
    expect(html).toContain(">All reviewed</h2>");
    expect(html).toContain("Imports and AI translations that aren&#x27;t published automatically wait here until you approve them.");
    const tiles = [...html.matchAll(/<a class="lv-link-tile" href="([^"]*)"/g)].map((m) => m[1]);
    expect(tiles).toEqual(["/app/languages/de", "/app/languages/fr"]);
    // The least translated visible language is still the one way on.
    expect(html).toContain("Continue translating German");
    // No figure in the page's words (a style's 100% isn't one).
    expect(html).not.toMatch(/>[^<]*\d+\s?%[^<]*</);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("lv-review-tile__bar");
  });
});
