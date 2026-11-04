/**
 * The one language picker (app/components/LanguagePicker.tsx) and the one search field
 * (app/components/SearchField.tsx): Content's chips with the current language in the chosen look,
 * a select above six languages that opens the language at once ("Show" only without scripts), and
 * a search that runs while typing with no button, in a GET form that keeps the page's filters.
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { LanguagePicker, pickerLanguages, type PickerLanguage } from "../../app/components/LanguagePicker";
import { SEARCH_DELAY_MS, SEARCH_FROM, SearchField, SearchForm } from "../../app/components/SearchField";
import { translator } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { MAX_CHIPS } from "../../app/lib/content-language";

const en = translator("en");
const de = translator("de");

/** In a plain router: enough for links. */
const html = (node: ReactNode, location = "/app/content") => renderToStaticMarkup(createElement(StaticRouter, { location }, node));

/** In a data router: forms (React Router's Form submits through it). */
async function routed(node: ReactNode, url = "http://localhost/app/review?lang=de"): Promise<string> {
  const handler = createStaticHandler([{ id: "page", path: new URL(url).pathname, Component: () => node }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

const store = [
  { locale: "fr", name: "French", published: true, country: "FR" },
  { locale: "ar", name: "Arabic", published: false, country: null },
  { locale: "de", name: "German", published: true, country: "DE" },
];
const href = (l: { locale: string }) => `/app/content?lang=${l.locale}`;

describe("pickerLanguages", () => {
  it("orders the store's languages as Content does (visible ones by their name, hidden ones last) and names a hidden one so", () => {
    const languages = pickerLanguages(de, store, { href, country: (l) => l.country });
    expect(languages.map((l) => [l.value, l.name, l.label, l.hidden])).toEqual([
      ["de", "Deutsch", "Deutsch", false],
      ["fr", "Französisch", "Französisch", false],
      ["ar", "Arabisch", "Arabisch (versteckt)", true],
    ]);
    expect(languages.map((l) => l.href)).toEqual(["/app/content?lang=de", "/app/content?lang=fr", "/app/content?lang=ar"]);
    expect(languages.every((l) => l.figure === null)).toBe(true);
  });
});

describe("the language picker's chips", () => {
  const languages = pickerLanguages(en, store, { href, country: (l) => l.country });
  const chips = (props: Partial<ComponentProps<typeof LanguagePicker>> = {}) =>
    html(createElement(LanguagePicker, { languages, current: "de", i18n: en, label: "Language", navLabel: "Choose a language", ...props }));

  it("shows the current language in the chosen look, not as a link, and every other one as a link named for screen readers", () => {
    const markup = chips();
    expect(markup).toMatch(/^<nav aria-label="Choose a language"><ul class="lv-langs">/);
    expect(markup.match(/<li class="lv-langs__item">/g)).toHaveLength(3);
    expect(markup).toContain('<li class="lv-langs__item"><span class="lv-lang" aria-current="page"><s-grid gridTemplateColumns="auto minmax(0, 1fr)"');
    expect(markup).toContain('<strong class="lv-strong">German</strong>');
    expect(markup).toMatch(/<a class="lv-lang" href="\/app\/content\?lang=fr"[^>]*><span class="lv-sr">French<\/span><span aria-hidden="true">/);
    // A hidden language says so in words, under its name and in its link's name.
    expect(markup).toContain('<span class="lv-sr">Arabic (hidden)</span>');
    expect(markup).toContain('<s-icon type="hide" size="small" color="subdued"></s-icon>');
    expect(markup).not.toContain('href="/app/content?lang=de"');
    expect(markup).not.toContain("<s-select");
  });

  it("puts its label before the chips where the page has no heading for them, and swipes in one row on request", () => {
    expect(chips({ lead: true })).toMatch(/^<nav aria-label="Choose a language"><s-grid gridTemplateColumns="@container \(inline-size &gt; 640px\) auto 1fr, 1fr" gap="small-200 base" alignItems="center"><strong class="lv-strong">Language<\/strong><ul class="lv-langs">/);
    expect(chips({ swipe: true })).toContain('<ul class="lv-langs lv-langs--swipe">');
  });

  it("draws an entry without a flag (Review's 'All') and a figure after the name, semibold on the current one", () => {
    const tabs: PickerLanguage[] = [
      { value: "all", locale: null, country: null, name: "All", hidden: false, figure: "12", label: "All 12", href: "/app/review" },
      { value: "de", locale: "de", country: "DE", name: "German", hidden: false, figure: "5", label: "German 5", href: "/app/review?lang=de" },
    ];
    const markup = html(createElement(LanguagePicker, { languages: tabs, current: "all", i18n: en, label: "Language", navLabel: "Languages" }), "/app/review");
    expect(markup).toContain('<span class="lv-lang" aria-current="page"><s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="center"><s-stack direction="block">');
    expect(markup).toContain('<span class="lv-strong" style="line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap">12</span>');
    expect(markup).toContain('<s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">');
    expect(markup).toContain('<s-text color="subdued" fontVariantNumeric="tabular-nums">5</s-text>');
    expect(markup).toMatch(/<a class="lv-lang" href="\/app\/review\?lang=de"[^>]*><span class="lv-sr">German 5<\/span>/);
  });
});

describe("the language picker's select", () => {
  const many = (
    [
      ["da", "Danish"],
      ["de", "German"],
      ["es", "Spanish"],
      ["fi", "Finnish"],
      ["fr", "French"],
      ["it", "Italian"],
      ["nl", "Dutch"],
    ] as const
  ).map(([locale, name]) => ({ locale, name, published: locale !== "nl", country: null }));
  const languages = pickerLanguages(en, many, { href, country: (l) => l.country });

  it("takes over above six languages, opens the chosen one at once and offers 'Show' only without scripts", async () => {
    expect(languages.length).toBeGreaterThan(MAX_CHIPS);
    const markup = await routed(createElement(LanguagePicker, { languages, current: "de", i18n: en, label: "Language", navLabel: "Choose a language", fallback: { action: "/app/content" } }), "http://localhost/app/content?lang=de");
    expect(markup).not.toContain('class="lv-lang"');
    expect(markup).toMatch(/^<nav aria-label="Choose a language"><form method="get" action="\/app\/content"[^>]*><s-grid/);
    expect(markup).toContain('<s-select name="lang" label="Language" value="de">');
    expect(markup).toContain('<s-option value="nl">Dutch (hidden)</s-option>');
    // The button is inside <noscript>: a page with scripts never shows it.
    expect(markup).toMatch(/<\/s-select><noscript><button type="submit" [^>]*><span class="lv-btn__label">Show<\/span><\/button><\/noscript><\/s-grid><\/form><\/nav>$/);
  });

  it("keeps the page's filters in its form, says more in an option where the page asks, and has no form where none can open a language", async () => {
    const counted = languages.map((l) => ({ ...l, option: `${l.label} – 3 waiting` }));
    const kept = await routed(
      createElement(LanguagePicker, { languages: counted, current: "de", i18n: en, label: "Language", navLabel: "Languages", fallback: { keep: createElement("input", { type: "hidden", name: "area", value: "images" }) } }),
    );
    expect(kept).toContain('<input type="hidden" name="area" value="images"/><s-grid');
    expect(kept).toContain('<s-option value="fr">French – 3 waiting</s-option>');
    const bare = html(createElement(LanguagePicker, { languages, current: "de", i18n: en, label: "Language", navLabel: "Languages", fallback: null }));
    expect(bare).not.toContain("<form");
    expect(bare).not.toContain("<noscript");
    expect(bare).toContain('<s-select name="lang" label="Language" value="de">');
  });

  it("can be asked for by a page that counts its entries apart (Review's 'All')", () => {
    const two = languages.slice(0, 2);
    expect(html(createElement(LanguagePicker, { languages: two, current: "de", i18n: en, label: "Language", navLabel: "Languages", kind: "select", fallback: null }))).toContain("<s-select");
  });
});

describe("the search field", () => {
  it("runs while typing, from two characters on, after a short pause", () => {
    expect(SEARCH_DELAY_MS).toBe(350);
    expect(SEARCH_FROM).toBe(2);
  });

  it("is a GET search form with the filters it keeps and no button; its label for screen readers unless shown", async () => {
    const markup = await routed(
      createElement(SearchForm, { label: "Search", placeholder: "Title, original or translation", value: "jacket" }, createElement("input", { type: "hidden", name: "lang", value: "de" })),
    );
    // The form goes to the page itself (a GET form's own fields replace the address's query).
    expect(markup).toMatch(
      /^<form method="get" action="\/app\/review\?lang=de" role="search"[^>]*><input type="hidden" name="lang" value="de"\/><s-search-field name="q" label="Search" labelAccessibilityVisibility="exclusive" placeholder="Title, original or translation" value="jacket"><\/s-search-field><\/form>$/,
    );
    expect(markup).not.toMatch(/<button|<s-button/);
    const shown = await routed(createElement(SearchForm, { label: "Find a text", labelHidden: false, value: "", name: "find", action: "/app/products/1", accessibilityLabel: "Texts" }));
    expect(shown).toMatch(/^<form method="get" action="\/app\/products\/1" role="search" aria-label="Texts"[^>]*><s-search-field name="find" label="Find a text" value=""><\/s-search-field><\/form>$/);
  });

  it("goes into a form of the page's own", async () => {
    const markup = await routed(createElement("form", { method: "get" }, createElement(SearchField, { label: "Search jobs", value: "" }), createElement("s-select", { name: "lang" })));
    expect(markup).toBe('<form method="get"><s-search-field name="q" label="Search jobs" labelAccessibilityVisibility="exclusive" value=""></s-search-field><s-select name="lang"></s-select></form>');
  });
});
