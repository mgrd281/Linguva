/**
 * Interface languages: language choice, catalogues complete and consistent
 * (same keys, same placeholders, actually translated), formatting
 * that is the same on server and browser.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDateTimeIn, formatDayMonth, formatMonth, formatNumber, languageName, resolveLocale, translate, translator } from "../../app/i18n/i18n";
import { MESSAGES, NAMESPACES, type Message } from "../../app/i18n/messages";
import { fieldName, issueName, jobStatus, kindLabel } from "../../app/i18n/labels";

const placeholders = (m: Message) =>
  [...new Set((typeof m === "string" ? [m] : [m.one, m.other]).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort();

// Words that are the same in English and German, French or Spanish.
const SAME_IN_BOTH = new Set([
  ...["Original", "{language}:", "{type} {reference}", "{state}: {fields}", "{language}: {countries}", "Status", "Name", "Blogs", "Blog", "Theme", "Themes", "Navigation", "Checkout", "Filter", "Linguva", "SEO", "Shopify", "DeepL", "OK", "Business", "Budgets", "{time} ({zone})", "—", "Region {region}"],
  ...["{language} · {kind}", "{name}: {reason}", "{figure} {caption}. {title}. {states}.", "Version {commit}"],
]);
const SAME_IN_FRENCH = new Set([
  ...["Blogs", "Blog", "blogs", "blog", "Collections", "collection", "collections", "Pages", "page", "pages", "Menus", "menu", "menus"],
  ...["Navigation", "Notifications", "Description", "Descriptions", "Image", "Menu", "Action", "Actions", "Type", "Original", "ID", "Linguva", "SEO", "Shopify", "DeepL", "OK"],
  ...["{language} (original)", "{title}, {field}, original", "{language} · original", "{type} {reference}", "Business", "Budgets", "Exclusions", "{time} ({zone})", "—", "Page {page}", "Version {commit}"],
  ...["{language} · {kind}", "{figure} {caption}. {title}. {states}."],
]);
const SAME_IN_SPANISH = new Set([
  ...["Blogs", "Blog", "blogs", "blog", "Plan", "Manual", "Original", "Formal", "Informal", "Formal ({pronoun})", "Informal ({pronoun})", "No", "no", "ID", "Linguva", "SEO", "Shopify", "DeepL", "OK"],
  ...["{language} (original)", "{title}, {field}, original", "{language} · original", "{language}:", "{type} {reference}", "{state}: {fields}", "{language}: {countries}", "Business", "{time} ({zone})", "—"],
  ...["{language} · {kind}", "{name}: {reason}", "{figure} {caption}. {title}. {states}."],
]);

describe("interface language", () => {
  it("follows Shopify's locale parameter, then the browser's languages, else English", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("de-CH")).toBe("de");
    expect(resolveLocale("en-GB", "de")).toBe("en");
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("it", "it-IT,es;q=0.8,en;q=0.5")).toBe("es");
    expect(resolveLocale(null, "en;q=0.4,de;q=0.9")).toBe("de");
    expect(resolveLocale(null, "ja-JP")).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale("<script>", "de;q=0")).toBe("en");
  });

  it("fills placeholders, formats numbers for the language and picks plural forms", () => {
    expect(translate("en", "jobs.problems.attempts", { count: 1 })).toBe("1 attempt");
    expect(translate("en", "jobs.problems.attempts", { count: 1200 })).toBe("1,200 attempts");
    expect(translate("de", "jobs.problems.attempts", { count: 1 })).toBe("1 Versuch");
    expect(translate("de", "jobs.problems.attempts", { count: 1200 })).toBe("1.200 Versuche");
    expect(formatNumber("de", 1234567)).toBe("1.234.567");
  });

  it("formats dates in UTC without the store's zone, so server and browser render the same text", () => {
    expect(formatDate("de", "2026-10-27T23:30:00Z")).toBe("27. Oktober 2026");
    expect(formatDate("en", "2026-10-27T23:30:00Z")).toBe("October 27, 2026");
    expect(formatDateTime("de", "2026-10-27T23:30:00Z")).toBe("27.10.2026, 23:30 UTC");
    expect(formatMonth("de", "2026-10")).toBe("Oktober 2026");
    expect(formatDate("en", "not a date")).toBe("");
  });

  it("formats instants in the store's zone when it is known, naming UTC only for UTC (D1)", () => {
    expect(formatDateTime("de", "2026-10-27T23:30:00Z", "Europe/Berlin")).toBe("28.10.2026, 00:30");
    expect(formatDateTime("de", "2026-10-27T23:30:00Z", "America/New_York")).toBe("27.10.2026, 19:30");
    expect(formatDateTime("en", "2026-10-27T23:30:00Z", "America/New_York")).toBe("Oct 27, 2026, 7:30 PM");
    expect(formatDateTime("de", "2026-10-27T23:30:00Z", "UTC")).toBe("27.10.2026, 23:30 UTC");
    expect(translator("de", { timeZone: "Europe/Berlin" }).dateTime("2026-10-27T23:30:00Z")).toBe("28.10.2026, 00:30");
    expect(translator("de").dateTime("2026-10-27T23:30:00Z")).toBe("27.10.2026, 23:30 UTC");
  });

  it("writes times on the interface language's clock: 12-hour in English, 24-hour otherwise (D1b)", () => {
    expect(formatDateTimeIn("en", "2026-10-29T22:00:00Z", "Europe/Berlin")).toBe("Thu, Oct 29, 11:00 PM");
    expect(formatDateTimeIn("de", "2026-10-29T22:00:00Z", "Europe/Berlin")).toBe("Do., 29. Okt., 23:00");
    expect(translator("en").clock(1380)).toBe("11:00 PM");
    expect(translator("de").clock(1380)).toBe("23:00");
  });

  it("names a day and month, with the year only when it isn't this year's (in UTC)", () => {
    const now = "2026-10-30T09:00:00Z";
    expect(formatDayMonth("de", "2026-11-01T00:00:00Z", now)).toBe("1. November");
    expect(formatDayMonth("en", "2026-11-01T00:00:00Z", now)).toBe("November 1");
    expect(formatDayMonth("de", "2027-01-01T00:00:00Z", now)).toBe("1. Januar 2027");
    expect(formatDayMonth("en", "2027-01-01T00:00:00Z", now)).toBe("January 1, 2027");
    // 23:30 UTC on the 31st is still the 31st, whatever the server's zone.
    expect(formatDayMonth("de", "2026-10-31T23:30:00Z", now)).toBe("31. Oktober");
    expect(translator("fr").dayMonth("2026-11-05T00:00:00Z", now)).toBe("5 novembre");
    expect(formatDayMonth("de", "not a date", now)).toBe("");
  });

  it("has complete German, French and Spanish catalogues: same keys, same placeholders, same plural forms", () => {
    for (const locale of ["de", "fr", "es"] as const) {
      for (const [name, ns] of Object.entries(NAMESPACES)) {
        const catalogue = ns[locale] as Record<string, Message>;
        expect(Object.keys(catalogue).sort(), `${locale} ${name}`).toEqual(Object.keys(ns.en).sort());
        for (const [key, en] of Object.entries(ns.en) as Array<[string, Message]>) {
          const translated = catalogue[key]!;
          expect(typeof translated, `${locale} ${key}`).toBe(typeof en);
          if (typeof en !== "string") expect(Object.keys(translated).sort(), `${locale} ${key}`).toEqual(["one", "other"]);
          expect(placeholders(translated), `${locale} ${key}`).toEqual(placeholders(en));
        }
      }
    }
  });

  it("uses no irregular whitespace (the linter's rule) in any language", () => {
    for (const locale of ["en", "de", "fr", "es"] as const) {
      for (const [key, message] of Object.entries(MESSAGES[locale])) {
        expect(JSON.stringify(message), `${locale} ${key}`).not.toMatch(/[\u00A0\u2000-\u200B\u202F\uFEFF\t]/);
      }
    }
  });

  it("calls the Settings page by its navigation name in Spanish (Configuración, never Ajustes)", () => {
    expect(MESSAGES.es["common.nav.settings"]).toBe("Configuración");
    for (const [key, message] of Object.entries(MESSAGES.es)) expect(JSON.stringify(message), key).not.toMatch(/\bAjustes\b/);
  });

  it("keeps keys in their area and defines each key once", () => {
    const seen = new Map<string, string>();
    for (const [name, ns] of Object.entries(NAMESPACES)) {
      for (const key of Object.keys(ns.en)) {
        expect(key.startsWith(`${name}.`), `${key} in ${name}`).toBe(true);
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, name);
      }
    }
    expect(Object.keys(MESSAGES.en)).toHaveLength(seen.size);
  });

  it("actually translates German, French and Spanish texts (no English left over)", () => {
    for (const locale of ["de", "fr", "es"] as const) {
      const same = { de: SAME_IN_BOTH, fr: SAME_IN_FRENCH, es: SAME_IN_SPANISH }[locale];
      const untranslated = (Object.entries(MESSAGES.en) as Array<[keyof typeof MESSAGES.en, Message]>)
        .filter(([key, en]) => JSON.stringify(MESSAGES[locale][key]) === JSON.stringify(en))
        // Plural forms that read the same ("{count} minute(s)" in French) count as translated.
        .filter(([, en]) => (typeof en === "string" ? !(same.has(en) || /^[\W\d]*$/.test(en) || /^\{\w+\}$/.test(en)) : locale === "de"))
        .map(([key]) => key);
      expect(untranslated, locale).toEqual([]);
    }
  });

  it("names languages in the interface language, keeping Shopify's names in English", () => {
    expect(languageName("de", "fr", "French")).toBe("Französisch");
    // French and Spanish write language names in lower case (they appear inside sentences).
    expect(languageName("fr", "de", "German")).toBe("allemand");
    expect(languageName("es", "de", "German")).toBe("alemán");
    expect(languageName("de", "pt-BR", "Portuguese (Brazil)")).toBe("Portugiesisch (Brasilien)");
    expect(languageName("en", "pt-BR", "Portuguese (Brazil)")).toBe("Portuguese (Brazil)");
    expect(languageName("de", "not a code!", "Klingon")).toBe("Klingon");
    expect(languageName("de", "xx", null)).toBe("xx");
  });

  it("names content types, fields, checks and job states in the language, with fallbacks", () => {
    const de = translator("de");
    expect(kindLabel(de, "PRODUCT")).toBe("Produkte");
    expect(kindLabel(de, "MEDIA_IMAGE")).toBe("Produktbilder (Alt-Text)");
    expect(kindLabel(de, "UNKNOWN_TYPE")).toBe("UNKNOWN_TYPE");
    expect(fieldName(de, "meta_title")).toBe("SEO-Titel");
    expect(fieldName(de, "custom_key")).toBe("Custom key");
    expect(issueName(de, "NUMBERS_CHANGED")).toBe("Zahlen verändert");
    expect(jobStatus(de, "COMPLETED")).toEqual({ label: "Abgeschlossen", tone: "success" });
  });
});
