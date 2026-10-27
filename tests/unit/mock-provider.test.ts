import { describe, expect, it } from "vitest";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { translateFields } from "../../app/.server/translation/translate-fields";

describe("MockTranslationProvider", () => {
  it("marks text with the target locale and keeps inline codes and entities", async () => {
    const provider = new MockTranslationProvider();
    const result = await provider.translate({
      segments: ['Buy <g id="1">2</g> &amp; save <x id="2"/>'],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(result.translations).toEqual(['[de] Buy <g id="1">2</g> &amp; save <x id="2"/>']);
    expect(result.provider).toBe("mock");
  });

  it("produces results that pass the full validation pipeline", async () => {
    const { outcomes } = await translateFields({
      provider: new MockTranslationProvider(),
      fields: [
        { key: "title", value: "Jacket 42 {{ size }}", type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "body_html", value: '<p>Warm <a href="/x">jacket</a> 2 kg</p>', type: "HTML" },
      ],
      sourceLocale: "en",
      targetLocale: "fr",
    });
    expect(outcomes).toMatchObject([
      { key: "title", status: "translated", value: "[fr] Jacket 42 {{ size }}", issues: [] },
      { key: "body_html", status: "translated", value: '<p>[fr] Warm <a href="/x">jacket</a> 2 kg</p>', issues: [] },
    ]);
  });

  it("can simulate provider failures", async () => {
    const provider = new MockTranslationProvider({ failNext: { count: 1, kind: "retryable" } });
    const request = { segments: ["a b"], sourceLocale: "en", targetLocale: "de" };
    await expect(provider.translate(request)).rejects.toBeInstanceOf(TranslationProviderError);
    await expect(provider.translate(request)).resolves.toMatchObject({ translations: ["[de] a b"] });
  });
});
