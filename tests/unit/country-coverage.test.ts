import { describe, expect, it } from "vitest";
import { countryLanguageGroups, localeKey } from "../../app/lib/country-languages";
import { analyzeCountries, countByStatus, missingLanguages, type MarketCountries } from "../../app/lib/country-coverage";
import { countryFlag } from "../../app/lib/flags";

describe("languages of a country", () => {
  it("uses CLDR's most likely language, as a storefront locale", () => {
    expect(countryLanguageGroups("CZ")).toEqual([["cs"]]);
    expect(countryLanguageGroups("HU")).toEqual([["hu"]]);
    expect(countryLanguageGroups("DE")).toEqual([["de"]]);
    expect(countryLanguageGroups("AT")).toEqual([["de"]]);
    expect(countryLanguageGroups("JP")).toEqual([["ja"]]);
    expect(countryLanguageGroups("BR")).toEqual([["pt-BR"]]);
    expect(countryLanguageGroups("PT")).toEqual([["pt-PT"]]);
    expect(countryLanguageGroups("CN")).toEqual([["zh-CN"]]);
    expect(countryLanguageGroups("TW")).toEqual([["zh-TW"]]);
    expect(countryLanguageGroups("NO")).toEqual([["nb"]]);
    expect(countryLanguageGroups("sa")).toEqual([["ar"]]);
  });

  it("knows countries with several regional languages and official second languages", () => {
    expect(countryLanguageGroups("CH")).toEqual([["de"], ["fr"], ["it"]]);
    expect(countryLanguageGroups("BE")).toEqual([["nl"], ["fr"]]);
    expect(countryLanguageGroups("CA")).toEqual([["en"], ["fr"]]);
    expect(countryLanguageGroups("LU")).toEqual([["fr", "de"]]);
    // Shops in Senegal are read in French, not in CLDR's most spoken Wolof.
    expect(countryLanguageGroups("SN")).toEqual([["fr"]]);
  });

  it("has nothing for unknown regions", () => {
    expect(countryLanguageGroups("ZZ")).toEqual([]);
    expect(countryLanguageGroups("not a code")).toEqual([]);
  });

  it("matches locales by language, Chinese by script", () => {
    expect(localeKey("pt-BR")).toBe(localeKey("pt-PT"));
    expect(localeKey("zh-TW")).not.toBe(localeKey("zh-CN"));
    expect(localeKey("zh-HK")).toBe(localeKey("zh-TW"));
    expect(localeKey("no")).toBe(localeKey("nb"));
    expect(localeKey("en-GB")).toBe("en");
  });

  it("draws a country's flag", () => {
    expect(countryFlag("cz")).toBe("🇨🇿");
    expect(countryFlag("XYZ")).toBe("");
  });
});

const market = (name: string, countries: string[], locales: MarketCountries["locales"], status = "ACTIVE"): MarketCountries => ({
  name,
  status,
  countries: countries.map((code) => ({ code, name: `Country ${code}` })),
  locales,
});
const offered = (...codes: string[]) => codes.map((locale) => ({ locale, published: true }));

// A German shop like KARINEX: German primary, French, Italian, English and Polish published.
const shop = { primary: "de", published: ["fr", "it", "en", "pl"] };

describe("countries the shop sells to", () => {
  it("finds countries without their language, partly covered ones and low coverage", () => {
    const rows = analyzeCountries(
      [market("EU", ["DE", "AT", "CZ", "HU", "PL", "CH", "BE", "FR"], null)],
      shop,
      new Map([
        ["fr", 80],
        ["it", 90],
        ["pl", 12],
      ]),
    );
    const status = Object.fromEntries(rows.map((r) => [r.code, r.status]));
    expect(status).toEqual({ CZ: "missing", HU: "missing", PL: "low", BE: "partial", AT: "ok", CH: "ok", DE: "ok", FR: "ok" });
    // Missing first, then low, partial and complete; by name within a status.
    expect(rows.map((r) => r.code)).toEqual(["CZ", "HU", "PL", "BE", "AT", "CH", "DE", "FR"]);
    // The primary language is the original: always complete.
    expect(rows.find((r) => r.code === "AT")).toMatchObject({ percent: 100, languages: [{ locale: "de", primary: true, available: true, percent: 100 }] });
    // Switzerland reads the lowest of its three languages.
    expect(rows.find((r) => r.code === "CH")?.percent).toBe(80);
    expect(rows.find((r) => r.code === "BE")?.languages).toEqual([
      { locale: "nl", available: false, reason: "not-added", primary: false, percent: null },
      { locale: "fr", available: true, primary: false, percent: 80 },
    ]);
  });

  it("uses only the languages a market's web presence offers and publishes, and says why one is missing", () => {
    const rows = analyzeCountries(
      [
        // France's market offers only German and English: French is published but not offered there.
        market("France", ["FR"], offered("de", "en")),
        // Italian is in the Italy market but hidden from customers.
        market("Italy", ["IT"], [{ locale: "de", published: true }, { locale: "it", published: false }]),
        market("Czechia", ["CZ"], offered("de")),
      ],
      { primary: "de", published: ["fr", "en"], enabled: ["fr", "en", "it"] },
      new Map(),
    );
    expect(rows.map((r) => [r.code, r.status, r.languages[0]!.reason])).toEqual([
      ["CZ", "missing", "not-added"],
      ["FR", "missing", "not-in-market"],
      ["IT", "missing", "unpublished"],
    ]);
    expect(missingLanguages(rows).map((g) => [g.locale, g.reason])).toEqual([
      ["cs", "not-added"],
      ["fr", "not-in-market"],
      ["it", "unpublished"],
    ]);
  });

  it("ignores draft markets and merges a country's markets", () => {
    const rows = analyzeCountries(
      [market("Draft", ["CZ"], null, "DRAFT"), market("A", ["FR"], offered("de")), market("B", ["FR"], offered("fr"))],
      shop,
      new Map([["fr", null]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "FR", status: "ok", markets: ["A", "B"], percent: null });
  });

  it("matches the shop's variant of a language", () => {
    const rows = analyzeCountries([market("World", ["BR", "TW"], null)], { primary: "en", published: ["pt-PT", "zh-CN"] }, new Map([["pt-PT", 70]]));
    expect(rows.find((r) => r.code === "BR")).toMatchObject({ status: "ok", languages: [{ locale: "pt-PT", available: true }], percent: 70 });
    // Simplified Chinese doesn't serve Taiwan (Traditional script).
    expect(rows.find((r) => r.code === "TW")?.status).toBe("missing");
  });

  it("lists the languages to add, with the countries they reach, most first", () => {
    const rows = analyzeCountries([market("World", ["CZ", "SA", "AE", "EG", "BE", "HU"], null)], shop, new Map());
    // The Emirates read English shops too: not missing Arabic.
    expect(missingLanguages(rows).map((g) => [g.locale, g.countries.map((c) => c.code)])).toEqual([
      ["ar", ["EG", "SA"]],
      ["cs", ["CZ"]],
      ["hu", ["HU"]],
      ["nl", ["BE"]],
    ]);
    expect(countByStatus(rows)).toEqual({ missing: 4, low: 0, partial: 1, ok: 1 });
  });
});
