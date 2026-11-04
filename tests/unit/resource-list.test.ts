/**
 * The per-type list (/app/products, /app/content/<type>) as the server renders it: it opens as every
 * page does (the way back as a 44 px row on a phone, the area's sign, the list's name), the languages as
 * Content's chips (visible ones first, the current one in the chosen look, a hidden one saying so), the
 * bulk card's options in one column, rows that open as a whole and say their figure in words; and its
 * counts leave the web address out, as the editor and the area lists do. The browser behaviour is in
 * tests/ui (pages, content, states, i18n).
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ResourceList } from "../../app/components/ResourceList";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { summarizeCoverage } from "../../app/lib/coverage";

/** A products list as resourceListPage returns it: German open, French hidden (Shopify's order: French first). */
function page(overrides: Record<string, unknown> = {}) {
  return {
    kind: { type: "PRODUCT", label: "Products", singular: "product", plural: "products", path: "/app/products", caution: null, bulk: true },
    targets: [
      { locale: "fr", name: "French", published: false },
      { locale: "de", name: "German", published: true },
    ],
    target: { locale: "de", name: "German" },
    marketCountries: null,
    items: [
      { id: "2", title: "Product 2 jacket", total: 2, translated: 0, outdated: 0 },
      { id: "3", title: "Product 3 jacket", total: 2, translated: 2, outdated: 0 },
    ],
    nextCursor: null,
    isFirstPage: true,
    bulk: { publishMode: "REVIEW", idempotencyKey: "key-12345678", available: true, consent: true, planAllowsBulk: true, planAllowsLocale: true, attached: true },
    denied: null,
    ...overrides,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale = "en"): Promise<string> {
  const handler = createStaticHandler([{ id: "list", path: "/app/products", loader: () => data, Component: ResourceList }]);
  const context = await handler.query(new Request("http://localhost/app/products?lang=de"));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

describe("a type's list", () => {
  it("opens as every page does: the way back (a back row on a phone), the area's sign and the list's name", async () => {
    const html = await render(page());
    expect(html).toContain('<s-clickable href="/app/content?lang=de" padding="small-200 none" minBlockSize="44px" borderRadius="base">');
    expect(html).toMatch(/<span class="lv-icon-square" data-tint="blue" aria-hidden="true"><s-icon type="product"[^>]*><\/s-icon><\/span><h1 class="lv-h1">Products<\/h1>/);
  });

  it("shows the languages as Content's chips: visible ones first, the current one not a link, a hidden one saying so", async () => {
    const html = await render(page());
    const chips = [...html.matchAll(/<(span|a) class="lv-lang"([^>]*)><span class="lv-sr">([^<]+)<\/span>/g)].map((m) => [m[1], m[3], m[2]!.trim()]);
    expect(chips).toEqual([
      ["span", "German", 'aria-current="page"'],
      ["a", "French (hidden)", 'href="/app/products?lang=fr" data-discover="true"'],
    ]);
    expect(html).toContain('<s-text color="subdued">hidden</s-text>');
    // No badge for the current language, and the label without a colon, as Content's "Language".
    expect(html).not.toMatch(/<s-badge tone="info">German<\/s-badge>/);
    expect(html).toContain('<strong class="lv-strong">Translate into</strong>');
    // More than six: one select with "Show", as on Content.
    const many = ["da", "de", "es", "fi", "fr", "it", "nl"].map((locale) => ({ locale, name: locale, published: true }));
    const select = await render(page({ targets: many }));
    expect(select).toContain('<s-select name="lang" label="Translate into" value="de">');
    expect(select).not.toContain('class="lv-lang"');
  });

  it("puts the bulk card's choice and its two options in one column, the rule said once", async () => {
    const html = await render(page());
    expect(html).toContain("Fills in missing and outdated fields with AI, using your glossary and translation memory. Results wait in Review until you approve them.");
    expect(html).not.toContain("Up-to-date translations are never touched");
    expect(html).not.toContain("1fr 1fr");
    expect(html).toContain('<s-box maxInlineSize="400px"><s-select name="fieldScope" label="What to translate">');
    expect(html).toMatch(/<s-stack direction="block" gap="small-200"><s-checkbox name="overwriteProtected" [^>]*><\/s-checkbox><s-checkbox name="includeAttached" /);
    expect(await render(page(), "de")).toContain("Füllt fehlende und veraltete Felder mit KI aus und nutzt dabei dein Glossar und deinen Übersetzungsspeicher.");
  });

  it("opens an item from its whole row and says the figure in words, as the area cards do", async () => {
    const html = await render(page());
    // The editor it opens leads back here (from=list), not to the area list, which has no rows before the language is counted.
    expect(html).toContain('<s-table-row clickDelegate="resource-row-2"><s-table-cell><s-link id="resource-row-2" href="/app/products/2?lang=de&amp;from=list">Product 2 jacket</s-link>');
    expect(html).toContain('<s-table-header format="numeric">Done</s-table-header>');
    expect(html).toContain("<s-table-cell>0 of 2 texts</s-table-cell>");
    expect(html).toContain("<s-table-cell>2 of 2 texts</s-table-cell>");
    expect(html).not.toMatch(/\d \/ \d/);
    const german = await render(page(), "de");
    expect(german).toContain('<s-table-header format="numeric">Fertig</s-table-header>');
    expect(german).toContain("<s-table-cell>0 von 2 Texten</s-table-cell>");
  });
});

describe("summarizeCoverage", () => {
  const product = [
    { key: "title", value: "Product 2 jacket" },
    { key: "body_html", value: "<p>Warm.</p>" },
    { key: "handle", value: "product-2" },
    { key: "meta_title", value: "" },
  ];

  it("leaves the web address out, as the editor's count and the area lists do", () => {
    expect(summarizeCoverage(product, [])).toEqual({ total: 2, translated: 0, outdated: 0 });
    // A translated web address doesn't make the item done; its texts do.
    expect(summarizeCoverage(product, [{ key: "handle", value: "produkt-2", outdated: false }])).toEqual({ total: 2, translated: 0, outdated: 0 });
    expect(
      summarizeCoverage(product, [
        { key: "title", value: "Produkt 2 Jacke", outdated: false },
        { key: "body_html", value: "<p>Warm.</p>", outdated: true },
      ]),
    ).toEqual({ total: 2, translated: 1, outdated: 1 });
  });
});
