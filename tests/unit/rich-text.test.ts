import { describe, expect, it } from "vitest";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { markupToRichText, richTextToMarkup, richTextToPreviewHtml, RichTextError } from "../../app/.server/translation/rich-text";
import { completeTranslation, isMachineTranslatable, prepareTranslation } from "../../app/.server/translation/translate-fields";
import type { TranslationProvider } from "../../app/.server/providers/types";

const doc = (children: unknown[]) => JSON.stringify({ type: "root", children });
const SAMPLE = doc([
  { type: "heading", level: 2, children: [{ type: "text", value: "Care instructions" }] },
  {
    type: "paragraph",
    children: [
      { type: "text", value: "Wash at " },
      { type: "text", value: "30 degrees", bold: true },
      { type: "text", value: " and read the " },
      { type: "link", url: "https://example.com/care", title: "Care guide", children: [{ type: "text", value: "care guide", italic: true }] },
      { type: "text", value: "." },
    ],
  },
  {
    type: "list",
    listType: "unordered",
    children: [
      { type: "list-item", children: [{ type: "text", value: "Do not tumble dry." }] },
      { type: "list-item", children: [{ type: "text", value: "Iron on low heat." }] },
    ],
  },
  // As in Shopify's documentation: a heading inside a paragraph.
  { type: "paragraph", children: [{ type: "heading", level: 3, children: [{ type: "text", value: "Materials" }] }] },
]);

describe("rich text conversion", () => {
  it("round-trips a document unchanged", () => {
    expect(JSON.parse(markupToRichText(richTextToMarkup(SAMPLE), SAMPLE))).toEqual(JSON.parse(SAMPLE));
  });

  it("renders a readable preview", () => {
    expect(richTextToPreviewHtml(SAMPLE)).toBe(
      '<h2>Care instructions</h2><p>Wash at <strong>30 degrees</strong> and read the <a href="https://example.com/care" title="Care guide"><em>care guide</em></a>.</p><ul><li>Do not tumble dry.</li><li>Iron on low heat.</li></ul><p><h3>Materials</h3></p>',
    );
  });

  it("refuses unknown parts instead of guessing", () => {
    expect(() => richTextToMarkup(doc([{ type: "table", children: [] }]))).toThrow(RichTextError);
    expect(() => richTextToMarkup("not json")).toThrow(RichTextError);
    expect(() => richTextToMarkup(doc([{ type: "heading", level: 9, children: [] }]))).toThrow(RichTextError);
  });

  it("rejects a translation that changes structure or links", () => {
    const markup = richTextToMarkup(SAMPLE);
    expect(() => markupToRichText(markup.replace("https://example.com/care", "https://evil.example"), SAMPLE)).toThrow("structure changed");
    expect(() => markupToRichText(markup.replace('data-level="2"', 'data-level="1"'), SAMPLE)).toThrow("structure changed");
    expect(() => markupToRichText(markup.replace(/<div data-rt="list-item">Iron on low heat\.<\/div>/, ""), SAMPLE)).toThrow("structure changed");
    expect(() => markupToRichText(markup + "<script>alert(1)</script>", SAMPLE)).toThrow(RichTextError);
  });
});

describe("rich text in the translation engine", () => {
  const field = { key: "value", value: SAMPLE, type: "RICH_TEXT_FIELD" };

  it("translates the text and keeps formatting, links and structure", async () => {
    expect(isMachineTranslatable(field)).toBe(true);
    const prepared = await prepareTranslation({ fields: [field] });
    // Sentences only: no JSON keys, URLs or markup sent to the provider.
    expect(prepared.pending.join(" ")).not.toMatch(/"type"|https:|data-rt/);
    const result = await completeTranslation(prepared, { engines: ["deepl"], provider: new MockTranslationProvider(), sourceLocale: "en", targetLocale: "de" });
    const outcome = result.outcomes[0]!;
    expect(outcome.status).toBe("translated");
    const value = JSON.parse((outcome as { value: string }).value);
    expect(value.children[0]).toEqual({ type: "heading", level: 2, children: [{ type: "text", value: "[de] Care instructions" }] });
    const link = value.children[1].children.find((c: { type: string }) => c.type === "link");
    expect(link).toMatchObject({ url: "https://example.com/care" });
    expect(value.children[2].children).toHaveLength(2);
  });

  it("rejects a provider answer that breaks the formatting", async () => {
    const prepared = await prepareTranslation({ fields: [field] });
    // A provider that drops every inline code (bold, link) from its answer.
    const lossy: TranslationProvider = {
      id: "lossy",
      async translate(req) {
        return { translations: req.segments.map((s) => s.replace(/<[^>]+>/g, "")), billedCharacters: 0, provider: "lossy" };
      },
    } as TranslationProvider;
    const result = await completeTranslation(prepared, { engines: ["deepl"], provider: lossy, sourceLocale: "en", targetLocale: "de" });
    expect(result.outcomes[0]).toMatchObject({ status: "rejected" });
  });

  it("checks the script of the words, not of the JSON keys", async () => {
    const arabic: TranslationProvider = {
      id: "ar",
      async translate(req) {
        return { translations: req.segments.map((s) => s.replace(/[A-Za-z]+(?![^<]*>)/g, "نص")), billedCharacters: 0, provider: "ar" };
      },
    } as TranslationProvider;
    const result = await completeTranslation(await prepareTranslation({ fields: [field] }), { engines: ["deepl"], provider: arabic, sourceLocale: "en", targetLocale: "ar" });
    const outcome = result.outcomes[0]!;
    expect(outcome.status).toBe("translated");
    expect((outcome as { issues: Array<{ code: string }> }).issues.map((i) => i.code)).not.toContain("WRONG_SCRIPT");
  });

  it("skips documents with unknown parts", async () => {
    const prepared = await prepareTranslation({ fields: [{ key: "value", value: doc([{ type: "table", children: [] }]), type: "RICH_TEXT_FIELD" }] });
    expect(prepared.outcomes[0]).toMatchObject({ status: "skipped", reason: "NOT_TRANSLATABLE" });
  });
});
