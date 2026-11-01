/**
 * The operator's translation services card (app/components/TranslationEngines.tsx),
 * rendered on the server like the Plan page's parts: the order, a tile per
 * engine and state, never a key beyond its hint, every language complete.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationEngines } from "../../app/components/TranslationEngines";
import type { EnginesCard } from "../../app/.server/providers/engine-status";
import { APP_LOCALES, translator } from "../../app/i18n/i18n";

const CARD: EnginesCard = {
  order: ["deepl", "azure", "google"],
  totalLanguages: 4,
  deepl: { position: 1, keys: [{ position: 1, plan: "free", hint: "a1b2", used: 100_000, limit: 500_000, state: "ok" }], firstChoice: 3, canStepIn: 0 },
  tiles: [
    { id: "azure", position: 2, state: "ok", hint: "0000", access: { kind: "region", region: "westeurope" }, dataLocation: "eu", firstChoice: 1, canStepIn: 3 },
    { id: "google", position: 3, state: "refused", hint: "0000", access: { kind: "apiKey" }, dataLocation: "global", firstChoice: 0, canStepIn: 4 },
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

  it("renders in every interface language without a missing text", () => {
    for (const locale of APP_LOCALES) {
      const html = render(CARD, locale);
      expect(html, locale).not.toMatch(/overview\.engines\.|common\.engine\./);
    }
    expect(text(render(CARD, "de"))).toContain("Reihenfolge: DeepL → Microsoft Azure → Google Cloud");
  });
});
