/**
 * The Content page's language (app/lib/content-language.ts): the one shown
 * without ?lang lands where work waits, never on a hidden language while a
 * visible one exists, and never outside the plan while one inside exists;
 * the chips read in the interface language's order.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { chipName, chipOrder, chooseLanguage, MAX_CHIPS, switcherKind, type LanguageChoiceInput } from "../../app/lib/content-language";

/** The `full` store's shape: Arabic (hidden), French, German, in the app's order (Shopify's English names). */
const targets = [
  { locale: "ar", published: false },
  { locale: "fr", published: true },
  { locale: "de", published: true },
];
const input = (over: Partial<LanguageChoiceInput> = {}): LanguageChoiceInput => ({
  requested: null,
  targets,
  allowed: ["ar", "fr", "de"],
  measured: new Set(["ar", "fr", "de"]),
  open: new Map([
    ["ar", 90],
    ["fr", 40],
    ["de", 50],
  ]),
  ...over,
});

describe("the language the page shows", () => {
  it("is the URL's when the store has it, else the URL is ignored", () => {
    expect(chooseLanguage(input({ requested: "fr" }))).toBe("fr");
    // A hidden language may be asked for; it is shown.
    expect(chooseLanguage(input({ requested: "ar" }))).toBe("ar");
    expect(chooseLanguage(input({ requested: "xx" }))).toBe("de");
    expect(chooseLanguage(input({ requested: "" }))).toBe("de");
  });

  it("is never hidden while a visible one exists, even with the most open work", () => {
    expect(chooseLanguage(input())).toBe("de");
    // Only hidden languages: then a hidden one.
    expect(chooseLanguage(input({ targets: [{ locale: "ar", published: false }], allowed: ["ar"], measured: new Set(["ar"]) }))).toBe("ar");
  });

  it("prefers languages the plan includes", () => {
    // Free: one language, the first in the app's order (French here, ar is hidden but still counts for the plan).
    expect(chooseLanguage(input({ allowed: ["ar", "fr"] }))).toBe("fr");
    // None visible inside the plan: the first visible one.
    expect(chooseLanguage(input({ allowed: ["ar"] }))).toBe("fr");
  });

  it("lands on the counted language with the most open texts, ties in the app's order", () => {
    expect(chooseLanguage(input({ open: new Map([["fr", 70], ["de", 50]]) }))).toBe("fr");
    expect(chooseLanguage(input({ open: new Map([["fr", 50], ["de", 50]]) }))).toBe("fr");
    expect(chooseLanguage(input({ open: new Map() }))).toBe("fr");
    // An uncounted language has no figures to compare: a counted one wins.
    expect(chooseLanguage(input({ measured: new Set(["de"]), open: new Map([["fr", 500], ["de", 1]]) }))).toBe("de");
  });

  it("is the first visible one the plan includes when nothing is counted, and none without languages", () => {
    expect(chooseLanguage(input({ measured: new Set() }))).toBe("fr");
    expect(chooseLanguage(input({ measured: new Set(), allowed: ["ar", "de"] }))).toBe("de");
    expect(chooseLanguage(input({ targets: [], allowed: [], measured: new Set() }))).toBeNull();
  });
});

describe("the chips", () => {
  const languages = [
    { locale: "ar", name: "Arabic", published: false },
    { locale: "da", name: "Danish", published: true },
    { locale: "nl", name: "Dutch", published: true },
    { locale: "en", name: "English", published: true },
    { locale: "fr", name: "French", published: true },
  ];

  it("come visible first, then hidden, each by the name in the interface language", () => {
    const de = translator("de");
    expect(chipOrder(de, languages).map((l) => chipName(de, l))).toEqual(["Dänisch", "Englisch", "Französisch", "Niederländisch", "Arabisch"]);
    const en = translator("en");
    expect(chipOrder(en, languages).map((l) => l.locale)).toEqual(["da", "nl", "en", "fr", "ar"]);
    // French and Spanish names start with a capital on a chip.
    expect(chipName(translator("fr"), { locale: "de", name: "German" })).toBe("Allemand");
  });

  it("turn into one select with more than six languages", () => {
    expect(MAX_CHIPS).toBe(6);
    expect(switcherKind(6)).toBe("chips");
    expect(switcherKind(7)).toBe("select");
  });
});
