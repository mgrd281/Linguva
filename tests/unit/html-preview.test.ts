/**
 * The preview frame's height (sandboxed, so it can't measure itself): lists
 * and paragraphs count, so a short description with a list isn't cut off.
 */
import { describe, expect, it } from "vitest";
import { previewHeight } from "../../app/components/HtmlPreview";

describe("preview height", () => {
  it("gives a short paragraph with a three-item list room for every line", () => {
    const html =
      "<p>A light, <strong>waterproof</strong> shell with taped seams and a hood that fits over a helmet.</p><ul><li>2 chest pockets</li><li>Packs into its own pocket</li><li>New: recycled fabric</li></ul>";
    // Two lines of text, three list items, paragraph and list spacing: about 170 px at 14/21 px.
    expect(previewHeight(html)).toBeGreaterThanOrEqual(170);
  });

  it("keeps one short line compact and caps long texts (they scroll)", () => {
    expect(previewHeight("<p>Short.</p>")).toBe(96);
    expect(previewHeight(`<p>${"word ".repeat(2000)}</p>`)).toBe(420);
  });

  it("grows with list items, not only with characters", () => {
    const items = (n: number) => `<ul>${"<li>x</li>".repeat(n)}</ul>`;
    expect(previewHeight(items(8))).toBeGreaterThan(previewHeight(items(2)));
  });
});
