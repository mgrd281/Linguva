import { describe, expect, it } from "vitest";
import { alignDocuments } from "../../app/.server/memory/alignment";
import { normalizeSegment, segmentHash } from "../../app/.server/memory/translation-memory";
import { segmentHtml, segmentPlainText } from "../../app/.server/translation/html-segmenter";
import {
  prepareTranslation,
  translateFields,
  type MemoryLookup,
} from "../../app/.server/translation/translate-fields";
import type { TranslationProvider } from "../../app/.server/providers/types";

describe("segment hashing", () => {
  it("ignores whitespace differences", () => {
    expect(normalizeSegment("  Warm \n  jacket ")).toBe("Warm jacket");
    expect(segmentHash("Warm  jacket")).toBe(segmentHash(" Warm jacket\n"));
    expect(segmentHash("Warm jacket")).not.toBe(segmentHash("Warm Jacket"));
  });
});

describe("alignDocuments", () => {
  it("pairs a person's translation with the source, even with reordered tags", () => {
    const source = segmentHtml('<p>Buy <strong>two</strong> and <a href="/s">save</a>.</p><p>Free shipping</p>');
    const target = segmentHtml('<p>Mit <a href="/s">Sparen</a> beim Kauf von <strong>zwei</strong>.</p><p>Gratis Versand</p>');
    expect(alignDocuments(source, target)).toEqual([
      { source: 'Buy <g id="1">two</g> and <g id="2">save</g>.', target: 'Mit <g id="2">Sparen</g> beim Kauf von <g id="1">zwei</g>.' },
      { source: "Free shipping", target: "Gratis Versand" },
    ]);
  });

  it("skips segments whose formatting differs instead of guessing", () => {
    const source = segmentHtml("<p>Buy <b>two</b> now</p><p>Second</p>");
    const target = segmentHtml("<p>Kaufe zwei jetzt</p><p>Zweiter</p>");
    expect(alignDocuments(source, target)).toEqual([{ source: "Second", target: "Zweiter" }]);
  });

  it("returns nothing when the number of segments differs", () => {
    expect(alignDocuments(segmentHtml("<p>A b</p><p>C d</p>"), segmentHtml("<p>A b C d</p>"))).toEqual([]);
  });

  it("aligns protected spans by their literal value", () => {
    const source = segmentPlainText("Hello {{ name }}, see https://x.test");
    const target = segmentPlainText("Hallo {{ name }}, siehe https://x.test");
    expect(alignDocuments(source, target)).toEqual([
      { source: 'Hello <x id="1"/>, see <x id="2"/>', target: 'Hallo <x id="1"/>, siehe <x id="2"/>' },
    ]);
  });
});

describe("translation with memory", () => {
  function counting(): TranslationProvider & { sent: string[][] } {
    const sent: string[][] = [];
    return {
      id: "test",
      sent,
      async translate(request) {
        sent.push([...request.segments]);
        return {
          translations: request.segments.map((s) => `DE ${s}`),
          billedCharacters: request.segments.join("").length,
          provider: "test",
        };
      },
    };
  }
  const memoryOf = (entries: Record<string, string>): MemoryLookup => ({
    lookup: async (sources) =>
      new Map(sources.filter((s) => entries[s]).map((s) => [s, { target: entries[s]!, id: `m-${s}` }])),
  });

  it("uses memory for known segments and sends only the rest", async () => {
    const provider = counting();
    const result = await translateFields({
      engines: ["deepl"],
      provider,
      fields: [{ key: "body_html", value: "<p>Free shipping</p><p>New text</p>", type: "HTML" }],
      sourceLocale: "en",
      targetLocale: "de",
      memory: memoryOf({ "Free shipping": "Kostenloser Versand" }),
    });
    expect(provider.sent).toEqual([["New text"]]);
    expect(result.outcomes[0]).toMatchObject({
      status: "translated",
      value: "<p>Kostenloser Versand</p><p>DE New text</p>",
      fromMemory: 1,
    });
    expect(result.memoryHits).toBe(1);
    expect(result.charsSaved).toBe("Free shipping".length);
    expect(result.memoryEntryIds).toEqual(["m-Free shipping"]);
  });

  it("sends identical segments only once", async () => {
    const prepared = await prepareTranslation({
      fields: [
        { key: "title", value: "Free shipping", type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "body_html", value: "<p>Free shipping</p><ul><li>Free shipping</li></ul>", type: "HTML" },
      ],
    });
    expect(prepared.pending).toEqual(["Free shipping"]);
    expect(prepared.providerChars).toBe("Free shipping".length);
    expect(prepared.charsSaved).toBe(2 * "Free shipping".length);
  });

  it("doesn't call the provider when memory covers everything", async () => {
    const provider = counting();
    const result = await translateFields({
      engines: ["deepl"],
      provider,
      fields: [{ key: "title", value: "Free shipping", type: "SINGLE_LINE_TEXT_FIELD" }],
      sourceLocale: "en",
      targetLocale: "de",
      memory: memoryOf({ "Free shipping": "Gratis Versand" }),
    });
    expect(provider.sent).toEqual([]);
    expect(result.billedCharacters).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ value: "Gratis Versand" });
  });

  it("still validates memory results", async () => {
    const result = await translateFields({
      engines: ["deepl"],
      provider: counting(),
      fields: [{ key: "title", value: "Pack of 12", type: "SINGLE_LINE_TEXT_FIELD" }],
      sourceLocale: "en",
      targetLocale: "de",
      memory: memoryOf({ "Pack of 12": "Packung mit 10" }),
    });
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reason: "VALIDATION_FAILED" });
  });

  it("enforces preferred glossary wording that the provider never sees", async () => {
    const provider = counting();
    const result = await translateFields({
      engines: ["deepl"],
      provider,
      fields: [{ key: "title", value: "Warm hoodie", type: "SINGLE_LINE_TEXT_FIELD" }],
      sourceLocale: "en",
      targetLocale: "de",
      protect: { replacements: [{ term: "hoodie", value: "Kapuzenpullover" }] },
    });
    expect(provider.sent).toEqual([['Warm <x id="1"/>']]);
    expect(result.outcomes[0]).toMatchObject({ value: "DE Warm Kapuzenpullover" });
  });
});
