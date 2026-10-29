import { describe, expect, it } from "vitest";
import { checkSeoField, plainText, seoWidth, truncateForPreview } from "../../app/lib/seo";

describe("seoWidth", () => {
  it("counts graphemes, and wide scripts double", () => {
    expect(seoWidth("Winter jacket")).toBe(13);
    expect(seoWidth("  many   spaces  ")).toBe("many spaces".length);
    // Arabic letters and combining marks count per grapheme.
    expect(seoWidth("سترة شتوية")).toBe(10);
    expect(seoWidth("冬のジャケット")).toBe(14);
    expect(seoWidth("겨울 재킷")).toBe(9);
    // An emoji with modifiers is one grapheme.
    expect(seoWidth("👍🏽")).toBe(1);
  });
});

describe("checkSeoField", () => {
  it("warns about long, short and untranslated SEO fields only", () => {
    expect(checkSeoField("meta_title", "Warm winter jacket for men", "Warme Winterjacke für Herren")).toEqual([]);
    expect(checkSeoField("meta_title", "x", "A".repeat(61))).toEqual([
      { code: "SEO_TOO_LONG", severity: "warning", detail: "61/60" },
    ]);
    expect(checkSeoField("meta_description", "x", "Kurz.").map((i) => i.code)).toEqual(["SEO_TOO_SHORT"]);
    expect(
      checkSeoField("meta_title", "Warm winter jacket for men", "Warm winter jacket for men").map((i) => i.code),
    ).toEqual(["SEO_SAME_AS_SOURCE"]);
    // Brand-like short titles may stay the same.
    expect(checkSeoField("meta_title", "Nike Air Max 90", "Nike Air Max 90")).toEqual([]);
    expect(checkSeoField("title", "x", "A".repeat(200))).toEqual([]);
    expect(checkSeoField("meta_title", "x", "   ")).toEqual([]);
  });

  it("measures CJK titles by width, so they hit the limit sooner", () => {
    const thirtyOne = "冬".repeat(31);
    expect(checkSeoField("meta_title", "Winter", thirtyOne).map((i) => i.code)).toEqual(["SEO_TOO_LONG"]);
  });
});

describe("preview helpers", () => {
  it("truncates by width and strips markup to text", () => {
    expect(truncateForPreview("abcdef", 4)).toBe("abcd…");
    expect(truncateForPreview("abc", 4)).toBe("abc");
    expect(plainText('<p>Warm <b>jacket</b> &amp; <script>alert(1)</script>hat &lt;3</p>')).toBe("Warm jacket & hat <3");
    expect(plainText("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });
});
