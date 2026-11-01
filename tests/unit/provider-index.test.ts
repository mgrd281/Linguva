/**
 * getTranslationProvider() (app/.server/providers/index.ts): with only DeepL
 * in use it returns exactly the object it returned before engines could be
 * combined (DeepLProvider for one key, DeepLKeyPool for several); a router
 * only for two or more engines. plannedEngine and routerSignal do nothing
 * new for a bare provider.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../app/.server/lib/config";
import { DeepLProvider } from "../../app/.server/providers/deepl";
import { DeepLKeyPool } from "../../app/.server/providers/deepl-pool";
import { clearEngineRests, EngineRouter } from "../../app/.server/providers/engine-router";
import { consentGap, getTranslationProvider, plannedEngine, providerLabel, routerSignal } from "../../app/.server/providers";
import type { TranslationProvider, TranslationRequest } from "../../app/.server/providers/types";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { AzureTranslatorProvider } from "../../app/.server/providers/azure";
import { FAKE_AZURE_KEY, FAKE_GOOGLE_KEY } from "../support/engine-fixtures";

const SAVED = { ...process.env };
function withEnv(env: Record<string, string>) {
  for (const key of ["DEEPL_API_KEY", "DEEPL_API_KEYS", "AZURE_TRANSLATOR_KEY", "AZURE_TRANSLATOR_REGION", "GOOGLE_TRANSLATE_API_KEY", "GOOGLE_TRANSLATE_CREDENTIALS", "TRANSLATION_ENGINES", "TRANSLATION_PROVIDER"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  resetConfigCache();
}

afterEach(() => {
  process.env = { ...SAVED };
  resetConfigCache();
  clearEngineRests();
  vi.unstubAllGlobals();
});

describe("getTranslationProvider", () => {
  it("returns today's DeepL objects with only DeepL in use", () => {
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx" });
    const one = getTranslationProvider();
    expect(one).toBeInstanceOf(DeepLProvider);
    expect(one).not.toBeInstanceOf(EngineRouter);
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", DEEPL_API_KEYS: "fictional-second:fx" });
    expect(getTranslationProvider()).toBeInstanceOf(DeepLKeyPool);
  });

  it("stays DeepL alone when TRANSLATION_ENGINES lists only DeepL, or the Azure key doesn't validate", () => {
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope", TRANSLATION_ENGINES: "deepl" });
    expect(getTranslationProvider()).toBeInstanceOf(DeepLProvider);
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: "not a key!" });
    expect(getTranslationProvider()).toBeInstanceOf(DeepLProvider);
  });

  it("returns the mock provider with TRANSLATION_PROVIDER=mock, and null without an engine", () => {
    withEnv({ TRANSLATION_PROVIDER: "mock", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY });
    expect(getTranslationProvider()).toBeInstanceOf(MockTranslationProvider);
    withEnv({});
    expect(getTranslationProvider()).toBeNull();
  });

  it("returns a single other engine as it is, and a router for two or more", () => {
    withEnv({ AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" });
    expect(getTranslationProvider()).toBeInstanceOf(AzureTranslatorProvider);
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" });
    const router = getTranslationProvider() as EngineRouter;
    expect(router).toBeInstanceOf(EngineRouter);
    expect(router.id).toBe("deepl");
    expect(router.label).toBe("deepl+azure");
    expect(providerLabel(router)).toBe("deepl+azure");
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, TRANSLATION_ENGINES: "google, azure" });
    // Only the listed engines, in the listed order.
    expect((getTranslationProvider() as EngineRouter).engines).toEqual(["google", "azure"]);
  });

  it("builds without any network", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY });
    getTranslationProvider();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("plannedEngine, routerSignal, providerLabel", () => {
  it("answer without any fetch for a bare provider and a router with one allowed engine", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx" });
    const bare = getTranslationProvider()!;
    expect(await plannedEngine(bare, "de", ["deepl"])).toBe("deepl");
    expect(routerSignal(bare, new AbortController().signal, 1_000)).toBeUndefined();
    expect(providerLabel(bare)).toBe("deepl");
    expect(providerLabel(null)).toBe("none");
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY });
    const router = getTranslationProvider()!;
    expect(await plannedEngine(router, "de", ["deepl"])).toBe("deepl");
    expect(await plannedEngine(router, "de", ["azure"])).toBe("azure");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("joins the caller's stop with the deadline for a router", () => {
    withEnv({ DEEPL_API_KEY: "fictional-deepl-key:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY });
    const router = getTranslationProvider()!;
    const stop = new AbortController();
    const signal = routerSignal(router, stop.signal, 60_000)!;
    expect(signal.aborted).toBe(false);
    stop.abort();
    expect(signal.aborted).toBe(true);
    expect(routerSignal(router, undefined, 60_000)).toBeInstanceOf(AbortSignal);
  });
});

describe("consentGap", () => {
  /** A fake engine with a language list; counts its calls. */
  const engine = (id: "deepl" | "azure" | "google", languages: readonly string[] | "fail") => {
    const calls: TranslationRequest[] = [];
    const provider: TranslationProvider = {
      id,
      translate: async (request) => {
        calls.push(request);
        return { translations: [...request.segments], billedCharacters: 0, provider: id };
      },
      targetSupport: async (locales) => {
        if (languages === "fail") throw new Error("list down");
        return new Map(locales.map((l) => [l, languages.includes(l)]));
      },
    };
    return { id, provider, calls };
  };

  it("names the engine to allow when only an engine outside the consent serves the language, without any translate call", async () => {
    const deepl = engine("deepl", ["de"]);
    const azure = engine("azure", ["de", "th"]);
    const r = new EngineRouter([deepl, azure]);
    expect(await consentGap(r, "th", ["deepl"])).toBe("azure");
    // DeepL serves German: nothing to allow.
    expect(await consentGap(r, "de", ["deepl"])).toBeNull();
    // A consent covering every engine, or none at all (the router fails closed by itself).
    expect(await consentGap(r, "th", ["deepl", "azure"])).toBeNull();
    expect(await consentGap(r, "th", [])).toBeNull();
    // No engine offers it: the language is unsupported, not a consent question.
    expect(await consentGap(r, "sw", ["deepl"])).toBeNull();
    expect(deepl.calls).toHaveLength(0);
    expect(azure.calls).toHaveLength(0);
  });

  it("goes ahead as before when an allowed engine's list can't be read, and does nothing for a bare provider", async () => {
    const r = new EngineRouter([engine("deepl", "fail"), engine("azure", ["th"])]);
    expect(await consentGap(r, "th", ["deepl"])).toBeNull();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await consentGap(new DeepLProvider({ apiKey: "fictional:fx" }), "th", ["deepl"])).toBeNull();
    expect(await consentGap(null, "th", ["deepl"])).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
