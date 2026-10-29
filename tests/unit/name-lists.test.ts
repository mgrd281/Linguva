/**
 * Language and country names inside the Overview's sentences
 * (app/lib/name-lists.ts): lists with "and", names as written mid-sentence,
 * no nested parentheses, long lines shortened.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { GAP_SHOWN, gapEntry, gapLine, inParentheses, languageList, upperFirst } from "../../app/lib/name-lists";

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

  it("turns a name's own parentheses into brackets inside other parentheses", () => {
    expect(inParentheses("Portugiesisch (Portugal)")).toBe("Portugiesisch [Portugal]");
    expect(inParentheses("Französisch")).toBe("Französisch");
  });

  it("capitalises only where a name starts a link or label", () => {
    expect(fr.language("da")).toBe("danois");
    expect(upperFirst(fr.language("da"))).toBe("Danois");
  });
});

describe("gap lines", () => {
  const es = translator("es");

  it("says which countries a language would reach, without nested parentheses", () => {
    expect(gapEntry(en, "Italian", [{ code: "IT", name: "Italy" }, { code: "CH", name: "Switzerland" }])).toBe("Italian (Italy, Switzerland)");
    // A national language whose name merely contains the country's keeps it.
    expect(gapEntry(en, "Bulgarian", [{ code: "BG", name: "Bulgaria" }])).toBe("Bulgarian (Bulgaria)");
    expect(gapEntry(de, "Italienisch", [{ code: "IT", name: "Italy" }])).toBe("Italienisch (Italien)");
    // A name that already names its only country; one that doesn't still gets it, after a colon.
    expect(gapEntry(de, de.language("pt-BR"), [{ code: "BR", name: "Brazil" }])).toBe("Portugiesisch (Brasilien)");
    expect(gapEntry(de, de.language("pt-BR"), [{ code: "PT", name: "Portugal" }])).toBe("Portugiesisch (Brasilien): Portugal");
    expect(gapEntry(en, "Chinese (Traditional)", [{ code: "TW", name: "Taiwan" }])).toBe("Chinese (Traditional): Taiwan");
    // French puts a space before the colon; a country name with parentheses doesn't nest either.
    expect(gapEntry(fr, "norvégien (bokmål)", [{ code: "NO", name: "Norway" }])).toBe("norvégien (bokmål) : Norvège");
    expect(gapEntry(es, "inglés", [{ code: "HK", name: "Hong Kong" }])).toBe(`inglés: ${es.country("HK")}`);
  });

  it("knows a name that says its country outside parentheses too", () => {
    expect(gapEntry(es, es.language("pt-PT"), [{ code: "PT", name: "Portugal" }])).toBe("portugués de Portugal");
    expect(gapEntry(es, es.language("pt-BR"), [{ code: "BR", name: "Brazil" }])).toBe("portugués de Brasil");
  });

  it("decides the colon form by the countries it names, not those behind 'and N more'", () => {
    const countries = ["US", "GB", "AU", "HK"].map((code) => ({ code, name: code }));
    expect(gapEntry(es, "inglés", countries)).toBe(`inglés (${["US", "GB", "AU"].map((c) => es.country(c)).join(", ")} y 1 más)`);
    expect(gapEntry(es, "inglés", [countries[3]!, ...countries.slice(0, 3)])).toBe(`inglés: ${["HK", "US", "GB"].map((c) => es.country(c)).join(", ")} y 1 más`);
  });

  it("names at most GAP_SHOWN languages, with semicolons once a shown entry has a colon", () => {
    const entries = Array.from({ length: GAP_SHOWN + 2 }, (_, i) => `L${i}`);
    expect(gapLine(de, entries)).toBe(`${entries.slice(0, GAP_SHOWN).join(", ")} und 2 weitere`);
    expect(gapLine(de, entries.slice(0, 3))).toBe("L0, L1, L2");
    expect(gapLine(de, ["Italienisch (Italien, Schweiz)", "Norwegisch (Bokmål): Norwegen", "Polnisch (Polen)"])).toBe(
      "Italienisch (Italien, Schweiz); Norwegisch (Bokmål): Norwegen; Polnisch (Polen)",
    );
    // The rest is counted in languages, apart from the last entry's countries; French spaces the semicolon.
    const colonLast = [...entries.slice(0, GAP_SHOWN - 1), "Norwegisch (Bokmål): Norwegen", "L10", "L11"];
    expect(gapLine(de, colonLast)).toBe(`${colonLast.slice(0, GAP_SHOWN).join("; ")}; und 2 weitere Sprachen`);
    expect(gapLine(fr, ["chinois (Taïwan) : Taïwan", "bulgare (Bulgarie)"])).toBe("chinois (Taïwan) : Taïwan ; bulgare (Bulgarie)");
    // An entry hidden behind "and N more" doesn't decide the separator.
    expect(gapLine(de, [...entries.slice(0, GAP_SHOWN), "Norwegisch (Bokmål): Norwegen"])).toBe(`${entries.slice(0, GAP_SHOWN).join(", ")} und 1 weitere`);
  });
});
