/**
 * The operator's translation services card (app/components/TranslationEngines.tsx),
 * rendered on the server like the Plan page's parts: the order, a tile per
 * engine and state, never a key beyond its hint, every language complete.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationEngines } from "../../app/components/TranslationEngines";
import { getConfig } from "../../app/.server/lib/config";
import { clearAzureLanguageCache } from "../../app/.server/providers/azure";
import { clearEngineStatusCache, operatorEngines, type EnginesCard } from "../../app/.server/providers/engine-status";
import { APP_LOCALES, translator } from "../../app/i18n/i18n";
import { BASE_ENV, FAKE_AZURE_KEY } from "../support/engine-fixtures";

const CARD: EnginesCard = {
  order: ["deepl", "azure", "google"],
  totalLanguages: 4,
  deepl: { position: 1, keys: [{ position: 1, plan: "free", hint: "a1b2", used: 100_000, limit: 500_000, state: "ok" }], firstChoice: 3, canStepIn: 0, allowed: true },
  tiles: [
    { id: "azure", position: 2, state: "ok", hint: "0000", access: { kind: "region", region: "westeurope" }, dataLocation: "eu", firstChoice: 1, canStepIn: 3, allowed: true },
    { id: "google", position: 3, state: "refused", hint: "0000", access: { kind: "apiKey" }, dataLocation: "global", firstChoice: 0, canStepIn: 4, allowed: true },
  ],
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = (card: EnginesCard, locale: (typeof APP_LOCALES)[number] = "en") => renderToStaticMarkup(createElement(TranslationEngines, { card, i18n: translator(locale) }));

describe("TranslationEngines", () => {
  it("shows the order, the DeepL keys and a tile per engine", () => {
    const html = text(render(CARD));
    expect(html).toContain("Translation services");
    expect(html).toContain("Only you see this");
    expect(html).toContain("Order: DeepL → Microsoft Azure → Google Cloud");
    expect(html).toContain("DeepL keys");
    expect(html).toContain("Key 1");
    expect(html).toContain("First choice for 3 of 4 languages");
    expect(html).toContain("Region westeurope · …0000");
    expect(html).toContain("EU data centres");
    expect(html).toContain("Can step in for 3 languages");
    expect(html).toContain("Key accepted");
    expect(html).toContain("API key · …0000");
    expect(html).toContain("Data centres worldwide");
    expect(html).toContain("Refused by Google Cloud");
  });

  it("gives every engine group a heading, so heading navigation reaches Azure and Google too", () => {
    const html = render(CARD);
    for (const name of ["DeepL keys", "Microsoft Azure", "Google Cloud"]) expect(html).toMatch(new RegExp(`<h3[^>]*>${name}</h3>`));
  });

  it("says when an engine rests and why, and names a service account by its project", () => {
    const resting: EnginesCard = {
      ...CARD,
      deepl: null,
      order: ["azure", "google"],
      tiles: [
        { ...CARD.tiles[0]!, position: 1, state: "resting", rest: { kind: "quota", until: "2026-11-01T11:00:00.000Z" } },
        { ...CARD.tiles[1]!, position: 2, state: "resting", rest: { kind: "outage", until: "2026-11-01T10:02:00.000Z" }, access: { kind: "serviceAccount" }, hint: "fictional-proj-1", dataLocation: "eu" },
      ],
    };
    const html = text(render(resting));
    expect(html).toContain(`Used up · resting until ${translator("en").dateTime("2026-11-01T11:00:00.000Z")}`);
    expect(html).toContain("Not answering · paused until");
    expect(html).toContain("Service account · fictional-proj-1");
    expect(html).not.toContain("DeepL keys");
    const unreachable = text(render({ ...CARD, tiles: [{ ...CARD.tiles[0]!, state: "unreachable" }] }));
    expect(unreachable).toContain("Microsoft Azure not reachable");
  });

  it("says which engines this store hasn't allowed yet, with a link to Settings instead of their counts", () => {
    const html = render({ ...CARD, tiles: [{ ...CARD.tiles[0]!, firstChoice: 0, canStepIn: 0, allowed: false }, CARD.tiles[1]!] });
    expect(text(html)).toContain("Not allowed in this store yet: Settings");
    expect(html).toContain('href="/app/settings"');
    expect(text(html)).toContain("Can step in for 4 languages");
    // DeepL's and Google's counts; none for Azure.
    expect(text(html).match(/First choice for/g)).toHaveLength(2);
    expect(text(html)).toContain("Key accepted");
  });

  it("renders in every interface language without a missing text", () => {
    for (const locale of APP_LOCALES) {
      const html = render({ ...CARD, tiles: [...CARD.tiles, { ...CARD.tiles[0]!, allowed: false }] }, locale);
      expect(html, locale).not.toMatch(/overview\.engines\.|common\.engine\.|common\.nav\./);
    }
    expect(text(render(CARD, "de"))).toContain("Reihenfolge: DeepL → Microsoft Azure → Google Cloud");
  });
});

describe("operatorEngines", () => {
  // DeepL and Azure configured; DeepL doesn't offer Thai, Azure does (fictional lists and keys).
  const config = () => getConfig({ ...BASE_ENV, DEEPL_API_KEY: "fictional-card:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" } as NodeJS.ProcessEnv);
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api-free.deepl.com" && url.pathname === "/v2/languages") return Response.json([{ language: "DE" }, { language: "FR" }]);
    if (url.hostname === "api-free.deepl.com" && url.pathname === "/v2/usage") return Response.json({ character_count: 0, character_limit: 500_000 });
    if (url.pathname === "/languages") return Response.json({ translation: { de: { name: "German" }, fr: { name: "French" }, th: { name: "Thai" } } });
    // Azure's free key check: one empty text.
    if (url.pathname === "/translate" && init?.body === JSON.stringify([{ text: "" }])) return Response.json([{ translations: [{ text: "", to: "de" }] }]);
    throw new Error(`unexpected request ${url.hostname}${url.pathname}`);
  }) as unknown as typeof fetch;

  it("counts the languages among the engines this store allowed: Azure serves nothing for a DeepL-only consent", async () => {
    clearEngineStatusCache();
    clearAzureLanguageCache();
    const card = await operatorEngines(config(), ["de", "th"], { fetch: fakeFetch, allowed: ["deepl"] });
    expect(card.deepl).toMatchObject({ firstChoice: 1, canStepIn: 0, allowed: true });
    expect(card.tiles).toEqual([expect.objectContaining({ id: "azure", state: "ok", firstChoice: 0, canStepIn: 0, allowed: false })]);
    // Thai is first choice for no engine: Azure translates nothing for this store yet.
    expect((card.deepl?.firstChoice ?? 0) + card.tiles.reduce((n, t) => n + t.firstChoice, 0)).toBe(1);
    // Once Azure is allowed too, it serves Thai first and can step in for German.
    const both = await operatorEngines(config(), ["de", "th"], { fetch: fakeFetch, allowed: ["deepl", "azure"] });
    expect(both.tiles).toEqual([expect.objectContaining({ id: "azure", firstChoice: 1, canStepIn: 1, allowed: true })]);
    // Before any consent: every configured engine, as the texts then describe all of them.
    const none = await operatorEngines(config(), ["de", "th"], { fetch: fakeFetch, allowed: [] });
    expect(none.tiles).toEqual([expect.objectContaining({ id: "azure", firstChoice: 1, allowed: true })]);
    expect(none.deepl).toMatchObject({ firstChoice: 1, allowed: true });
  });
});
