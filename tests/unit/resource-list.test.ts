/**
 * The per-type list of other content (/app/content/<type>: menus, legal texts, the theme's parts …) as the
 * server renders it: it opens as every page does (PageHeader: the way back as a 44 px row on a phone, the
 * area's sign, the list's name), the languages as Content picks them (visible ones first, the current one
 * in the chosen look, a hidden one saying so, a select above six), the bulk card's options in one column,
 * rows that open as a whole and say their figure in words; and its counts leave the web address out, as
 * the editor and the area lists do. Products, collections, pages and blog posts have their area's list
 * only (the old /app/products … lead there). The browser behaviour is in tests/ui (content, i18n).
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ResourceList } from "../../app/components/ResourceList";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { listLanguage } from "../../app/lib/content-language";
import { summarizeCoverage } from "../../app/lib/coverage";

/** A menus list as resourceListPage returns it: German open, French hidden (Shopify's order: French first). */
function page(overrides: Record<string, unknown> = {}) {
  return {
    kind: { type: "MENU", label: "Menus", singular: "menu", plural: "menus", path: "/app/content/menus", caution: null, bulk: true },
    targets: [
      { locale: "fr", name: "French", published: false },
      { locale: "de", name: "German", published: true },
    ],
    target: { locale: "de", name: "German" },
    marketCountries: null,
    items: [
      { id: "2", title: "Main menu", total: 2, translated: 0, outdated: 0 },
      { id: "3", title: "Footer", total: 2, translated: 2, outdated: 0 },
    ],
    nextCursor: null,
    isFirstPage: true,
    bulk: { publishMode: "REVIEW", idempotencyKey: "test-run", available: true, consent: true, planAllowsBulk: true, planAllowsLocale: true, attached: false },
    denied: null,
    ...overrides,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale = "en"): Promise<string> {
  const handler = createStaticHandler([{ id: "list", path: "/app/content/menus", loader: () => data, Component: ResourceList }]);
  const context = await handler.query(new Request("http://localhost/app/content/menus?lang=de"));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

describe("a type's list", () => {
  it("opens as every page does (PageHeader): the way back (a back row on a phone), the area's sign and the list's name", async () => {
    const html = await render(page());
    expect(html).toContain('<s-clickable href="/app/content?lang=de" padding="small-200 none" minBlockSize="44px" borderRadius="base">');
    expect(html).toMatch(/<span class="lv-icon-square" data-tint="slate" aria-hidden="true"><s-icon type="menu"[^>]*><\/s-icon><\/span><s-stack direction="block" gap="small-500"><h1 class="lv-h1">Menus<\/h1>/);
  });

  it("shows the languages as Content picks them: visible ones first, the current one not a link, a hidden one saying so", async () => {
    const html = await render(page());
    expect(html).toContain('<span class="lv-lang" aria-current="page">');
    expect(html).toMatch(/<span class="lv-lang" aria-current="page">.*<strong class="lv-strong">German<\/strong>/);
    const links = [...html.matchAll(/<a class="lv-lang"([^>]*)><span class="lv-sr">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]!.trim()]);
    expect(links).toEqual([["French (hidden)", 'href="/app/content/menus?lang=fr" data-discover="true"']]);
    expect(html).toContain('<s-text color="subdued">hidden</s-text>');
    // The label without a colon, as Content's "Language".
    expect(html).toContain('<strong class="lv-strong">Translate into</strong>');
    // More than six: one select that opens the language at once ("Show" only without scripts).
    const many = ["da", "de", "es", "fi", "fr", "it", "nl"].map((locale) => ({ locale, name: locale, published: true }));
    const select = await render(page({ targets: many }));
    expect(select).toContain('<s-select name="lang" label="Translate into" value="de">');
    expect(select).toMatch(/<noscript>.*Show.*<\/noscript>/);
    expect(select).not.toContain('class="lv-lang"');
  });

  it("puts the bulk card's choice and its option in one column, the rule said once, in texts", async () => {
    const html = await render(page());
    expect(html).toContain("Fills in missing and outdated texts with AI, using your glossary and translation memory. Results wait in Review until you approve them.");
    expect(html).toContain('<s-option value="ALL">All texts</s-option>');
    expect(html).not.toMatch(/\bfields?\b/);
    expect(html).not.toContain("1fr 1fr");
    expect(html).toContain('<s-box maxInlineSize="400px"><s-select name="fieldScope" label="What to translate">');
    expect(html).toMatch(/<s-stack direction="block" gap="small-200"><s-checkbox name="overwriteProtected" [^>]*><\/s-checkbox><\/s-stack>/);
    expect(await render(page(), "de")).toContain("Füllt fehlende und veraltete Texte mit KI aus und nutzt dabei dein Glossar und deinen Übersetzungsspeicher.");
  });

  it("opens an item from its whole row and says the figure in words, as the area cards do", async () => {
    const html = await render(page());
    expect(html).toContain('<s-table-row clickDelegate="resource-row-2"><s-table-cell><s-link id="resource-row-2" href="/app/content/menus/2?lang=de">Main menu</s-link>');
    expect(html).toContain('<s-table-header format="numeric">Done</s-table-header>');
    expect(html).toContain("<s-table-cell>0 of 2 texts</s-table-cell>");
    expect(html).toContain("<s-table-cell>2 of 2 texts</s-table-cell>");
    expect(html).not.toMatch(/\d \/ \d/);
    const german = await render(page(), "de");
    expect(german).toContain('<s-table-header format="numeric">Fertig</s-table-header>');
    expect(german).toContain("<s-table-cell>0 von 2 Texten</s-table-cell>");
  });
});

describe("listLanguage", () => {
  const targets = [
    { locale: "ar", published: false },
    { locale: "fr", published: true },
    { locale: "de", published: true },
  ];

  it("opens ?lang when it is one of the store's additional languages, else the first visible one, else the first", () => {
    expect(listLanguage(targets, "de")?.locale).toBe("de");
    // A hidden language can still be opened on purpose.
    expect(listLanguage(targets, "ar")?.locale).toBe("ar");
    expect(listLanguage(targets, null)?.locale).toBe("fr");
    expect(listLanguage(targets, "xx")?.locale).toBe("fr");
    expect(listLanguage([targets[0]!], null)?.locale).toBe("ar");
    expect(listLanguage([], "de")).toBeUndefined();
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
