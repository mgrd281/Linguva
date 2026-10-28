/**
 * Interface languages: language choice, catalogues complete and consistent
 * (same keys, same placeholders, German actually translated), formatting
 * that is the same on server and browser.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMonth, formatNumber, languageName, resolveLocale, translate, translator } from "../../app/i18n/i18n";
import { MESSAGES, NAMESPACES, type Message } from "../../app/i18n/messages";
import { fieldName, issueName, jobStatus, kindLabel } from "../../app/i18n/labels";

const placeholders = (m: Message) =>
  [...new Set((typeof m === "string" ? [m] : [m.one, m.other]).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort();

// Words that are the same in both languages.
const SAME_IN_BOTH = new Set(["Status", "Name", "Blogs", "Blog", "Theme", "Themes", "Navigation", "Checkout", "Filter", "Linguva", "SEO", "Shopify", "DeepL", "OK"]);

describe("interface language", () => {
  it("follows Shopify's locale parameter, then the browser's languages, else English", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("de-CH")).toBe("de");
    expect(resolveLocale("en-GB", "de")).toBe("en");
    expect(resolveLocale("fr", "fr-FR,de;q=0.8,en;q=0.5")).toBe("de");
    expect(resolveLocale(null, "en;q=0.4,de;q=0.9")).toBe("de");
    expect(resolveLocale(null, "fr-FR")).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale("<script>", "de;q=0")).toBe("en");
  });

  it("fills placeholders, formats numbers for the language and picks plural forms", () => {
    expect(translate("en", "jobs.detail.timing.minutes", { count: 1 })).toBe("1 minute");
    expect(translate("en", "jobs.detail.timing.minutes", { count: 1200 })).toBe("1,200 minutes");
    expect(translate("de", "jobs.detail.timing.minutes", { count: 1 })).toBe("1 Minute");
    expect(translate("de", "jobs.detail.timing.minutes", { count: 1200 })).toBe("1.200 Minuten");
    expect(formatNumber("de", 1234567)).toBe("1.234.567");
  });

  it("formats dates in UTC, so server and browser render the same text", () => {
    expect(formatDate("de", "2026-10-27T23:30:00Z")).toBe("27. Oktober 2026");
    expect(formatDate("en", "2026-10-27T23:30:00Z")).toBe("October 27, 2026");
    expect(formatDateTime("de", "2026-10-27T23:30:00Z")).toBe("27.10.2026, 23:30 UTC");
    expect(formatMonth("de", "2026-10")).toBe("Oktober 2026");
    expect(formatDate("en", "not a date")).toBe("");
  });

  it("has a complete German catalogue: same keys, same placeholders, same plural forms", () => {
    for (const [name, ns] of Object.entries(NAMESPACES)) {
      expect(Object.keys(ns.de).sort(), name).toEqual(Object.keys(ns.en).sort());
      for (const [key, en] of Object.entries(ns.en) as Array<[string, Message]>) {
        const de = (ns.de as Record<string, Message>)[key]!;
        expect(typeof de, key).toBe(typeof en);
        expect(placeholders(de), key).toEqual(placeholders(en));
      }
    }
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

  it("actually translates German texts (no English left over)", () => {
    const untranslated = (Object.entries(MESSAGES.en) as Array<[keyof typeof MESSAGES.en, Message]>)
      .filter(([key, en]) => JSON.stringify(MESSAGES.de[key]) === JSON.stringify(en))
      .filter(([, en]) => typeof en !== "string" || !(SAME_IN_BOTH.has(en) || /^[\W\d]*$/.test(en) || /^\{\w+\}$/.test(en)))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it("names languages in the interface language, keeping Shopify's names in English", () => {
    expect(languageName("de", "fr", "French")).toBe("Französisch");
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
