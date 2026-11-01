/**
 * Lists of texts and links (metafields): only the texts are translated, the
 * JSON shape, item count and link addresses come from the source; anything
 * of another shape is refused.
 */
import { describe, expect, it } from "vitest";
import {
  sameStructuredShape,
  segmentStructuredText,
  structuredHasBlankItem,
  StructuredTextError,
  structuredTexts,
} from "../../app/.server/translation/structured-text";
import { keepsSourceStructure, leavesItemUntranslated, translateFields } from "../../app/.server/translation/translate-fields";
import { isStructuredValueType, structuredItems, withTexts } from "../../app/lib/structured-preview";
import type { TranslationProvider } from "../../app/.server/providers/types";

const german: TranslationProvider = {
  id: "test",
  async translate(request) {
    return {
      translations: request.segments.map((s) => s.replace("Warm", "Warm (de)").replace("Care guide", "Pflegehinweise").replace("Size chart", "Größentabelle")),
      billedCharacters: 1,
      provider: "test",
    };
  },
};

function translateDoc(type: string, json: string) {
  const doc = segmentStructuredText(type, json);
  return doc.render(new Map(doc.segments.map((s) => [s.id, `«${s.source}»`])));
}

describe("lists of texts", () => {
  it("translate each item and keep the order and count", () => {
    expect(translateDoc("LIST_SINGLE_LINE_TEXT_FIELD", '["Warm","Waterproof","Light"]')).toBe('["«Warm»","«Waterproof»","«Light»"]');
    expect(translateDoc("LIST_MULTI_LINE_TEXT_FIELD", '["Line one\\nLine two"]')).toBe('["«Line one\\nLine two»"]');
    // Items without letters (numbers, sizes like 42) are kept as they are.
    expect(translateDoc("LIST_SINGLE_LINE_TEXT_FIELD", '["Warm","42"]')).toBe('["«Warm»","42"]');
  });

  it("refuse other shapes", () => {
    for (const bad of ['{"a":1}', "[1,2]", "not json", '["a",null]']) {
      expect(() => structuredTexts("LIST_SINGLE_LINE_TEXT_FIELD", bad), bad).toThrow(StructuredTextError);
    }
    expect(() => structuredTexts("LIST_SINGLE_LINE_TEXT_FIELD", JSON.stringify(Array(129).fill("x")))).toThrow(StructuredTextError);
  });
});

describe("links", () => {
  const link = '{"text":"Care guide","url":"https://example.com/care"}';
  const links = '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]';

  it("translate only the text; the address comes from the source", () => {
    expect(JSON.parse(translateDoc("LINK", link))).toEqual({ text: "«Care guide»", url: "https://example.com/care" });
    expect(JSON.parse(translateDoc("LIST_LINK", links))).toEqual([
      { text: "«Care guide»", url: "https://example.com/care" },
      { text: "«Size chart»", url: "/pages/sizes" },
    ]);
  });

  it("refuse a posted value with another address, another count or extra keys", () => {
    expect(sameStructuredShape("LINK", '{"url":"https://example.com/care","text":"Pflege"}', link)).toBe(true);
    expect(sameStructuredShape("LINK", '{"text":"Pflege","url":"https://evil.example/"}', link)).toBe(false);
    expect(sameStructuredShape("LINK", '{"text":"Pflege","url":"https://example.com/care","onclick":"x"}', link)).toBe(false);
    expect(sameStructuredShape("LIST_LINK", '[{"text":"Pflege","url":"https://example.com/care"}]', links)).toBe(false);
    expect(sameStructuredShape("LIST_SINGLE_LINE_TEXT_FIELD", '["a","b"]', '["x","y"]')).toBe(true);
    expect(sameStructuredShape("LIST_SINGLE_LINE_TEXT_FIELD", '["a"]', '["x","y"]')).toBe(false);
  });
});

describe("through the translation engine", () => {
  it("lists and links are machine-translated; malformed values are left alone", async () => {
    const { outcomes } = await translateFields({
      engines: ["deepl"],
      provider: german,
      sourceLocale: "en",
      targetLocale: "de",
      fields: [
        { key: "a", value: '["Warm","Light"]', type: "LIST_SINGLE_LINE_TEXT_FIELD" },
        { key: "b", value: '[{"text":"Care guide","url":"https://example.com/care"}]', type: "LIST_LINK" },
        { key: "c", value: '{"broken":true}', type: "LINK" },
      ],
    });
    expect(outcomes[0]).toMatchObject({ status: "translated", value: '["Warm (de)","Light"]' });
    expect(outcomes[1]).toMatchObject({ status: "translated", value: '[{"text":"Pflegehinweise","url":"https://example.com/care"}]' });
    expect(outcomes[2]).toMatchObject({ status: "skipped", reason: "NOT_TRANSLATABLE" });
  });
});

describe("before saving (every write path)", () => {
  const links = { key: "value", type: "LIST_LINK", value: '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]' };

  it("refuse a changed structure for rich text, lists and links; other types are not checked", () => {
    expect(keepsSourceStructure(links, '[{"text":"Pflege","url":"https://example.com/care"},{"text":"Größen","url":"/pages/sizes"}]')).toBe(true);
    expect(keepsSourceStructure(links, '[{"text":"Pflege","url":"https://evil.example/"},{"text":"Größen","url":"/pages/sizes"}]')).toBe(false);
    const rich = { key: "value", type: "RICH_TEXT_FIELD", value: '{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Soft."}]}]}' };
    expect(keepsSourceStructure(rich, rich.value.replace("Soft.", "Weich."))).toBe(true);
    expect(keepsSourceStructure(rich, "<p>Weich.</p>")).toBe(false);
    expect(keepsSourceStructure({ key: "title", type: "SINGLE_LINE_TEXT_FIELD", value: "Jacket" }, '["not a list"]')).toBe(true);
  });

  it("find a list with an untranslated item", () => {
    expect(leavesItemUntranslated(links, '[{"text":"Pflege","url":"https://example.com/care"},{"text":" ","url":"/pages/sizes"}]')).toBe(true);
    expect(leavesItemUntranslated(links, '[{"text":"Pflege","url":"https://example.com/care"},{"text":"Größen","url":"/pages/sizes"}]')).toBe(false);
    expect(leavesItemUntranslated({ key: "title", type: "SINGLE_LINE_TEXT_FIELD", value: "Jacket" }, "")).toBe(false);
    // Items that are empty in the original may stay empty.
    expect(structuredHasBlankItem("LIST_SINGLE_LINE_TEXT_FIELD", '["Warm",""]', '["Warm",""]')).toBe(false);
  });
});

describe("in the browser", () => {
  it("rebuild the value from the original's items and addresses", () => {
    const source = '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]';
    expect(JSON.parse(withTexts("LIST_LINK", source, ["Pflege", "Größen"]))).toEqual([
      { text: "Pflege", url: "https://example.com/care" },
      { text: "Größen", url: "/pages/sizes" },
    ]);
    expect(withTexts("LIST_LINK", source, ["", " "])).toBe("");
    expect(withTexts("LIST_SINGLE_LINE_TEXT_FIELD", '["a","b"]', ["x"])).toBe('["x",""]');
    expect(JSON.parse(withTexts("LINK", '{"text":"Care","url":"/care"}', ["Pflege"]))).toEqual({ text: "Pflege", url: "/care" });
  });

  it("show readable items, and nothing for other shapes or types", () => {
    expect(structuredItems("LIST_LINK", '[{"text":"Care","url":"/care"}]')).toEqual([{ text: "Care", url: "/care" }]);
    expect(structuredItems("LIST_SINGLE_LINE_TEXT_FIELD", '{"a":1}')).toBeNull();
    expect(structuredItems("SINGLE_LINE_TEXT_FIELD", '["a"]')).toBeNull();
    expect([isStructuredValueType("RICH_TEXT_FIELD"), isStructuredValueType("LINK"), isStructuredValueType("HTML"), isStructuredValueType(null)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
