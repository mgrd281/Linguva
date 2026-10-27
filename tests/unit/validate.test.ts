import { describe, expect, it } from "vitest";
import {
  hasBlockingIssue,
  validateTranslation,
} from "../../app/.server/translation/validate";

const codes = (source: string, target: string, glossary = []) =>
  validateTranslation({ source, target, glossary }).map((i) => i.code);

describe("validateTranslation", () => {
  it("accepts a faithful translation", () => {
    expect(codes("Weight: 1.5 kg, 2 pieces", "Gewicht: 1,5 kg, 2 Stück")).toEqual([]);
  });

  it("flags empty output as blocking", () => {
    const issues = validateTranslation({ source: "Hello", target: "  " });
    expect(issues.map((i) => i.code)).toEqual(["EMPTY_TRANSLATION"]);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("flags changed, missing or added numbers", () => {
    expect(codes("Pack of 12, 250 ml", "Packung mit 10, 250 ml")).toContain("NUMBERS_CHANGED");
    expect(codes("Pack of 12", "Packung")).toContain("NUMBERS_CHANGED");
    expect(codes("Fast delivery", "Lieferung in 2 Tagen")).toContain("NUMBERS_CHANGED");
  });

  it("accepts reordered numbers and Arabic-Indic digits", () => {
    expect(codes("From 10 to 20 cm", "20 bis 10 cm")).toEqual([]);
    expect(codes("Size 42, 3 colours", "المقاس ٤٢، ٣ ألوان")).toEqual([]);
    expect(codes("Size 42", "اندازه ۴۲")).toEqual([]);
  });

  it("enforces glossary forbidden and preferred wording", () => {
    const glossary = [
      { term: "hoodie", preferred: "Kapuzenpullover", forbidden: ["Hoodie-Jacke"] },
    ];
    expect(
      validateTranslation({ source: "Warm hoodie", target: "Warme Hoodie-Jacke", glossary }).map(
        (i) => [i.code, i.severity],
      ),
    ).toEqual([
      ["FORBIDDEN_TERM", "error"],
      ["PREFERRED_TERM_MISSING", "warning"],
    ]);
    expect(
      validateTranslation({ source: "Warm hoodie", target: "Warmer Kapuzenpullover", glossary }),
    ).toEqual([]);
  });

  it("warns about suspicious length and untranslated long text", () => {
    const long = "This premium leather wallet has six card slots and a coin pocket.";
    expect(codes(long, "Geldbörse.")).toContain("LENGTH_RATIO");
    expect(codes(long, long)).toContain("UNTRANSLATED");
    // Short strings such as brand names may legitimately stay identical.
    expect(codes("Nike Air", "Nike Air")).toEqual([]);
  });
});
