/**
 * Review's quality hints (app/lib/review-hints.ts): the words of every
 * check, the numbers that changed (a multiset difference), the merchant's
 * own word kept apart from the badge, number marks that never touch
 * markup, and the browser's second check of an edited text.
 */
import { describe, expect, it } from "vitest";
import { validateTranslation } from "../../app/.server/translation/validate";
import { MESSAGES } from "../../app/i18n/messages";
import {
  hintText,
  highlightNumbers,
  liveIssues,
  markNumbersInHtml,
  numberChange,
  numberMarks,
  parseNumbersDetail,
  readIssues,
  type ReviewIssue,
} from "../../app/lib/review-hints";

const issue = (code: string, detail: string | null = null, severity: "warning" | "error" = "warning"): ReviewIssue => ({ code, severity, detail });

describe("readIssues", () => {
  it("keeps issues of known shape and drops anything else", () => {
    expect(readIssues([{ code: "UNTRANSLATED", severity: "warning" }, { code: "NUMBERS_CHANGED", severity: "error", detail: "source [1] target [2]" }])).toEqual([
      issue("UNTRANSLATED"),
      issue("NUMBERS_CHANGED", "source [1] target [2]", "error"),
    ]);
    expect(readIssues(null)).toEqual([]);
    expect(readIssues("NUMBERS_CHANGED")).toEqual([]);
    expect(readIssues([null, 3, { severity: "error" }, { code: "" }, { code: "X", detail: "" }])).toEqual([issue("X")]);
  });
});

describe("number changes", () => {
  it("reads the detail validate.ts writes, and nothing else", () => {
    expect(parseNumbersDetail("source [12, 24] target [24, 6]")).toEqual({ source: ["12", "24"], target: ["24", "6"] });
    expect(parseNumbersDetail("source [] target [5]")).toEqual({ source: [], target: ["5"] });
    expect(parseNumbersDetail(null)).toBeNull();
    expect(parseNumbersDetail("12 → 6")).toBeNull();
  });

  it("matches the detail of the server's own check", () => {
    const [found] = validateTranslation({ source: "Cold for 24 hours, hot for 12 hours.", target: "Froid 24 heures, chaud 6 heures." });
    expect(found).toMatchObject({ code: "NUMBERS_CHANGED", detail: "source [12, 24] target [24, 6]" });
    expect(hintText(issue("NUMBERS_CHANGED", found!.detail!))).toMatchObject({ key: "review.hint.NUMBERS_CHANGED", vars: { count: 1, from: "12", to: "6" } });
  });

  it("counts repeated numbers (a multiset difference) and lists them by value", () => {
    expect(numberChange(["12", "24"], ["24", "6"])).toEqual({ removed: ["12"], added: ["6"] });
    expect(numberChange(["30", "12", "5"], ["15", "6", "5"])).toEqual({ removed: ["12", "30"], added: ["6", "15"] });
    expect(numberChange(["2", "2"], ["2"])).toEqual({ removed: ["2"], added: [] });
    expect(numberChange(["7"], ["7", "7"])).toEqual({ removed: [], added: ["7"] });
    expect(numberChange(["1"], ["1"])).toEqual({ removed: [], added: [] });
  });

  it("words one and several numbers, only missing ones and only new ones", () => {
    expect(hintText(issue("NUMBERS_CHANGED", "source [12, 30] target [15, 6]"))).toMatchObject({
      key: "review.hint.NUMBERS_CHANGED",
      vars: { count: 2, from: "12, 30", to: "6, 15" },
    });
    expect(hintText(issue("NUMBERS_CHANGED", "source [12, 24] target [24]"))).toMatchObject({ key: "review.hint.NUMBERS_REMOVED", vars: { count: 1, numbers: "12" } });
    expect(hintText(issue("NUMBERS_CHANGED", "source [] target [3, 6]"))).toMatchObject({ key: "review.hint.NUMBERS_ADDED", vars: { count: 2, numbers: "3, 6" } });
  });

  it("says only that a number changed without a readable detail", () => {
    expect(hintText(issue("NUMBERS_CHANGED")).key).toBe("review.hint.NUMBERS_PLAIN");
    expect(hintText(issue("NUMBERS_CHANGED", "garbled")).key).toBe("review.hint.NUMBERS_PLAIN");
    expect(hintText(issue("NUMBERS_CHANGED", "source [4] target [4]")).key).toBe("review.hint.NUMBERS_PLAIN");
  });

  it("treats Eastern Arabic digits as the same numbers", () => {
    const [found] = validateTranslation({ source: "Size 42, pack of 3", target: "المقاس ٤٢، عبوة من ٤" });
    const hint = hintText(issue("NUMBERS_CHANGED", found!.detail!));
    expect(hint).toMatchObject({ key: "review.hint.NUMBERS_CHANGED", vars: { from: "3", to: "4" } });
    expect(highlightNumbers("المقاس ٤٢، عبوة من ٤", ["4"])).toEqual([
      { text: "المقاس ٤٢، عبوة من ", mark: false },
      { text: "٤", mark: true },
    ]);
  });
});

describe("hint words", () => {
  it("has a badge text for every check the server writes", () => {
    const en = MESSAGES.en as Record<string, unknown>;
    for (const code of ["FORBIDDEN_TERM", "PREFERRED_TERM_MISSING", "UNTRANSLATED", "WRONG_SCRIPT", "FORMALITY_MISMATCH", "SEO_SAME_AS_SOURCE", "EMPTY_TRANSLATION"]) {
      const { key } = hintText(issue(code));
      expect(key, code).toBe(`review.hint.${code}`);
      expect(en[key!], code).toBeDefined();
    }
  });

  it("tells a much shorter from a much longer text", () => {
    expect(hintText(issue("LENGTH_RATIO", "0.25")).key).toBe("review.hint.LENGTH_SHORT");
    expect(hintText(issue("LENGTH_RATIO", "3.4")).key).toBe("review.hint.LENGTH_LONG");
    expect(hintText(issue("LENGTH_RATIO")).key).toBeNull();
  });

  it("gives Google lengths with their limit", () => {
    expect(hintText(issue("SEO_TOO_LONG", "64/60"))).toMatchObject({ key: "review.hint.SEO_TOO_LONG", vars: { width: 64, max: 60 } });
    expect(hintText(issue("SEO_TOO_SHORT", "12/15"))).toMatchObject({ key: "review.hint.SEO_TOO_SHORT", vars: { width: 12, min: 15 } });
    expect(hintText(issue("SEO_TOO_LONG", "long")).key).toBeNull();
  });

  it("leaves an unknown check to its general name", () => {
    expect(hintText(issue("SOMETHING_NEW"))).toMatchObject({ code: "SOMETHING_NEW", key: null, word: null });
  });

  it("returns the merchant's word apart from the badge", () => {
    expect(hintText(issue("FORBIDDEN_TERM", "wasserfest"))).toMatchObject({ key: "review.hint.FORBIDDEN_TERM", word: "wasserfest" });
    expect(hintText(issue("FORMALITY_MISMATCH", "tu"))).toMatchObject({ word: "tu" });
    expect(hintText(issue("PREFERRED_TERM_MISSING", "down vest → doudoune sans manches"))).toMatchObject({ word: "doudoune sans manches" });
    expect(hintText(issue("PREFERRED_TERM_MISSING", "no arrow")).word).toBeNull();
    expect(hintText(issue("UNTRANSLATED", "anything")).word).toBeNull();
    // The badge's own words never include it.
    for (const locale of ["en", "de", "fr", "es"] as const) {
      const text = String((MESSAGES[locale] as Record<string, unknown>)["review.hint.FORBIDDEN_TERM"]);
      expect(text).not.toContain("{");
    }
  });
});

describe("number marks", () => {
  it("marks what is missing in the original and what is new in the translation", () => {
    expect(numberMarks([issue("NUMBERS_CHANGED", "source [12, 24] target [24, 6]")])).toEqual({ source: ["12"], target: ["6"] });
    expect(numberMarks([issue("UNTRANSLATED")])).toEqual({ source: [], target: [] });
    expect(numberMarks([issue("NUMBERS_CHANGED")])).toEqual({ source: [], target: [] });
  });

  it("splits plain text around the marked numbers, once per listed number", () => {
    expect(highlightNumbers("cold for 24 hours or hot for 12 hours", ["12"])).toEqual([
      { text: "cold for 24 hours or hot for ", mark: false },
      { text: "12", mark: true },
      { text: " hours", mark: false },
    ]);
    expect(highlightNumbers("6 and 6", ["6"])).toEqual([
      { text: "6", mark: true },
      { text: " and 6", mark: false },
    ]);
    expect(highlightNumbers("no numbers", [])).toEqual([{ text: "no numbers", mark: false }]);
    // Leading zeros are the same number, as on the server.
    expect(highlightNumbers("Nr. 007", ["7"])).toEqual([
      { text: "Nr. ", mark: false },
      { text: "007", mark: true },
    ]);
  });

  it("marks numbers in HTML text only, never in tags, attributes or entities", () => {
    const html = '<p data-n="12" style="width: 12px">Keeps <b>12</b> hours &#12; cold &amp; 12</p><img src="https://cdn.example/12.png" alt="12">';
    expect(markNumbersInHtml(html, ["12"])).toBe(
      '<p data-n="12" style="width: 12px">Keeps <b><mark>12</mark></b> hours &#12; cold &amp; 12</p><img src="https://cdn.example/12.png" alt="12">',
    );
    expect(markNumbersInHtml(html, ["12", "12"])).toContain("cold &amp; <mark>12</mark></p>");
    expect(markNumbersInHtml(html, [])).toBe(html);
  });
});

describe("liveIssues: an edited text checked again", () => {
  const stored = [issue("NUMBERS_CHANGED", "source [12, 24] target [24, 6]", "error"), issue("FORBIDDEN_TERM", "wasserfest", "error")];

  it("drops the number hint once the numbers match, and keeps other checks as stored", () => {
    expect(liveIssues({ key: "body_html", source: "<p>Cold for 24 hours, hot for 12.</p>", value: "<p>Froid 24 heures, chaud 12.</p>", stored })).toEqual([
      issue("FORBIDDEN_TERM", "wasserfest", "error"),
    ]);
  });

  it("finds changed numbers in the edit, with the stored severity", () => {
    expect(liveIssues({ key: "title", source: "Pack of 12", value: "Lot de 10", stored: [] })).toEqual([issue("NUMBERS_CHANGED", "source [12] target [10]")]);
    expect(liveIssues({ key: "body_html", source: "<p>12 and 24</p>", value: "<p>24 et 7</p>", stored })[0]).toEqual(issue("NUMBERS_CHANGED", "source [12, 24] target [24, 7]", "error"));
  });

  it("reads HTML as text: numbers in markup don't count", () => {
    expect(liveIssues({ key: "body_html", source: '<p><img src="a.png" width="300">Warm</p>', value: "<p>Chaud</p>", stored: [] })).toEqual([]);
  });

  it("checks Google lengths again and the hint goes away when fixed", () => {
    const long = "Produkt 1 Jacke – warm, leicht und wasserdicht für jeden Tag im Jahr";
    expect(liveIssues({ key: "meta_title", source: "Product 1 jacket", value: long, stored: [] })).toEqual([issue("SEO_TOO_LONG", `${long.length}/60`)]);
    expect(liveIssues({ key: "meta_title", source: "Product 1 jacket", value: "Produkt 1 Jacke – warm", stored: [issue("SEO_TOO_LONG", "68/60")] })).toEqual([]);
  });

  it("gives an emptied text no number hint (it can't be approved anyway)", () => {
    expect(liveIssues({ key: "title", source: "Pack of 12", value: "  ", stored: [issue("NUMBERS_CHANGED", "source [12] target [10]")] })).toEqual([]);
  });
});
