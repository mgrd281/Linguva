/**
 * Which languages AI translation covers, and with which engine
 * (app/.server/providers/language-support.ts): each engine's own list, the
 * engine that serves a language first, and "needs consent" for a language
 * only an engine the shop hasn't allowed serves.
 */
import { describe, expect, it } from "vitest";
import { clearEngineRests, EngineRouter } from "../../app/.server/providers/engine-router";
import { AzureTranslatorProvider } from "../../app/.server/providers/azure";
import { DeepLProvider } from "../../app/.server/providers/deepl";
import { aiLanguageCoverage, aiLanguageSupport, formalityEngines } from "../../app/.server/providers/language-support";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import type { TranslationProvider } from "../../app/.server/providers/types";
import type { EngineId } from "../../app/lib/engines";

const engine = (id: EngineId, languages: readonly string[] | "fail"): TranslationProvider => ({
  id,
  translate: async () => ({ translations: [], billedCharacters: 0, provider: id }),
  targetSupport: async (locales) => {
    if (languages === "fail") throw new Error("list down");
    return new Map(locales.map((l) => [l, languages.includes(l)]));
  },
});

describe("aiLanguageCoverage", () => {
  it("is none without a provider and supported everywhere with the mock", async () => {
    expect(await aiLanguageCoverage(null, ["de"], [])).toEqual({ de: { state: "none", engine: null } });
    expect(await aiLanguageCoverage(new MockTranslationProvider(), ["de"], [])).toEqual({ de: { state: "supported", engine: null } });
  });

  it("names the single engine for the languages it covers", async () => {
    const coverage = await aiLanguageCoverage(engine("deepl", ["de"]), ["de", "th"], ["deepl"]);
    expect(coverage).toEqual({ de: { state: "supported", engine: "deepl" }, th: { state: "unsupported", engine: null } });
    expect(await aiLanguageCoverage(engine("deepl", "fail"), ["de"], ["deepl"])).toEqual({ de: { state: "unknown", engine: null } });
    // The wrapper says the same as before.
    expect(await aiLanguageSupport(engine("deepl", ["de"]), ["de", "th"])).toEqual({ de: "supported", th: "unsupported" });
  });

  it("names the engine that serves each language first, and the one that needs consent", async () => {
    clearEngineRests();
    const router = new EngineRouter([
      { id: "deepl", provider: engine("deepl", ["de"]) },
      { id: "azure", provider: engine("azure", ["de", "th"]) },
      { id: "google", provider: engine("google", ["de", "th", "km"]) },
    ]);
    expect(await aiLanguageCoverage(router, ["de", "th", "km", "xx"], ["deepl", "azure", "google"])).toEqual({
      de: { state: "supported", engine: "deepl" },
      th: { state: "supported", engine: "azure" },
      km: { state: "supported", engine: "google" },
      xx: { state: "unsupported", engine: null },
    });
    expect(await aiLanguageCoverage(router, ["de", "th"], ["deepl"])).toEqual({
      de: { state: "supported", engine: "deepl" },
      th: { state: "needsConsent", engine: "azure" },
    });
  });

  it("names no engine when the one tried first has an unreadable list (DeepL still gets the language first)", async () => {
    clearEngineRests();
    const router = new EngineRouter([
      { id: "deepl", provider: engine("deepl", "fail") },
      { id: "azure", provider: engine("azure", ["de", "th"]) },
    ]);
    expect(await aiLanguageCoverage(router, ["de", "th", "xx"], ["deepl", "azure", "google"])).toEqual({
      de: { state: "supported", engine: null },
      th: { state: "supported", engine: null },
      xx: { state: "unknown", engine: null },
    });
  });

  it("needs consent only for an engine whose list says it serves the language", async () => {
    clearEngineRests();
    const router = new EngineRouter([
      { id: "deepl", provider: engine("deepl", ["de"]) },
      { id: "azure", provider: engine("azure", "fail") },
      { id: "google", provider: engine("google", ["th"]) },
    ]);
    expect(await aiLanguageCoverage(router, ["th", "xx"], ["deepl"])).toEqual({
      th: { state: "needsConsent", engine: "google" },
      xx: { state: "unknown", engine: null },
    });
  });
});

describe("formalityEngines (Settings' form of address)", () => {
  const refuse = (async () => {
    throw new Error("no request expected");
  }) as unknown as typeof fetch;

  it("DeepL alone and the mock: no engine named, today's choice everywhere, and no request", async () => {
    expect(await formalityEngines(new DeepLProvider({ apiKey: "fictional:fx", fetch: refuse }), ["de", "fr"], ["deepl"])).toEqual({ servedBy: null, noFormality: [] });
    expect(await formalityEngines(new MockTranslationProvider(), ["de"], ["deepl"])).toEqual({ servedBy: null, noFormality: [] });
    expect(await formalityEngines(null, ["de"], [])).toEqual({ servedBy: null, noFormality: [] });
  });

  it("Azure alone serves every language without a form of address (no 'DeepL decides' choice), with no request", async () => {
    const azure = new AzureTranslatorProvider({ key: "fictionalazurekey000000000000000", region: "westeurope", fetch: refuse });
    expect(await formalityEngines(azure, ["de", "fr"], ["azure"])).toEqual({ servedBy: { de: "azure", fr: "azure" }, noFormality: ["azure"] });
  });

  it("several engines: the engine planned first for each language", async () => {
    clearEngineRests();
    const router = new EngineRouter([
      { id: "deepl", provider: engine("deepl", ["de"]) },
      { id: "azure", provider: { ...engine("azure", ["de", "th"]), capabilities: { formality: false, context: false } } },
    ]);
    expect(await formalityEngines(router, ["de", "th"], ["deepl", "azure"])).toEqual({ servedBy: { de: "deepl", th: "azure" }, noFormality: ["azure"] });
  });
});
