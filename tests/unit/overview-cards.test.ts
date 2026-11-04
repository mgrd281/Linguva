/**
 * The Overview's country and language cards (app/components/CountryCards.tsx)
 * and its Countries | Languages switch (SegmentedButtons in
 * app/components/Segmented.tsx), rendered on the server: one badge with its
 * icon per language state, semibold names, cards that keep their edge on a
 * phone, Shopify's language settings opened once per page, and a switch of
 * pressed buttons in a named group.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardGrid } from "../../app/components/CategoryCard";
import { CountryCards, LanguageCards, placeGrid, type PlaceLanguage } from "../../app/components/CountryCards";
import { SegmentedButtons } from "../../app/components/Segmented";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import type { CountryCoverage, CountryLanguage } from "../../app/lib/country-coverage";

const counts = { complete: 34, review: 0, draft: 6, failed: 0, outdated: 1, missing: 59 };

/** German is published and counted, French is hidden, Spanish isn't offered in its market. */
const LANGUAGES: PlaceLanguage[] = [
  { locale: "de", name: "German", published: true, measured: true, partial: false, unchecked: 0, counts, complete: 34, total: 100 },
  { locale: "fr", name: "French", published: false, measured: true, partial: false, unchecked: 0, counts, complete: 34, total: 100 },
  { locale: "es", name: "Spanish", published: true, measured: true, partial: false, unchecked: 0, counts, complete: 34, total: 100 },
];

const language = (locale: string, extra: Partial<CountryLanguage> = {}): CountryLanguage => ({ locale, available: true, primary: false, percent: 34, ...extra });
const country = (code: string, name: string, languages: CountryLanguage[]): CountryCoverage => ({
  code,
  name,
  markets: ["Europe"],
  status: "partial",
  languages,
  percent: languages.some((l) => l.available && !l.primary) ? 34 : null,
});

const COUNTRIES: CountryCoverage[] = [
  // Several languages: the original, one the store has, a hidden one and one it hasn't added.
  country("CH", "Switzerland", [language("de"), language("fr", { available: false, reason: "unpublished" }), language("it", { available: false, reason: "not-added", percent: null })]),
  country("CA", "Canada", [language("en", { primary: true, percent: 100 }), language("es", { available: false, reason: "not-in-market" })]),
  country("DE", "Germany", [language("de")]),
  country("CZ", "Czechia", [language("cs", { available: false, reason: "not-added", percent: null })]),
  country("HU", "Hungary", [language("hu", { available: false, reason: "not-added", percent: null })]),
  country("ES", "Spain", [language("es", { available: false, reason: "not-in-market" })]),
  country("US", "United States", [language("en", { primary: true, percent: 100 })]),
];

function countryCards(options: { offered?: boolean; locale?: AppLocale } = {}) {
  return renderToStaticMarkup(
    createElement(CountryCards, {
      i18n: translator(options.locale ?? "en"),
      languages: LANGUAGES,
      running: new Map(),
      primary: "English",
      countries: COUNTRIES,
      freeLanguages: 1,
      maxLanguages: 20,
      ...(options.offered !== undefined ? { languageFixOffered: options.offered } : {}),
    }),
  );
}

/** Every badge as "icon:words", in document order. */
const badges = (html: string) => [...html.matchAll(/<s-badge([^>]*)>([^<]*)<\/s-badge>/g)].map((m) => `${/icon="([^"]+)"/.exec(m[1]!)?.[1] ?? "none"}:${m[2]}`);

describe("CountryCards", () => {
  it("draws each language state as one badge with its icon, never as grey words", () => {
    const html = countryCards();
    expect(badges(html)).toEqual([
      "alert-triangle:No language of their own",
      // Switzerland: French hidden, Italian not set up.
      "hide:Hidden",
      "minus-circle:Not set up",
      // Canada: English is the original, Spanish isn't offered there.
      "check-circle:Original",
      "disabled:Not offered",
      // Spain's row, then the United States reading the original.
      "disabled:Not offered",
      "check-circle:Original",
    ]);
    expect(html).not.toContain("not offered there");
    expect(html).not.toMatch(/<s-text color="subdued">not set up<\/s-text>/);
  });

  it("sets every country and language name in semibold, and says how many languages a country reads", () => {
    const html = countryCards();
    for (const name of ["Switzerland", "Canada", "Germany", "Czechia", "Spain", "United States", "German", "French", "Italian", "English"]) {
      expect(html).toContain(`<strong class="lv-strong">${name}</strong>`);
    }
    expect(html).not.toContain('type="strong"');
    expect(html).toContain("Customers there read 3 languages");
    expect(html).toContain("Customers there read 2 languages");
  });

  it("keeps every card's edge on a phone: cards are bordered boxes, never Polaris' flat sections", () => {
    const html = countryCards();
    expect(html).not.toContain("<s-section");
    expect(html).toContain('<section aria-label="Switzerland">');
    expect(html).toContain('<section aria-label="No language of their own">');
    expect(html.match(/<s-clickable href="\/app\/languages\/de" background="base" border="base" borderRadius="large-100"/g)).toHaveLength(1);
  });

  it("offers Shopify's language settings with its icon, unless the next step already does", () => {
    const button = /<a href="shopify:\/\/admin\/settings\/languages"[^>]*data-button=""[^>]*>.*?Open language settings/;
    expect(countryCards()).toMatch(button);
    expect(countryCards()).toContain('<s-icon type="language" size="small">');
    // One free place for two wanted languages: the limit is said beside the button.
    expect(countryCards()).toContain("you can add 1 more.");
    const offered = countryCards({ offered: true });
    expect(offered).not.toMatch(button);
    expect(offered).not.toContain("you can add 1 more.");
    // The countries are still named.
    expect(offered).toContain("Czechia");
  });

  it("renders in every interface language without a missing text", () => {
    for (const locale of APP_LOCALES) expect(countryCards({ locale }), locale).not.toMatch(/overview\.|language\.(hidden|hero)/);
    expect(countryCards({ locale: "de" })).toContain("Kunden dort lesen 3 Sprachen");
    expect(badges(countryCards({ locale: "de" }))).toContain("minus-circle:Nicht eingerichtet");
  });
});

describe("LanguageCards", () => {
  it("marks a hidden language with its badge and names it in semibold", () => {
    const html = renderToStaticMarkup(
      createElement(LanguageCards, { i18n: translator("en"), languages: LANGUAGES, running: new Map(), primary: "English", countriesOf: new Map(), marketCountries: [] }),
    );
    expect(badges(html)).toEqual(["hide:Hidden"]);
    expect(html).toContain('<strong class="lv-strong">French</strong>');
  });

  it("fills its rows as Content's and a language's cards do: one the full width, two side by side, three in a row", () => {
    const columns = (languages: PlaceLanguage[]) =>
      /^<s-grid gridTemplateColumns="([^"]*)"/.exec(
        renderToStaticMarkup(createElement(LanguageCards, { i18n: translator("en"), languages, running: new Map(), primary: "English", countriesOf: new Map(), marketCountries: [] })),
      )?.[1];
    expect(columns(LANGUAGES.slice(0, 1))).toBe("1fr");
    // Never two cards beside an empty third column.
    expect(columns(LANGUAGES.slice(0, 2))).toBe("@container (inline-size &gt; 560px) 1fr 1fr, 1fr");
    expect(columns(LANGUAGES)).toBe("@container (inline-size &gt; 860px) 1fr 1fr 1fr, 1fr");
    // The countries' cards too: Switzerland, Canada and Germany.
    expect(countryCards()).toContain('<s-grid gridTemplateColumns="@container (inline-size &gt; 860px) 1fr 1fr 1fr, 1fr"');
  });

  it("keeps three in a row on a wide page from five cards, so many countries don't make the page half as long again", () => {
    for (const count of [1, 2, 3, 4]) expect(placeGrid(count), String(count)).toBe(cardGrid(count));
    for (const count of [5, 8, 28]) expect(placeGrid(count), String(count)).toBe("@container (inline-size > 560px) 1fr 1fr, (inline-size > 860px) 1fr 1fr 1fr, 1fr");
  });
});

describe("SegmentedButtons", () => {
  const OPTIONS = [
    { value: "countries", label: "Countries", icon: "globe" },
    { value: "languages", label: "Languages", icon: "language" },
  ] as const;

  it("is a named group of pressed buttons in the segmented choice's look, each with its icon", () => {
    const html = renderToStaticMarkup(createElement(SegmentedButtons<"countries" | "languages">, { label: "Show by", options: OPTIONS, value: "countries", onChange: () => {} }));
    expect(html).toMatch(/^<div role="group" aria-label="Show by" class="lv-seg lv-seg--buttons">/);
    expect(html.match(/<button type="button" class="lv-seg__text" aria-pressed="(true|false)">/g)).toEqual([
      '<button type="button" class="lv-seg__text" aria-pressed="true">',
      '<button type="button" class="lv-seg__text" aria-pressed="false">',
    ]);
    // The icons are decorative: each button is named by its words.
    expect(html).toContain('<span class="lv-seg__icon" aria-hidden="true"><s-icon type="globe" size="small"></s-icon></span>Countries');
    expect(html).toContain('<span class="lv-seg__icon" aria-hidden="true"><s-icon type="language" size="small"></s-icon></span>Languages');
  });
});
