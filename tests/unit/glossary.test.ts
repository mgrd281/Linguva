import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "../../app/.server/glossary/csv";
import {
  glossaryToCsv,
  MAX_TERMS_PER_SHOP,
  parseGlossaryCsv,
  resolveTerms,
} from "../../app/.server/glossary/glossary";
import { findProtectedSpans } from "../../app/.server/translation/protect";
import { translate, type MessageRef } from "../../app/i18n/i18n";

// A row's problems as the page shows them.
const text = (error: { messages: MessageRef[] } | undefined, locale: "en" | "de" = "en") =>
  (error?.messages ?? []).map((m) => translate(locale, m.key, m.vars)).join("; ");

describe("CSV", () => {
  it("parses quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\nlast,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", ""],
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"open')).toThrow(/Unterminated/);
  });

  it.each(["=HYPERLINK(\"x\")", "+1+1", "-2", "@SUM(A1)", "\tcmd"])(
    "neutralises spreadsheet formulas in %j",
    (value) => {
      const cell = csvCell(value);
      expect(cell.startsWith('"\'')).toBe(true);
    },
  );

  it("round-trips through toCsv and parseCsv", () => {
    const rows = [["rule", "term"], ["PREFERRED", 'Hoodie, "warm"'], ["X", "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("parseGlossaryCsv", () => {
  it("validates every row and reports errors with line numbers", () => {
    const csv = [
      "rule,term,translation,target_locale,market,case_sensitive,notes",
      "DO_NOT_TRANSLATE,KARINEX,,,,true,brand",
      "PREFERRED,hoodie,Kapuzenpullover,de,,,",
      "PREFERRED,jacket,,de,,,",
      "UNKNOWN,x,,,,,",
      "DO_NOT_TRANSLATE,Brand,,not a locale!,,,",
    ].join("\n");
    const result = parseGlossaryCsv(csv);
    expect(result.terms).toHaveLength(2);
    expect(result.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(text(result.errors[0])).toBe("translation: is required for preferred terms");
    expect(text(result.errors[1])).toBe('rule: Invalid option: expected one of "DO_NOT_TRANSLATE"|"PREFERRED"|"FORBIDDEN"');
    expect(text(result.errors[2])).toBe("targetLocale: must be a locale code such as de or pt-BR, or empty");
    expect(text(result.errors[2], "de")).toBe("targetLocale: muss ein Sprachcode wie de oder pt-BR sein oder leer bleiben");
  });

  it("requires the rule and term columns", () => {
    expect(text(parseGlossaryCsv("foo,bar\n1,2").errors[0])).toMatch(/rule, term/);
    expect(text(parseGlossaryCsv("").errors[0])).toBe("The file is empty");
    expect(text(parseGlossaryCsv('rule,term\nPREFERRED,"open').errors[0])).toMatch(/Unterminated/);
  });

  it("caps the number of rows", () => {
    const rows = ["rule,term", ...Array.from({ length: MAX_TERMS_PER_SHOP + 1 }, (_, i) => `DO_NOT_TRANSLATE,t${i}`)];
    expect(text(parseGlossaryCsv(rows.join("\n")).errors[0])).toMatch(/At most/);
  });

  it("imports what it exports, including formula-like terms", () => {
    const terms = [
      { rule: "DO_NOT_TRANSLATE", term: "=Brand", translation: null, targetLocale: "", market: "", caseSensitive: true, notes: null },
      { rule: "PREFERRED", term: "hoodie", translation: "Kapuzenpullover", targetLocale: "de", market: "", caseSensitive: false, notes: "x, y" },
    ];
    const parsed = parseGlossaryCsv(glossaryToCsv(terms));
    expect(parsed.errors).toEqual([]);
    expect(parsed.terms.map((t) => [t.rule, t.term, t.translation ?? null, t.targetLocale])).toEqual([
      ["DO_NOT_TRANSLATE", "=Brand", null, ""],
      ["PREFERRED", "hoodie", "Kapuzenpullover", "de"],
    ]);
  });
});

describe("resolveTerms", () => {
  const base = { translation: null, market: "", caseSensitive: false };
  const terms = [
    { ...base, rule: "DO_NOT_TRANSLATE", term: "KARINEX", targetLocale: "" },
    { ...base, rule: "PREFERRED", term: "hoodie", translation: "Hoodie", targetLocale: "" },
    { ...base, rule: "PREFERRED", term: "hoodie", translation: "Kapuzenpullover", targetLocale: "de" },
    { ...base, rule: "PREFERRED", term: "hoodie", translation: "Kapuze CH", targetLocale: "de", market: "gid://shopify/Market/2" },
    { ...base, rule: "FORBIDDEN", term: "billig", targetLocale: "de" },
    { ...base, rule: "FORBIDDEN", term: "pas cher", targetLocale: "fr" },
  ];

  it("applies language-specific terms over general ones", () => {
    const resolved = resolveTerms(terms, "de");
    expect(resolved.protect.protectedTerms).toEqual([{ term: "KARINEX", caseSensitive: false }]);
    expect(resolved.protect.replacements).toEqual([{ term: "hoodie", caseSensitive: false, value: "Kapuzenpullover" }]);
    expect(resolved.rules.map((r) => r.term)).toEqual(["billig"]);
  });

  it("applies market-specific terms for that market only", () => {
    expect(resolveTerms(terms, "de", "gid://shopify/Market/2").protect.replacements![0]!.value).toBe("Kapuze CH");
    expect(resolveTerms(terms, "de", "gid://shopify/Market/9").protect.replacements![0]!.value).toBe("Kapuzenpullover");
  });

  it("falls back to general terms for other languages", () => {
    const resolved = resolveTerms(terms, "it");
    expect(resolved.protect.replacements).toEqual([{ term: "hoodie", caseSensitive: false, value: "Hoodie" }]);
    expect(resolved.rules).toEqual([]);
  });
});

describe("glossary replacements in protection", () => {
  it("renders preferred terms with their translation and keeps the longest match", () => {
    const spans = findProtectedSpans("A KARINEX Pro hoodie, a Hoodie and a pro", {
      protectedTerms: [{ term: "KARINEX Pro" }],
      replacements: [{ term: "hoodie", value: "Kapuzenpullover" }, { term: "Pro", value: "Profi" }],
    });
    expect(spans.map((s) => [s.value, s.replacement ?? null])).toEqual([
      ["KARINEX Pro", null],
      ["hoodie", "Kapuzenpullover"],
      ["Hoodie", "Kapuzenpullover"],
      ["pro", "Profi"],
    ]);
  });
});

describe("segments made only of glossary terms", () => {
  it("render with the preferred wording without a provider", async () => {
    const { translateFields } = await import("../../app/.server/translation/translate-fields");
    const sent: string[][] = [];
    const result = await translateFields({
      engines: ["deepl"],
      provider: {
        id: "t",
        translate: async (r) => {
          sent.push([...r.segments]);
          return { translations: r.segments.map((x) => x), billedCharacters: 0, provider: "t" };
        },
      },
      fields: [{ key: "title", value: "KARINEX hoodie 42", type: "SINGLE_LINE_TEXT_FIELD" }],
      sourceLocale: "en",
      targetLocale: "de",
      protect: { protectedTerms: [{ term: "KARINEX" }], replacements: [{ term: "hoodie", value: "Kapuzenpullover" }] },
    });
    expect(sent).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ status: "translated", value: "KARINEX Kapuzenpullover 42" });
  });
});

describe("market input", () => {
  it("accepts the market number from the Markets page or the full id, and nothing else", async () => {
    const { termInputSchema } = await import("../../app/.server/glossary/glossary");
    const parse = (market: string) => termInputSchema.safeParse({ rule: "DO_NOT_TRANSLATE", term: "Brand", market });
    expect(parse("42").data?.market).toBe("gid://shopify/Market/42");
    expect(parse(" gid://shopify/Market/7 ").data?.market).toBe("gid://shopify/Market/7");
    expect(parse("").data?.market).toBe("");
    for (const bad of ["abc", "gid://shopify/Product/1", "42; DROP", "-1"]) expect(parse(bad).success).toBe(false);
  });
});
