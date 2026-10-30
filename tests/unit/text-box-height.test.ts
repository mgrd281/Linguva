/**
 * Review's rendered HTML boxes fit their text (app/lib/text-box-height.ts):
 * a short text is as tall as a plain text box, longer ones grow by lines and
 * blocks, and the height comes as a Polaris responsive value for each width
 * a card can have. Measured in the browser against the frame's own style
 * (13/20 px): never shorter than the rendered text at the narrowest width of
 * each range, at most a few lines taller.
 */
import { describe, expect, it } from "vitest";
import { MAX, TEXT_BOX_WIDTHS, textBoxBlockSize, textBoxHeight } from "../../app/lib/text-box-height";

const PHONE = TEXT_BOX_WIDTHS[1]!.chars;
const WIDE = TEXT_BOX_WIDTHS.at(-1)!.chars;

describe("text box height", () => {
  it("gives a short text the height of a plain text box (one 20 px line and 12 px above and below)", () => {
    expect(textBoxHeight("<p>Warm <b>jacket</b> number 1.</p>", PHONE)).toBe(44);
    expect(textBoxHeight("Plain text without a paragraph", WIDE)).toBe(44);
  });

  it("counts lines per paragraph, with the space between paragraphs", () => {
    const two = "<p>Double-walled steel keeps drinks cold for 24 hours or hot for 12 hours.</p>";
    expect(textBoxHeight(two, WIDE)).toBe(64);
    expect(textBoxHeight(`${two}<p>Dishwasher safe.</p>`, WIDE)).toBe(64 + 10 + 20);
  });

  it("is taller in a narrower box", () => {
    const html = `<p>${"Waterproof and breathable for long walks in wind and rain. ".repeat(4)}</p>`;
    expect(textBoxHeight(html, TEXT_BOX_WIDTHS[0]!.chars)).toBeGreaterThan(textBoxHeight(html, WIDE));
  });

  it("gives list items, line breaks, headings and pictures their room", () => {
    const list = "<p>Shell with a hood.</p><ul><li>2 chest pockets</li><li>Packs into its own pocket</li><li>Recycled fabric</li></ul>";
    expect(textBoxHeight(list, WIDE)).toBe(24 + 20 + 13 + 3 * 20);
    expect(textBoxHeight("<p>Size S: 50 cm<br>Size M: 52 cm<br>Size L: 54 cm</p>", WIDE)).toBe(24 + 3 * 20);
    // The heading's space below (0.4em of 19.5 px) is all there is between it and the paragraph.
    expect(textBoxHeight("<h2>Care</h2><p>Wash at 30 °C.</p>", WIDE)).toBe(24 + 25 + 8 + 20);
    expect(textBoxHeight('<p>Front view</p><img src="https://cdn.shopify.com/a.jpg">', WIDE)).toBeGreaterThanOrEqual(44 + 200);
  });

  it("counts Chinese, Japanese and Korean letters twice (they are about twice as wide)", () => {
    const latin = `<p>${"a".repeat(30)}</p>`;
    const japanese = `<p>${"防".repeat(30)}</p>`;
    expect(textBoxHeight(japanese, PHONE)).toBeGreaterThan(textBoxHeight(latin, PHONE));
  });

  it("stops at the most a box shows (longer texts scroll inside it)", () => {
    expect(textBoxHeight(`<p>${"word ".repeat(2000)}</p>`, WIDE)).toBe(MAX);
  });

  it("gives frames side by side one height per card width, as a Polaris responsive value", () => {
    const short = "<p>Short.</p>";
    const long = `<p>${"Waterproof and breathable for long walks in wind and rain. ".repeat(3)}</p>`;
    const value = textBoxBlockSize(short, long);
    const heights = TEXT_BOX_WIDTHS.map(({ chars }) => textBoxHeight(long, chars));
    expect(value).toBe(
      `@container (inline-size > 340px) ${heights[1]}px, (inline-size > 370px) ${heights[2]}px, (inline-size > 400px) ${heights[3]}px, (inline-size > 640px) ${heights[4]}px, (inline-size > 900px) ${heights[5]}px, ${heights[0]}px`,
    );
    // The rules of tests/unit/responsive-values.test.ts: one "@container", narrower conditions first, no comma of a value's own.
    expect(value.match(/@container/g)).toHaveLength(1);
    expect(value).not.toMatch(/\([^()]*,[^()]*\)/);
    const sizes = [...value.matchAll(/inline-size\s*>\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});
