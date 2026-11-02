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
      engines: ["deepl"],
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

describe("MockTranslationProvider options (Own key plan's mock members)", () => {
  const request = { segments: ["a b"], sourceLocale: "en", targetLocale: "de" };

  it("keeps the id 'mock' by default and takes an engine id when given", async () => {
    expect(new MockTranslationProvider().id).toBe("mock");
    const deepl = new MockTranslationProvider({ id: "deepl" });
    expect(deepl.id).toBe("deepl");
    await expect(deepl.translate(request)).resolves.toMatchObject({ provider: "deepl", translations: ["[de] a b"] });
  });

  it("fails every call with failNext.count Infinity, naming its id", async () => {
    const provider = new MockTranslationProvider({ id: "azure", failNext: { count: Infinity, kind: "quota" } });
    for (let i = 0; i < 5; i++) {
      await expect(provider.translate(request)).rejects.toMatchObject({ provider: "azure", kind: "quota" });
    }
    expect(provider.requests).toHaveLength(5);
  });
});
