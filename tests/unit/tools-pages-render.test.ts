/**
 * The tools pages (app/routes/app.coverage._index.tsx, app.coverage.items.tsx, app.glossary.tsx,
 * app.memory.tsx, app.markets.tsx, app.translations.tsx) rendered on the server with fictional loader data,
 * as the browser first receives them: Coverage picks its language with Content's chips (no figure on a chip;
 * the shown language's figure once, in its part of the card, no box inside the card) and calls the states
 * and a language's visibility as the language pages do; its cards side by side are each as tall as their
 * content; a job finding its texts says so with its own icon. Coverage by item and the memory search as you
 * type (no Search button); the glossary's rules are the app's option cards; Markets lists its markets one
 * after the other (no box in the card); "Import as drafts" is the import page's one primary button. (The
 * browser tests in tests/ui/coverage.spec.ts, tools.spec.ts and transfer.spec.ts check the same pages with
 * Polaris drawn.)
 */
import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import CoveragePage from "../../app/routes/app.coverage._index";
import CoverageItemsPage from "../../app/routes/app.coverage.items";
import GlossaryPage from "../../app/routes/app.glossary";
import MarketsPage from "../../app/routes/app.markets";
import MemoryPage from "../../app/routes/app.memory";
import TransferPage from "../../app/routes/app.translations";
import { I18nProvider } from "../../app/i18n/react";

// Only the pages' components run here (with the loaders' data given): Shopify's app isn't built.
vi.mock("../../app/shopify.server", () => ({ authenticate: {} }));

async function render(Component: ComponentType, path: string, data: unknown, url = `https://linguva.test${path}`) {
  const handler = createStaticHandler([{ id: "page", path, loader: () => data, Component }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(I18nProvider, { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })));
}

/** The part of the page from the section a heading names to its end. */
function section(html: string, heading: string): string {
  const at = html.indexOf(`>${heading}</h2>`);
  expect(at, heading).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<section", at);
  return html.slice(start, html.indexOf("</section>", at) + "</section>".length);
}

const segment = (locale: string) => ({ locale, resourceType: "PRODUCT", status: "SCANNED", scannedAt: "2026-11-01T08:00:00.000Z", errorCode: null, ahead: false });
const count = (locale: string, state: string, n: number, fieldGroup = "title") => ({ locale, resourceType: "PRODUCT", fieldGroup, state, count: n });

/** A counted store: French (shown) with drafts waiting, German partly outdated, Arabic hidden. */
function coverageData(extra: Record<string, unknown> = {}) {
  return {
    bulk: { publishMode: "DRAFT", aiRemaining: 100_000 },
    marketCountries: [],
    smart: null,
    shopName: "Test store",
    primary: { locale: "en", name: "English" },
    targets: [
      { locale: "fr", name: "French", published: true },
      { locale: "de", name: "German", published: true },
      { locale: "ar", name: "Arabic", published: false },
    ],
    names: { en: "English", fr: "French", de: "German", ar: "Arabic" },
    selected: "fr",
    markets: { available: false, list: [], selected: null },
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    jobsAvailable: true,
    canTranslate: true,
    ownKeyMissing: false,
    coverageTypes: ["PRODUCT"],
    lastFullScan: "2026-11-01T08:00:00.000Z",
    measured: ["fr", "de", "ar"],
    report: null,
    segments: [segment("fr"), segment("de"), segment("ar")],
    counts: [count("fr", "complete", 5), count("fr", "draft", 3), count("fr", "missing", 2, "description"), count("de", "complete", 8), count("de", "outdated", 2, "description"), count("ar", "missing", 10)],
    seo: { issues: [], duplicateTitles: {}, missingSourceTitle: [] },
    jobs: [],
    bulkTargets: { PRODUCT: { resourceType: "PRODUCT", includeAttached: false } },
    ...extra,
  };
}

const coverage = (data = coverageData()) => render(CoveragePage, "/app/coverage", data, "https://linguva.test/app/coverage?lang=fr");

describe("Coverage", () => {
  it("picks its language with Content's chips, no figure on a chip, the shown language's figure once in its part", async () => {
    const html = await coverage();
    const card = section(html, "Languages");
    expect(card).toContain('<nav aria-label="Choose a language">');
    expect(card).toContain('<span class="lv-lang" aria-current="page">');
    expect(card).toMatch(/<a class="lv-lang" href="\/app\/coverage\?lang=de"[^>]*><span class="lv-sr">German<\/span>/);
    expect(card).toMatch(/<a class="lv-lang" href="\/app\/coverage\?lang=ar"[^>]*><span class="lv-sr">Arabic \(hidden\)<\/span>/);
    const chips = card.slice(card.indexOf("<nav"), card.indexOf("</nav>"));
    expect(chips.replace(/<[^>]+>/g, " ")).not.toContain("%");
    // French: 5 of 10 texts done, said once in its part, right in the card (no box in the card).
    expect(card.match(/class="lv-figure"/g)).toHaveLength(1);
    expect(card).toContain('<span class="lv-figure">50%</span>');
    expect(card).toContain("5 of 10 texts");
    // The card's own edge is the one border in it.
    expect(card.match(/<s-box[^>]*border="base"/g)).toHaveLength(1);
    // A store whose markets change the languages keeps the market in the select's form without scripts.
    const many = coverageData({
      targets: ["fr", "de", "it", "es", "nl", "pt", "sv"].map((locale) => ({ locale, name: locale.toUpperCase(), published: true })),
      markets: { available: true, list: [{ id: "m1", name: "Europe" }, { id: "m2", name: "Asia" }], selected: "m1" },
    });
    const select = section(await coverage(many), "Languages");
    expect(select).toMatch(/<form method="get" action="\/app\/coverage"[^>]*><input type="hidden" name="market" value="m1"\/>/);
    expect(select).toContain('<s-select name="lang" label="Language" value="fr">');
    // There the part names the language and its visibility in the language page's words and look.
    expect(select).toContain('<s-badge tone="success" icon="check-circle">Visible</s-badge>');
  });

  it("calls the states as the language pages do: done, waiting for approval; visible languages", async () => {
    const html = await coverage();
    const store = section(html, "Whole store");
    expect(store).toContain("13 of 20 texts done in visible languages");
    expect(store).toContain("Done 13");
    expect(store).toContain("Waiting for approval 3");
    expect(html).not.toMatch(/Complete|Needs review|translated and live|Published/);
  });

  it("draws its cards side by side each as tall as its content, never stretched to the other", async () => {
    const html = await coverage();
    expect(html).toContain('<s-grid gridTemplateColumns="@container (inline-size &gt; 640px) 1fr 1fr, 1fr" gap="base" alignItems="start">');
    expect(html).not.toContain('style="display:grid"');
  });

  it("says a job is finding its texts with Jobs' icon and word, translating with its own, both in the info tone", async () => {
    const job = (id: string, discoveryDone: boolean) => ({ id, resourceType: "PRODUCT", locale: "fr", status: "RUNNING", done: 2, total: 10, percent: 20, discoveryDone, remainingMs: null });
    const html = await coverage(coverageData({ jobs: [job("j1", false), job("j2", true)] }));
    const jobs = section(html, "Running jobs");
    expect(jobs).toContain('<s-icon type="search-list" tone="info" size="small"></s-icon><s-text>Products → French: finding texts</s-text>');
    expect(jobs).toContain('<s-icon type="in-progress" tone="info" size="small"></s-icon><s-text>Products → French: 2 of 10</s-text>');
    expect(jobs).not.toContain('color="subdued" size="small"');
  });
});

describe("Coverage by item", () => {
  it("searches titles as you type in its filters' form, with no Search button", async () => {
    const data = {
      targets: [{ locale: "de", name: "German", published: true }],
      filter: { locale: "de", type: "PRODUCT", fieldGroup: null, state: "incomplete", search: "" },
      coverageTypes: ["PRODUCT"],
      searchable: true,
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
      jobsAvailable: true,
      canTranslate: true,
      ownKeyMissing: false,
      bulk: true,
      target: { resourceType: "PRODUCT", includeAttached: false },
      isFirstPage: true,
      searchUnavailable: false,
      nextCursor: null,
      items: [],
      smartNextCheck: null,
      smartZone: null,
      confirm: { publishMode: "DRAFT", aiRemaining: 1000, open: { missing: 1, outdated: 0, failed: 0 } },
      countedAt: null,
    };
    const html = await render(CoverageItemsPage, "/app/coverage/items", data, "https://linguva.test/app/coverage/items?lang=de&type=PRODUCT");
    expect(html).toMatch(/<form method="get" action="\/app\/coverage\/items\?[^"]*"[^>]*>[\s\S]*<s-search-field name="q" label="Search titles"/);
    expect(html).not.toMatch(/<span class="lv-btn__label">Search<\/span>/);
    expect(html).toContain('<s-option value="incomplete">Not done (all)</s-option>');
    expect(html).toContain("Translates missing, outdated and failed texts of Products into German.");
  });
});

describe("the glossary", () => {
  const data = (editable = true) => ({ editable, languages: [{ locale: "de", name: "German" }], markets: [], terms: [] });

  it("chooses its rule with the app's option cards: the chosen one marked, the others buttons, the form's field hidden", async () => {
    const html = await render(GlossaryPage, "/app/glossary", data());
    expect(html).toContain('<input type="hidden" name="rule" value="DO_NOT_TRANSLATE"/>');
    expect(html).toContain('<div role="group" aria-label="Rule" class="lv-options"');
    expect(html.match(/class="lv-option[ "]/g)).toHaveLength(3);
    expect(html).toMatch(/<div role="group" aria-labelledby="glossary-rule-DO_NOT_TRANSLATE" class="lv-option lv-option--current"[\s\S]*?Chosen<\/s-badge>/);
    expect(html.match(/<button type="button" class="lv-option__choose">/g)).toHaveLength(2);
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("Words AI always handles the same way.");
  });

  it("offers no rule to choose on a plan without the glossary, the chosen one still marked", async () => {
    const html = await render(GlossaryPage, "/app/glossary", data(false));
    expect(html).not.toContain('class="lv-option__choose"');
    expect(html).toContain("Chosen</s-badge>");
  });
});

describe("the memory", () => {
  it("searches as you type beside the language, with no Search button", async () => {
    const data = {
      languages: [{ locale: "de", name: "German" }],
      names: { en: "English", de: "German" },
      marketCountries: [],
      search: "",
      targetLocale: "",
      entriesTotal: 1,
      usesTotal: 2,
      inFilter: 1,
      more: false,
      entries: [{ id: "e1", sourceLocale: "en", targetLocale: "de", source: "Warm jacket", target: "Warme Jacke", status: "APPROVED", uses: 2 }],
    };
    const html = await render(MemoryPage, "/app/memory", data);
    expect(html).toMatch(/<form method="get" action="\/app\/memory" role="search" aria-label="Translation memory"[^>]*>[\s\S]*<s-search-field name="q" label="Search"/);
    expect(html).not.toMatch(/<span class="lv-btn__label">Search<\/span>/);
    expect(html).toContain("Linguva reuses every translation you publish for the same text, without AI.");
  });
});

describe("Countries & markets", () => {
  it("lists its markets one after the other, a line between them, each language visible or hidden as on its page", async () => {
    const presence = (id: string, locale: string, published: boolean) => ({
      id,
      host: `${id}.example`,
      defaultLocale: { locale: "en", name: "English", published: true },
      alternateLocales: [{ locale, name: locale.toUpperCase(), published }],
      rootUrls: [],
    });
    const data = {
      access: true,
      markets: [
        { id: "m1", name: "Europe", status: "ACTIVE", webPresences: [presence("eu", "de", true)] },
        { id: "m2", name: "Asia", status: "DRAFT", webPresences: [presence("as", "ja", false)] },
      ],
      names: { en: "English", de: "German", ja: "Japanese" },
      findings: [],
      countries: [],
      measured: false,
    };
    const html = await render(MarketsPage, "/app/markets", data);
    const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(details).not.toMatch(/<s-box[^>]*border=/);
    expect(details.match(/<s-divider><\/s-divider>/g)).toHaveLength(1);
    expect(details).toContain('<s-badge tone="success" icon="check-circle">Visible</s-badge>');
    expect(details).toContain('<s-badge icon="hide">Hidden</s-badge>');
    expect(html).toContain("Every visible language is offered in a market.");
  });
});

describe("Import & export", () => {
  it("has one primary button, the import's, waiting for a file; exporting is a secondary button", async () => {
    const html = await render(TransferPage, "/app/translations", { targets: [{ locale: "de", name: "German" }], types: ["PRODUCT"] });
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="submit" class="lv-btn lv-btn--primary"[^>]*data-variant="primary"[^>]*disabled=""[^>]*>[\s\S]*?Import as drafts/);
    expect(html).toMatch(/data-variant="secondary"[^>]*>[\s\S]*?Export CSV/);
  });
});
