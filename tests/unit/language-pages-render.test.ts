/**
 * A language's page and one of its areas (app/routes/app.languages_.$locale.tsx and
 * app.languages_.$locale_.$category.tsx) rendered on the server with fictional loader data, as the
 * browser first receives them: both open with the app's one header (PageHeader: the language's flag or
 * the area's icon as the sign, the badge beside the heading, the trail); "Translate" is there once per
 * area (the language page's step; its cards lead to their lists); the area page switches languages with
 * Content's chips, keeps the same area, says its figure once (texts, not a second line in products) and
 * searches as you type. (The browser tests in tests/ui/language-page.spec.ts and category-list.spec.ts
 * check the same pages with Polaris drawn.)
 */
import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import LanguagePage from "../../app/routes/app.languages_.$locale";
import CategoryPage from "../../app/routes/app.languages_.$locale_.$category";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { emptyCounts, type StateCounts } from "../../app/lib/coverage-rules";
import { tally } from "../../app/lib/coverage-view";

// Only the pages' components run here (with the loaders' data given): Shopify's app isn't built.
vi.mock("../../app/shopify.server", () => ({ authenticate: {} }));

const counts = (extra: Partial<StateCounts>): StateCounts => ({ ...emptyCounts(), ...extra });
const STORE_LANGUAGES = [
  { locale: "de", name: "German", published: true },
  { locale: "fr", name: "French", published: true },
  { locale: "ar", name: "Arabic", published: false },
];
const estimate = { types: ["PRODUCT"], texts: { missing: 9, outdated: 1, failed: 0 }, items: 6, chars: 1200, attached: true };

/** German in a store with products: 3 of 13 texts done, products to translate. */
function languageData(extra: Record<string, unknown> = {}) {
  const products = tally(counts({ complete: 3, outdated: 1, missing: 9 }));
  return {
    language: { locale: "de", name: "German", published: true, rtl: false },
    primary: { locale: "en", name: "English" },
    countries: [{ code: "DE", name: "Germany" }],
    marketCountries: ["DE"],
    measuredAt: "2026-10-30T00:53:00.000Z",
    measured: true,
    measurement: { state: "done", done: 0, total: 0, since: null },
    scanning: false,
    canCount: true,
    activeJobs: 0,
    headline: products,
    steps: { open: 10, waiting: 0, live: 3 },
    payoff: null,
    categories: [
      {
        id: "products",
        tier: "first",
        href: "/app/languages/de/products",
        tally: products,
        textTypes: ["PRODUCT"],
        state: { kind: "ok" },
        items: 6,
        review: null,
        job: null,
        bulk: estimate,
        automatic: false,
      },
    ],
    extras: [],
    next: [{ kind: "category", category: "products", missing: 9, outdated: 1, failed: 0, attached: { images: 2, customFields: 0 }, action: "translate", href: "/app/languages/de/products" }],
    bulk: { gate: null, publishMode: "DRAFT", aiRemaining: 100_000 },
    smart: null,
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    ...extra,
  };
}

/** German products, item by item: the same figure, two items. */
function areaData(extra: Record<string, unknown> = {}) {
  const row = (n: number, state: "missing" | "complete") => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    type: "PRODUCT",
    reference: String(n),
    state,
    texts: [{ group: "title", state }],
    counts: { total: 1, done: state === "complete" ? 1 : 0 },
    failureCode: null,
    href: `/app/products/${n}?lang=de`,
    smart: null,
    title: `Product ${n} jacket`,
    translated: state === "complete" ? `Jacke ${n}` : null,
    label: null,
    image: null,
  });
  return {
    language: { locale: "de", name: "German", published: true, rtl: false },
    primary: { locale: "en", name: "English" },
    languages: STORE_LANGUAGES,
    countries: [],
    marketCountries: [],
    measured: true,
    measurement: { state: "done", done: 0, total: 0, since: null },
    scanning: false,
    canCount: true,
    category: { id: "products", tier: "first", state: { kind: "ok" }, tally: tally(counts({ complete: 1, missing: 1 })), payoff: null, review: null, job: null, searchable: true },
    filter: { state: "all", q: "" },
    counts: { all: 2, failed: 0, outdated: 0, missing: 1, waiting: 0, complete: 1 },
    rows: [row(1, "missing"), row(2, "complete")],
    page: { from: 1, to: 2, total: 2, number: 1, nextCursor: null },
    titlesUnavailable: false,
    bulk: { estimate, gate: null, publishMode: "DRAFT", aiRemaining: 100_000, owners: [] },
    smart: null,
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    ...extra,
  };
}

async function render(Component: ComponentType, path: string, data: Record<string, unknown>, url = `https://linguva.test${path}`, locale: AppLocale = "en") {
  const handler = createStaticHandler([{ id: "page", path, loader: () => data, Component }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })));
}

const language = (data = languageData(), url?: string) => render(LanguagePage, "/app/languages/:locale", data, url ?? "https://linguva.test/app/languages/de");
const area = (data = areaData(), url?: string) => render(CategoryPage, "/app/languages/:locale/:category", data, url ?? "https://linguva.test/app/languages/de/products");

describe("a language's page", () => {
  it("opens with the app's one header: the flag as its sign, Visible beside the heading, the trail", async () => {
    const html = await language();
    expect(html).toMatch(/^<s-page heading="German">/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<div class="lv-page-head"><s-grid gridTemplateColumns="auto minmax\(0, 1fr\)" gap="base" alignItems="center"><span aria-hidden="true" style="[^"]*width:40px/);
    expect(html).toContain('<s-stack direction="inline" gap="small-200" alignItems="center"><h1 class="lv-h1">German</h1><s-badge tone="success" icon="check-circle">Visible</s-badge></s-stack>');
    expect(html).toContain('<s-link href="/app">Overview</s-link>');
    // A hidden language: the same badge look as Coverage's, and the way to publish it.
    const hidden = await language(languageData({ language: { locale: "de", name: "German", published: false, rtl: false } }));
    expect(hidden).toContain('<h1 class="lv-h1">German</h1><s-badge icon="hide">Hidden</s-badge>');
    expect(hidden).toContain("Customers can&#x27;t choose this language yet.");
  });

  it("says its figure once in its hero (texts done), without a second sentence the words at the end say", async () => {
    const html = await language();
    expect(html).toContain('<h2 class="lv-h2">3 of 13 texts done</h2>');
    expect(html).not.toContain("done and live");
    expect(html).not.toContain("Where nothing is translated yet");
  });

  it("has Translate once per area: the next step's; the area's card leads to its list", async () => {
    const html = await language();
    expect(html.match(/accessibilityLabel="Translate: Products"/g) ?? html.match(/aria-label="Translate: Products"/g)).toHaveLength(1);
    const card = html.slice(html.indexOf('<section aria-labelledby="area-products"'));
    expect(card).toContain("View all 6");
    expect(card.slice(0, card.indexOf("</section>"))).not.toContain("Translate");
  });
});

describe("an area's page", () => {
  it("opens with the app's one header: the area's icon square as its sign, its trail ending in the area", async () => {
    const html = await area();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="lv-icon-square" data-tint="blue" aria-hidden="true"><s-icon type="product"[^>]*><\/s-icon><\/span><s-stack direction="block" gap="small-500"><h1 class="lv-h1">Products in German<\/h1>/);
    expect(html).toContain('<s-link href="/app/languages/de">German</s-link>');
    expect(html).toContain('<span aria-current="page"><s-text color="subdued">Products</s-text></span>');
  });

  it("switches to the same area in another language with Content's chips, keeping where it was opened from", async () => {
    const html = await area(areaData(), "https://linguva.test/app/languages/de/products?from=content");
    expect(html).toContain('<nav aria-label="Choose a language">');
    expect(html).toContain('<span class="lv-lang" aria-current="page">');
    expect(html).toMatch(/<a class="lv-lang" href="\/app\/languages\/fr\/products\?from=content"[^>]*><span class="lv-sr">French<\/span>/);
    expect(html).toMatch(/<a class="lv-lang" href="\/app\/languages\/ar\/products\?from=content"[^>]*><span class="lv-sr">Arabic \(hidden\)<\/span>/);
    // No figure on a chip, and no GET form (the language is in the address's path).
    const picker = html.slice(html.indexOf('<nav aria-label="Choose a language">'));
    const chips = picker.slice(0, picker.indexOf("</nav>"));
    expect(chips).not.toContain("<form");
    expect(chips.replace(/<[^>]+>/g, " ")).not.toContain("%");
    // One language: nothing to switch.
    expect(await area(areaData({ languages: STORE_LANGUAGES.slice(0, 1) }))).not.toContain('<nav aria-label="Choose a language">');
  });

  it("says its figure once: texts done and each state, no second line in products", async () => {
    const html = await area();
    expect(html).toContain('<h2 class="lv-h2">1 of 2 texts done</h2>');
    expect(html).not.toContain("Fully done");
    // The step's one Translate; what stays is said in the dialog.
    expect(html).not.toContain("Your own translations stay.</s-text>");
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
  });

  it("searches by name as you type, with no Search button", async () => {
    const html = await area();
    expect(html).toMatch(/<form method="get" action="\/app\/languages\/de\/products" role="search"[^>]*><s-search-field name="q" label="Search by name"/);
    expect(html).not.toMatch(/<button type="submit"[^>]*><span class="lv-btn__label">Search<\/span>/);
  });
});
