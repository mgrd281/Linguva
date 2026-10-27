/**
 * Shopify rich text (metafield type rich_text_field) ⇄ markup for the
 * translation engine.
 *
 * The JSON is turned into HTML that the existing pipeline already handles
 * (sentences as segments, formatting and links as protected inline codes,
 * placeholders, glossary, memory) and the translated HTML back into JSON.
 * Each container (paragraph, heading, list, list item) becomes a <div> with
 * its type and settings, so nothing depends on how browsers nest headings
 * and paragraphs. Translations are rebuilt from the source markup only, and
 * the result must have exactly the source's containers and links, so a
 * translation can't change structure, heading levels or link targets.
 *
 * Unknown node types make a document untranslatable (left to Shopify's
 * editor) instead of being guessed at.
 */
import { defaultTreeAdapter as adapter, parseFragment, type DefaultTreeAdapterTypes as T } from "parse5";

export class RichTextError extends Error {
  constructor(reason: string) {
    super(`Rich text: ${reason}`);
    this.name = "RichTextError";
  }
}

type Inline =
  | { type: "text"; value: string; bold?: boolean; italic?: boolean }
  | { type: "link"; url: string; title?: string; target?: string; children: Inline[] };
type Block =
  | { type: "paragraph"; children: Array<Inline | Block> }
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "list"; listType: "ordered" | "unordered"; children: Block[] }
  | { type: "list-item"; children: Array<Inline | Block> };
interface Root {
  type: "root";
  children: Block[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MAX_DEPTH = 20;

function parseRoot(json: string): Root {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new RichTextError("not JSON");
  }
  if (!value || typeof value !== "object" || (value as Root).type !== "root" || !Array.isArray((value as Root).children)) {
    throw new RichTextError("no root");
  }
  return value as Root;
}

function inlineToHtml(node: Inline, depth: number): string {
  if (depth > MAX_DEPTH) throw new RichTextError("too deep");
  if (node.type === "text") {
    if (typeof node.value !== "string") throw new RichTextError("text without value");
    let html = esc(node.value);
    if (node.italic) html = `<em>${html}</em>`;
    if (node.bold) html = `<strong>${html}</strong>`;
    return html;
  }
  if (node.type === "link") {
    if (typeof node.url !== "string" || !Array.isArray(node.children)) throw new RichTextError("bad link");
    const attrs = [`href="${esc(node.url)}"`];
    if (typeof node.title === "string") attrs.push(`title="${esc(node.title)}"`);
    if (typeof node.target === "string") attrs.push(`target="${esc(node.target)}"`);
    return `<a ${attrs.join(" ")}>${node.children.map((c) => inlineToHtml(c, depth + 1)).join("")}</a>`;
  }
  throw new RichTextError(`unknown inline node ${(node as { type?: string }).type}`);
}

function nodeToHtml(node: Block | Inline, depth: number): string {
  if (depth > MAX_DEPTH) throw new RichTextError("too deep");
  switch (node.type) {
    case "text":
    case "link":
      return inlineToHtml(node, depth);
    case "paragraph":
    case "list-item":
      return `<div data-rt="${node.type}">${node.children.map((c) => nodeToHtml(c, depth + 1)).join("")}</div>`;
    case "heading": {
      const level = Number(node.level);
      if (!Number.isInteger(level) || level < 1 || level > 6) throw new RichTextError("bad heading level");
      return `<div data-rt="heading" data-level="${level}">${node.children.map((c) => inlineToHtml(c, depth + 1)).join("")}</div>`;
    }
    case "list":
      if (node.listType !== "ordered" && node.listType !== "unordered") throw new RichTextError("bad list type");
      return `<div data-rt="list" data-list="${node.listType}">${node.children.map((c) => nodeToHtml(c, depth + 1)).join("")}</div>`;
    default:
      throw new RichTextError(`unknown node ${(node as { type?: string }).type}`);
  }
}

/** Rich text JSON → markup for translation. Throws RichTextError for anything unknown. */
export function richTextToMarkup(json: string): string {
  return parseRoot(json).children.map((c) => nodeToHtml(c, 1)).join("");
}

export { richTextToPreviewHtml } from "../../lib/rich-text-preview";

/** True when a rich text value has the same structure and links as the source (any text). */
export function sameRichTextStructure(value: string, sourceJson: string): boolean {
  try {
    markupToRichText(richTextToMarkup(value), sourceJson);
    return true;
  } catch (error) {
    if (error instanceof RichTextError) return false;
    throw error;
  }
}

function attr(el: T.Element, name: string) {
  return el.attrs.find((a) => a.name === name)?.value;
}

function inlinesFrom(parent: T.ParentNode, marks: { bold: boolean; italic: boolean }): Inline[] {
  const out: Inline[] = [];
  for (const child of adapter.getChildNodes(parent)) {
    if (adapter.isTextNode(child)) {
      const value = adapter.getTextNodeContent(child);
      if (!value) continue;
      const prev = out[out.length - 1];
      // Neighbouring text with the same marks is one text node, as in Shopify's editor.
      if (prev?.type === "text" && Boolean(prev.bold) === marks.bold && Boolean(prev.italic) === marks.italic) {
        prev.value += value;
        continue;
      }
      out.push({ type: "text", value, ...(marks.bold ? { bold: true } : {}), ...(marks.italic ? { italic: true } : {}) });
    } else if (adapter.isElementNode(child)) {
      const el = child as T.Element;
      if (el.tagName === "strong" || el.tagName === "b") out.push(...inlinesFrom(el, { ...marks, bold: true }));
      else if (el.tagName === "em" || el.tagName === "i") out.push(...inlinesFrom(el, { ...marks, italic: true }));
      else if (el.tagName === "a") {
        const url = attr(el, "href");
        if (url === undefined) throw new RichTextError("link without url");
        const title = attr(el, "title");
        const target = attr(el, "target");
        out.push({
          type: "link",
          url,
          ...(title !== undefined ? { title } : {}),
          ...(target !== undefined ? { target } : {}),
          children: inlinesFrom(el, marks),
        });
      } else if (el.tagName === "div") throw new RichTextError("block inside text");
      else throw new RichTextError(`unexpected <${el.tagName}>`);
    }
  }
  return out;
}

function blocksFrom(parent: T.ParentNode, depth: number): Array<Block | Inline> {
  if (depth > MAX_DEPTH) throw new RichTextError("too deep");
  const out: Array<Block | Inline> = [];
  const pending: T.ChildNode[] = [];
  const flushInline = () => {
    if (!pending.length) return;
    const holder = adapter.createDocumentFragment();
    for (const n of pending.splice(0)) adapter.appendChild(holder, n);
    out.push(...inlinesFrom(holder, { bold: false, italic: false }));
  };
  for (const child of [...adapter.getChildNodes(parent)]) {
    const el = adapter.isElementNode(child) ? (child as T.Element) : null;
    const kind = el?.tagName === "div" ? attr(el, "data-rt") : undefined;
    if (!kind) {
      pending.push(child);
      continue;
    }
    flushInline();
    if (kind === "paragraph" || kind === "list-item") out.push({ type: kind, children: blocksFrom(el!, depth + 1) } as Block);
    else if (kind === "heading") out.push({ type: "heading", level: Number(attr(el!, "data-level")), children: inlinesFrom(el!, { bold: false, italic: false }) });
    else if (kind === "list") {
      const listType = attr(el!, "data-list") === "ordered" ? "ordered" : "unordered";
      out.push({ type: "list", listType, children: blocksFrom(el!, depth + 1) as Block[] });
    } else throw new RichTextError(`unknown container ${kind}`);
  }
  flushInline();
  return out;
}

/** What a translation must keep: containers, their settings and links (not text or emphasis). */
function skeleton(node: Block | Inline | Root): unknown {
  switch (node.type) {
    case "text":
      return null;
    case "link":
      return { link: node.url, target: node.target ?? null, children: node.children.map(skeleton).filter((x) => x !== null) };
    case "heading":
      return { heading: node.level, children: node.children.map(skeleton).filter((x) => x !== null) };
    case "list":
      return { list: node.listType, children: node.children.map(skeleton) };
    default:
      return { [node.type]: true, children: (node.children as Array<Block | Inline>).map(skeleton).filter((x) => x !== null) };
  }
}

/**
 * Translated markup → rich text JSON. Throws RichTextError when the result
 * doesn't have exactly the source's structure and links.
 */
export function markupToRichText(markup: string, sourceJson: string): string {
  const source = parseRoot(sourceJson);
  const children = blocksFrom(parseFragment(markup), 1);
  if (children.some((c) => c.type === "text" || c.type === "link")) throw new RichTextError("text outside a paragraph");
  const result: Root = { type: "root", children: children as Block[] };
  if (JSON.stringify(skeleton(result)) !== JSON.stringify(skeleton(source))) throw new RichTextError("structure changed");
  return JSON.stringify(result);
}
