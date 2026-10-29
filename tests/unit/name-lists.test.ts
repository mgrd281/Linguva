/**
 * Language and country names inside the Overview's sentences
 * (app/lib/name-lists.ts): lists with "and", names as written mid-sentence,
 * no nested parentheses, long lines shortened.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { GAP_SHOWN, gapEntry, gapLine, languageList, upperFirst } from "../../app/lib/name-lists";

const de = translator("de");
const fr = translator("fr");
const en = translator("en");

describe("languages inside a sentence", () => {
  it("joins two or three with the language's 'and'", () => {
    expect(languageList(de, ["Tschechisch", "Polnisch"])).toBe("Tschechisch und Polnisch");
    expect(languageList(en, ["Czech", "Polish", "Slovak"])).toBe("Czech, Polish, and Slovak");
    expect(languageList(fr, [fr.language("cs"), fr.language("pl")])).toBe("tchèque et polonais");
    expect(languageList(de, ["Tschechisch"])).toBe("Tschechisch");
  });

  it("names three and counts the rest, in the form for languages", () => {
    expect(languageList(de, ["Bulgarisch", "Tschechisch", "Estnisch", "Kroatisch"])).toBe("Bulgarisch, Tschechisch, Estnisch und 1 weitere");
    expect(languageList(fr, ["bulgare", "tchèque", "estonien", "croate", "hongrois"])).toBe("bulgare, tchèque, estonien et 2 autres");
  });

  it("capitalises only where a name starts a link or label", () => {
    expect(fr.language("da")).toBe("danois");
    expect(upperFirst(fr.language("da"))).toBe("Danois");
  });
});

describe("gap lines", () => {
  it("says which countries a language would reach, without nested parentheses", () => {
    expect(gapEntry(en, "it", "Italian", [{ code: "IT", name: "Italy" }, { code: "CH", name: "Switzerland" }])).toBe("Italian (Italy, Switzerland)");
    // A regional language reaching its own region; reaching another country it still names it.
    expect(gapEntry(de, "pt-BR", de.language("pt-BR"), [{ code: "BR", name: "Brazil" }])).toBe("Portugiesisch (Brasilien)");
    expect(gapEntry(de, "pt-BR", de.language("pt-BR"), [{ code: "PT", name: "Portugal" }])).toBe("Portugiesisch (Brasilien): Portugal");
    expect(gapEntry(en, "nb", "Norwegian (Bokmål)", [{ code: "NO", name: "Norway" }])).toBe("Norwegian (Bokmål): Norway");
  });

  it("names at most GAP_SHOWN languages", () => {
    const entries = Array.from({ length: GAP_SHOWN + 2 }, (_, i) => `L${i}`);
    expect(gapLine(de, entries)).toBe(`${entries.slice(0, GAP_SHOWN).join(", ")} und 2 weitere`);
    expect(gapLine(de, entries.slice(0, 3))).toBe("L0, L1, L2");
  });
});
