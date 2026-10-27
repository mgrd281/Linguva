import { describe, expect, it } from "vitest";
import { MAX_HANDLE_LENGTH, suggestHandle, validateHandle } from "../../app/lib/handles";

describe("suggestHandle", () => {
  it("builds readable handles per language", () => {
    expect(suggestHandle("Größe & Füße – Winterjacke!", "de")).toBe("groesse-fuesse-winterjacke");
    expect(suggestHandle("Été élégant : veste d'hiver", "fr")).toBe("ete-elegant-veste-dhiver");
    expect(suggestHandle("Chaqueta  de   invierno ", "es")).toBe("chaqueta-de-invierno");
    // ş loses its cedilla; the dotless ı has no accent to strip and stays.
    expect(suggestHandle("Kış ceketi", "tr")).toBe("kıs-ceketi");
    // Non-Latin scripts keep their letters (and combining marks).
    expect(suggestHandle("سترة شتوية دافئة", "ar")).toBe("سترة-شتوية-دافئة");
    expect(suggestHandle("冬のジャケット 2026", "ja")).toBe("冬のジャケット-2026");
    expect(suggestHandle("Зимняя куртка", "ru")).toBe("зимняя-куртка");
    expect(suggestHandle("!!!", "en")).toBe("");
  });

  it("stays within Shopify's length and cuts at a word boundary", () => {
    const handle = suggestHandle(Array.from({ length: 80 }, (_, i) => `word${i}`).join(" "), "en");
    expect(handle.length).toBeLessThanOrEqual(MAX_HANDLE_LENGTH);
    expect(handle.endsWith("-")).toBe(false);
    expect(validateHandle(handle)).toBeNull();
  });
});

describe("validateHandle", () => {
  it("accepts lowercase words joined by single hyphens, in any script", () => {
    for (const ok of ["winter-jacket", "jacke-2026", "سترة-شتوية", "冬のジャケット"]) expect(validateHandle(ok)).toBeNull();
  });
  it("names what's wrong", () => {
    expect(validateHandle("")).toBe("EMPTY");
    expect(validateHandle("Winter-Jacket")).toBe("UPPERCASE");
    expect(validateHandle("winter jacket")).toBe("INVALID_CHARACTERS");
    expect(validateHandle("winter--jacket")).toBe("INVALID_CHARACTERS");
    expect(validateHandle("-winter")).toBe("INVALID_CHARACTERS");
    expect(validateHandle("a/b")).toBe("INVALID_CHARACTERS");
    expect(validateHandle("<script>")).toBe("INVALID_CHARACTERS");
    expect(validateHandle("a".repeat(256))).toBe("TOO_LONG");
  });
});
