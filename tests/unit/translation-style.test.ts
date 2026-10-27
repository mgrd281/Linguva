import { describe, expect, it } from "vitest";
import { formalityFor, translationContext } from "../../app/.server/settings/shop-settings";
import { completeTranslation, prepareTranslation } from "../../app/.server/translation/translate-fields";
import type { TranslationProvider } from "../../app/.server/providers/types";
import { expectedScript, isWrongScript } from "../../app/lib/scripts";

describe("writing system check", () => {
  it("knows the script of non-Latin languages", () => {
    expect(expectedScript("ar")).not.toBeNull();
    expect(expectedScript("zh-TW")).not.toBeNull();
    expect(expectedScript("de")).toBeNull();
    expect(expectedScript("pt-BR")).toBeNull();
  });

  it("flags results mostly outside the target script, tolerating brand names", () => {
    expect(isWrongScript("ar", "Warm winter jacket with two pockets")).toBe(true);
    expect(isWrongScript("ar", "سترة شتوية دافئة بجيبين")).toBe(false);
    expect(isWrongScript("ar", "سترة شتوية دافئة من Patagonia بجيبين")).toBe(false);
    expect(isWrongScript("ja", "暖かい冬のジャケット、ポケット付き")).toBe(false);
    expect(isWrongScript("ru", "Тёплая зимняя куртка")).toBe(false);
    expect(isWrongScript("ru", "Warm winter jacket")).toBe(true);
    // Too short to judge (sizes, SKUs) and Latin targets: never flagged.
    expect(isWrongScript("ar", "XL")).toBe(false);
    expect(isWrongScript("de", "Warm winter jacket with pockets")).toBe(false);
  });

  it("adds a warning to AI results in the wrong script", async () => {
    const echo: TranslationProvider = {
      id: "echo",
      translate: async (r) => ({ translations: [...r.segments], billedCharacters: 0, provider: "echo" }),
    };
    const fields = [{ key: "title", value: "Warm winter jacket for cold days", type: "SINGLE_LINE_TEXT_FIELD" }];
    const prepared = await prepareTranslation({ fields });
    const result = await completeTranslation(prepared, { provider: echo, sourceLocale: "en", targetLocale: "ar" });
    expect(result.outcomes[0]).toMatchObject({ status: "translated", issues: expect.arrayContaining([expect.objectContaining({ code: "WRONG_SCRIPT", severity: "warning" })]) });
  });
});

describe("translation style", () => {
  it("reads the form of address per language, ignoring anything else", () => {
    const settings = { formalityByLocale: { de: "less", fr: "more", es: "casual" } };
    expect(formalityFor(settings, "de")).toBe("less");
    expect(formalityFor(settings, "fr")).toBe("more");
    expect(formalityFor(settings, "es")).toBeUndefined();
    expect(formalityFor({ formalityByLocale: null }, "de")).toBeUndefined();
    expect(formalityFor({ formalityByLocale: ["less"] }, "0")).toBeUndefined();
  });

  it("puts the store description before the item context", () => {
    expect(translationContext("Outdoor clothing, friendly tone", "Product: Wool jacket")).toBe(
      "Store: Outdoor clothing, friendly tone. Product: Wool jacket",
    );
    expect(translationContext(null, "Menu: Main menu")).toBe("Menu: Main menu");
    expect(translationContext("", undefined)).toBeUndefined();
  });
});
