/**
 * The height of a rendered HTML text on Review (an original beside its
 * translation), so its box fits the text as the plain text boxes around it
 * do. The text sits in a sandboxed frame, which can't report its own
 * height, so the lines are counted per block (paragraph, heading, list item,
 * table row) at the box's text size, for each width a Review card can have.
 * The result is a Polaris responsive value the browser picks from with a
 * container query, so no box changes height after the page is shown. Each
 * width is the narrowest of its range and characters are counted
 * generously (wide scripts twice), so a box is rather a line too tall than
 * cut off; very long texts stop at MAX and scroll inside their box.
 *
 * Must match the frame's text-box style in app/components/HtmlPreview.tsx:
 * 13 px text on 20 px lines, 12 px above and below, paragraphs 0.75em
 * apart, nothing above the first block or below the last.
 */

const PADDING = 24;
const LINE = 20;
const MIN = 44;
export const MAX = 420;
/** An image's room (its height isn't known before it loads). */
const IMAGE = 200;

/**
 * Characters per line of the narrowest box in each range of card widths
 * (the card is the Polaris query container): phones of 320 to 360 px,
 * phones of 390 px, larger phones and narrow cards with the texts stacked,
 * two columns, wide two columns. About 7 px per character at 13 px, less
 * the room a wrapped word leaves at a line's end.
 */
export const TEXT_BOX_WIDTHS: ReadonlyArray<{ above: number; chars: number }> = [
  { above: 0, chars: 30 },
  { above: 340, chars: 37 },
  { above: 370, chars: 41 },
  { above: 400, chars: 46 },
  { above: 640, chars: 35 },
  { above: 900, chars: 54 },
];

type Kind = "text" | "item" | "row" | "h1" | "h2" | "h3" | "h4";

/** Per kind of block: line height, how much wider its letters are than body text's, space above and below (px). */
const METRICS: Record<Kind, { line: number; scale: number; above: number; below: number }> = {
  text: { line: LINE, scale: 1, above: 0, below: 10 },
  // Indented 1.5em; the list keeps 1em above and below.
  item: { line: LINE, scale: 1.1, above: 0, below: 0 },
  // Cells have padding and borders.
  row: { line: LINE + 9, scale: 1.3, above: 0, below: 0 },
  h1: { line: 33, scale: 2, above: 21, below: 11 },
  h2: { line: 25, scale: 1.5, above: 16, below: 8 },
  h3: { line: 19, scale: 1.17, above: 13, below: 7 },
  h4: { line: 17, scale: 1, above: 11, below: 6 },
};
const LIST_SPACE = 13;

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  ...["p", "div", "li", "ul", "ol", "blockquote", "pre", "hr", "section", "article", "figure", "figcaption"],
  ...["table", "thead", "tbody", "tr", "h1", "h2", "h3", "h4", "h5", "h6"],
]);

interface Block {
  kind: Kind;
  /** As written: a <br> starts a new line. */
  lines: string[];
}

function kindOf(tag: string): Kind {
  if (tag === "li") return "item";
  if (tag === "tr") return "row";
  if (tag === "h1" || tag === "h2" || tag === "h3") return tag;
  if (/^h[4-6]$/.test(tag)) return "h4";
  return "text";
}

function blocksOf(html: string): { blocks: Block[]; images: number } {
  const blocks: Block[] = [];
  let images = 0;
  let current: Block = { kind: "text", lines: [""] };
  const close = () => {
    if (current.lines.some((line) => line.trim())) blocks.push(current);
  };
  for (const token of html.split(/(<[^>]*>)/)) {
    if (!token.startsWith("<")) {
      // An entity (&nbsp;, &amp;, …) is one character.
      current.lines[current.lines.length - 1] += token.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, "x");
      continue;
    }
    const match = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    const tag = match?.[2]?.toLowerCase() ?? "";
    if (tag === "img") images++;
    if (tag === "br") current.lines.push("");
    else if (BLOCK_TAGS.has(tag)) {
      close();
      current = { kind: match?.[1] ? "text" : kindOf(tag), lines: [""] };
    }
  }
  close();
  return { blocks, images };
}

/** Chinese, Japanese and Korean letters and full-width forms take about two places. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g;

function places(text: string): number {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length + (plain.match(WIDE)?.length ?? 0);
}

/** The frame's height in px when a line of body text holds `chars` characters. */
export function textBoxHeight(html: string, chars: number): number {
  const { blocks, images } = blocksOf(html);
  let height = PADDING;
  let below = 0;
  blocks.forEach((block, i) => {
    const m = METRICS[block.kind];
    const perLine = Math.max(8, Math.floor(chars / m.scale));
    const lines = block.lines.reduce((n, line) => n + Math.max(1, Math.ceil(places(line) / perLine)), 0);
    if (i > 0) {
      // Where a list starts or ends, its own space (margins next to each other overlap: the larger counts).
      const list = (block.kind === "item") !== (blocks[i - 1]!.kind === "item") ? LIST_SPACE : 0;
      height += Math.max(below, m.above, list);
    }
    height += lines * m.line;
    below = m.below;
  });
  height += images * IMAGE;
  return Math.min(MAX, Math.max(MIN, Math.ceil(height)));
}

/**
 * The height of frames side by side as a Polaris responsive value: for each
 * width of the card, the tallest of the texts (an original and its
 * translation share one height).
 */
export function textBoxBlockSize(...htmls: string[]): `@container${string}` {
  const [narrowest, ...wider] = TEXT_BOX_WIDTHS.map(({ chars }) => Math.max(...htmls.map((html) => textBoxHeight(html, chars))));
  const conditions = wider.map((height, i) => `(inline-size > ${TEXT_BOX_WIDTHS[i + 1]!.above}px) ${height}px`);
  return `@container ${conditions.join(", ")}, ${narrowest}px`;
}
