/**
 * Our segment markup on the wire of an HTML engine (Azure Translator, Google
 * Cloud Translation), and back.
 *
 * Our codes are XML-style (`<g id="1">…</g>`, `<x id="2"/>`), but these
 * engines parse HTML: `<x id="2"/>` isn't self-closing there (the next words
 * end up inside it), Google calls other markup "undefined" and Azure wants
 * "a well-formed, complete element". So segments with codes go as standard
 * HTML elements (`<span id="lg1">…</span>`, `<img id="lx2"/>`), segments
 * without codes as plain text.
 *
 * The decoder trusts nothing in the output: it accepts our codes in the
 * forms engines are seen to return (case, quoting, extra attributes such as
 * a right-to-left style, `<img …></img>`), turns every entity into text, and
 * refuses anything else. A refused segment becomes UNMAPPABLE_SEGMENT, which
 * parseMarkup rejects, so even a caller that ignores the note can't publish
 * it. Element names and attributes are restored from the source document
 * later, as for DeepL: an engine can't introduce markup.
 */
import { decodeHTMLStrict } from "entities";
import { defaultTreeAdapter as adapter, parseFragment, type DefaultTreeAdapterTypes as T } from "parse5";
import {
  escapeXml,
  parseMarkup,
  unescapeXml,
  type MarkupNode,
} from "../translation/segment-markup";
import type { SegmentNoteCode } from "./types";

export type WireMode = "html" | "plain";
/** "html": <span id="lgN">…</span> and <img id="lxN"/> (production). "native": <g id="N">…</g> and <x id="N"></x> (contract harness only). */
export type WireDialect = "html" | "native";

export interface CodeShape {
  kind: "g" | "x";
  /** g only: the source group starts / ends with a space or tab. */
  innerLead?: boolean;
  innerTrail?: boolean;
  /** The source has a space or tab directly before / after the code. */
  outerLead?: boolean;
  outerTrail?: boolean;
  /** g only: the source group holds letters or digits (an emptied link or bold is a broken result). */
  hasWords?: boolean;
  /** g only: the source group holds an inline code (a placeholder or a nested group). */
  hasCodes?: boolean;
  /** g only: the source group has no children (an icon <i></i>): the only group an engine may self-close. */
  empty?: boolean;
}

export interface WireSegment {
  mode: WireMode;
  /** What is sent to the engine. */
  wire: string;
  /** Characters of the text without inline codes: what the merchant is counted. */
  textChars: number;
  codes: ReadonlyMap<number, CodeShape>;
  /** The source text contains "&": entity-like text in plain-mode output is then literal. */
  hasAmpersand: boolean;
  /** The source text contains "<" (as text). */
  hasLessThan: boolean;
  /** The source text itself contains "<br" or "</br" (as text): a break in the output can't be told from it. */
  hasBrText: boolean;
  /** Hard line breaks in the source (sent as <br/> in HTML mode). */
  breaks: number;
  /** "\r\n" when the source's first line break is CRLF, else "\n". */
  newline: "\n" | "\r\n";
}

/** parseMarkup rejects it (UNBALANCED_TAGS): the field is discarded by the existing path, never published. */
export const UNMAPPABLE_SEGMENT = "</g>";

const REFUSED = { text: UNMAPPABLE_SEGMENT, note: "ENGINE_MARKUP" as const };
const LINE_BREAK = /\r\n|\n|\r/g;
const WORD = /[\p{L}\p{N}]/u;
/** Letters (with their combining marks) and digits: what can't touch across a lost space. */
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
/** Scripts written without spaces between words (Script_Extensions, so ー and 。 count too). */
const NO_SPACE_CHAR = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]$/u;
const NO_SPACE_TARGETS = new Set(["ja", "zh", "th", "lo", "km", "my"]);
/** The only elements an engine may return: our codes, their native forms and line breaks. */
const ALLOWED_TAGS = new Set(["span", "img", "g", "x", "br"]);

// ---------------------------------------------------------------- encode

function plainText(nodes: MarkupNode[]): string {
  return nodes.map((n) => (n.kind === "text" ? n.value : n.kind === "g" ? plainText(n.children) : "")).join("");
}

function collectShapes(nodes: MarkupNode[], shapes: Map<number, CodeShape>): void {
  nodes.forEach((node, i) => {
    if (node.kind === "text") return;
    const before = nodes[i - 1];
    const after = nodes[i + 1];
    const outerLead = before?.kind === "text" && /[ \t]$/.test(before.value);
    const outerTrail = after?.kind === "text" && /^[ \t]/.test(after.value);
    if (node.kind === "x") {
      shapes.set(node.id, { kind: "x", outerLead, outerTrail });
      return;
    }
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    shapes.set(node.id, {
      kind: "g",
      innerLead: first?.kind === "text" && /^[ \t]/.test(first.value),
      innerTrail: last?.kind === "text" && /[ \t]$/.test(last.value),
      outerLead,
      outerTrail,
      hasWords: WORD.test(plainText(node.children)),
      hasCodes: node.children.some((c) => c.kind !== "text"),
      empty: node.children.length === 0,
    });
    collectShapes(node.children, shapes);
  });
}

/**
 * Our segment markup → what an HTML engine is sent. Without inline codes the
 * text goes as plain text (no entity or whitespace effects on titles, SEO
 * fields, multi-line text), unless it contains "<mstrans:": Azure's dynamic
 * dictionary works in plain mode too, so such text goes escaped in HTML mode
 * and can't steer the output.
 */
export function encodeSegment(source: string, options: { softBreaks?: boolean; dialect?: WireDialect } = {}): WireSegment {
  const nodes = parseMarkup(source);
  const text = plainText(nodes);
  const codes = new Map<number, CodeShape>();
  collectShapes(nodes, codes);
  const firstBreak = /\r\n|\n|\r/.exec(text)?.[0];
  const base = {
    textChars: text.length,
    codes,
    hasAmpersand: text.includes("&"),
    hasLessThan: text.includes("<"),
    hasBrText: /<\/?br\b/i.test(text),
    // In HTML fields a line break is whitespace, not a break the merchant typed.
    breaks: options.softBreaks ? 0 : (text.match(LINE_BREAK)?.length ?? 0),
    newline: firstBreak === "\r\n" ? ("\r\n" as const) : ("\n" as const),
  };
  if (codes.size === 0 && !/<mstrans:/i.test(text)) return { mode: "plain", wire: text, ...base };

  const native = options.dialect === "native";
  const textToWire = (value: string) => {
    const escaped = escapeXml(value);
    // HTML mode collapses a raw line break into a space; a real one goes as <br/>.
    return options.softBreaks ? escaped : escaped.replace(LINE_BREAK, "<br/>");
  };
  const toWire = (list: MarkupNode[]): string =>
    list
      .map((node) => {
        if (node.kind === "text") return textToWire(node.value);
        if (node.kind === "x") return native ? `<x id="${node.id}"></x>` : `<img id="lx${node.id}"/>`;
        const inner = toWire(node.children);
        return native ? `<g id="${node.id}">${inner}</g>` : `<span id="lg${node.id}">${inner}</span>`;
      })
      .join("");
  return { mode: "html", wire: toWire(nodes), ...base };
}

// ---------------------------------------------------------------- decode

type Token =
  | { t: "text"; v: string }
  | { t: "open"; id: number }
  | { t: "close"; id: number }
  | { t: "x"; id: number }
  | { t: "br" };

/** A complete HTML5 named reference ("&notin;", never the legacy prefix of "&notanentity;"). */
function isNamedReference(reference: string): boolean {
  const decoded = decodeHTMLStrict(reference);
  return decoded !== reference && [...decoded].length <= 2;
}

/**
 * The raw output made safe for parse5, or null when it holds an element we
 * never send. parse5 would otherwise drop text silently: an unterminated tag
 * at the end ("a <b" → "a "), legacy entities without ";" ("Cut&copy" →
 * "Cut©", "&notanentity;" → "¬anentity;"), and elements it doesn't place
 * (<html>, <col>, <tr> move or drop their content). `endTags`: the end tags
 * it kept (an `</img>` right after its `<img>` aside: parse5 records none for
 * it), so the decoder can tell when parse5 dropped one that closed nothing.
 */
function pretokenise(raw: string): { html: string; endTags: number } | null {
  // parse5 turns <br></br> into two breaks.
  const s = raw.replace(/<\/br\s*>/gi, "");
  let out = "";
  let endTags = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "&") {
      const ref = /^&(?:#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{0,40};)/.exec(s.slice(i, i + 48))?.[0];
      if (ref && (ref[1] === "#" || isNamedReference(ref))) {
        out += ref;
        i += ref.length;
      } else {
        out += "&amp;";
        i += 1;
      }
      continue;
    }
    if (c === "<") {
      const nextLt = s.indexOf("<", i + 1);
      const before = (end: number) => end !== -1 && (nextLt === -1 || nextLt > end);
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        if (before(end)) {
          out += s.slice(i, end + 3);
          i = end + 3;
          continue;
        }
      } else {
        const name = /^<\/?([A-Za-z][A-Za-z0-9:-]*)/.exec(s.slice(i, i + 64))?.[1];
        const end = name ? s.indexOf(">", i + 1) : -1;
        if (name && before(end)) {
          if (!ALLOWED_TAGS.has(name.toLowerCase())) return null;
          if (s[i + 1] === "/" && !(name.toLowerCase() === "img" && /<img\b[^<>]*>$/i.test(out))) endTags++;
          out += s.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      // Not markup: "a <b", "x < y", "Größe <M und L" stay text.
      out += "&lt;";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return { html: out, endTags };
}

function codeId(value: string | undefined, pattern: RegExp): number | null {
  const digits = value === undefined ? undefined : pattern.exec(value)?.[1];
  return digits === undefined ? null : Number(digits);
}

/**
 * parse5 nodes → tokens. False when the output holds anything but text, our
 * codes and line breaks. Ids are matched case-insensitively (parse5 keeps the
 * case of attribute values: ID='LG1' → "LG1"); every other attribute (style,
 * dir, class, translate) is ignored. `html` is the parsed text (for the
 * elements' source locations).
 */
function walk(nodes: T.ChildNode[], codes: ReadonlyMap<number, CodeShape>, out: Token[], html: string): boolean {
  for (const node of nodes) {
    if (adapter.isTextNode(node)) {
      out.push({ t: "text", v: adapter.getTextNodeContent(node) });
      continue;
    }
    // A comment (we never send one) would hide text; anything else isn't ours.
    if (!adapter.isElementNode(node)) return false;
    const tag = adapter.getTagName(node);
    if (tag === "br") {
      out.push({ t: "br" });
      continue;
    }
    const idValue = adapter.getAttrList(node).find((a) => a.name === "id")?.value;
    const group =
      tag === "span" || tag === "g"
        ? (codeId(idValue, /^lg(\d{1,9})$/i) ?? (tag === "g" ? codeId(idValue, /^(\d{1,9})$/) : null))
        : null;
    const placeholder =
      tag === "img" || tag === "span" || tag === "x"
        ? (codeId(idValue, /^lx(\d{1,9})$/i) ?? (tag === "x" ? codeId(idValue, /^(\d{1,9})$/) : null))
        : null;
    if (group !== null) {
      const shape = codes.get(group);
      const location = node.sourceCodeLocation;
      if (!location?.endTag) {
        // HTML ignores "/>" on a <span>, and a missing </span> is closed at the end of the parent:
        // either way the group would swallow the rest of the sentence. We always send </span>, so
        // only an empty source group (an icon) may come back self-closed: the XML meaning, with
        // what follows it placed after it.
        const startTag = location?.startTag;
        const selfClosed = startTag !== undefined && /\/\s*>$/.test(html.slice(startTag.startOffset, startTag.endOffset));
        if (!selfClosed || shape?.kind !== "g" || !shape.empty) return false;
        out.push({ t: "open", id: group }, { t: "close", id: group });
        if (!walk(adapter.getChildNodes(node), codes, out, html)) return false;
        continue;
      }
      const start = out.length;
      out.push({ t: "open", id: group });
      if (!walk(adapter.getChildNodes(node), codes, out, html)) return false;
      out.push({ t: "close", id: group });
      const inner = out.slice(start + 1, -1);
      const words = inner.some((tok) => tok.t === "text" && WORD.test(tok.v));
      const codesInside = inner.some((tok) => tok.t === "x" || tok.t === "open");
      // An emptied link or bold: the engine lost its words, or moved its only placeholder out
      // (a linked URL or e-mail left as an empty link next to unlinked text).
      if (shape?.kind === "g" && ((shape.hasWords && !words) || (shape.hasCodes && !words && !codesInside))) return false;
    } else if (placeholder !== null) {
      // A placeholder never holds text: "<x id="2"/>B" parses as x("B"), so B goes after it.
      out.push({ t: "x", id: placeholder });
      if (!walk(adapter.getChildNodes(node), codes, out, html)) return false;
    } else {
      return false;
    }
  }
  return true;
}

const isCode = (tok: Token | undefined) => tok !== undefined && (tok.t === "open" || tok.t === "close" || tok.t === "x");
const firstChar = (s: string) => (s ? String.fromCodePoint(s.codePointAt(0)!) : "");
const lastChar = (s: string) => {
  const chars = Array.from(s);
  return chars[chars.length - 1] ?? "";
};

/** Adjacent text tokens joined, empty ones dropped. */
function compact(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const tok of tokens) {
    if (tok.t === "text") {
      if (!tok.v) continue;
      const prev = out[out.length - 1];
      if (prev?.t === "text") {
        prev.v += tok.v;
        continue;
      }
      out.push({ t: "text", v: tok.v });
    } else {
      out.push(tok);
    }
  }
  return out;
}

/**
 * The character directly before / after tokens[i], looking through group tags; "" at the edge.
 * A placeholder renders as content (a protected term, URL, e-mail, Liquid code, an image): it
 * counts as a word ("x"), not as see-through. The decoder can't tell a literal from an <img>,
 * and a lost separator next to either is visible.
 */
function charBefore(tokens: Token[], i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    const tok = tokens[j]!;
    if (tok.t === "text") return lastChar(tok.v);
    if (tok.t === "x") return "x";
    if (!isCode(tok)) return "";
  }
  return "";
}

function charAfter(tokens: Token[], i: number): string {
  for (let j = i + 1; j < tokens.length; j++) {
    const tok = tokens[j]!;
    if (tok.t === "text") return firstChar(tok.v);
    if (tok.t === "x") return "x";
    if (!isCode(tok)) return "";
  }
  return "";
}

/** Space the engine put inside a group where the source had none goes outside it (merged later, never deleted). */
function moveInnerSpace(tokens: Token[], codes: ReadonlyMap<number, CodeShape>): Token[] {
  const list = [...tokens];
  // Right to left for leading space, so an inner group's space can move on out of the outer group.
  for (let i = list.length - 1; i >= 0; i--) {
    const tok = list[i]!;
    const shape = tok.t === "open" ? codes.get(tok.id) : undefined;
    const next = list[i + 1];
    if (!shape || shape.kind !== "g" || shape.innerLead || next?.t !== "text") continue;
    const space = /^[ \t]+/.exec(next.v)?.[0];
    if (!space) continue;
    next.v = next.v.slice(space.length);
    const prev = list[i - 1];
    if (prev?.t === "text") prev.v += space;
    else list.splice(i, 0, { t: "text", v: space });
  }
  // Left to right for trailing space.
  for (let i = 0; i < list.length; i++) {
    const tok = list[i]!;
    const shape = tok.t === "close" ? codes.get(tok.id) : undefined;
    const prev = list[i - 1];
    if (!shape || shape.kind !== "g" || shape.innerTrail || prev?.t !== "text") continue;
    const space = /[ \t]+$/.exec(prev.v)?.[0];
    if (!space) continue;
    prev.v = prev.v.slice(0, -space.length);
    const next = list[i + 1];
    if (next?.t === "text") next.v = space + next.v;
    else list.splice(i + 1, 0, { t: "text", v: space });
  }
  return compact(list);
}

/** A run of 2+ spaces or tabs next to a code becomes one space. */
function collapseSpace(tokens: Token[]): void {
  tokens.forEach((tok, i) => {
    if (tok.t !== "text") return;
    if (isCode(tokens[i + 1])) tok.v = tok.v.replace(/[ \t]{2,}$/, " ");
    if (isCode(tokens[i - 1])) tok.v = tok.v.replace(/^[ \t]{2,}/, " ");
  });
}

/**
 * Targets written without spaces between words: a space next to a code goes
 * when the characters on both sides (looking through the codes) are of such
 * a script ("日本 <g>語</g>" → "日本<g>語</g>"; "iPhone <g>15</g>" keeps it).
 */
function dropSpaceBetweenScripts(tokens: Token[]): Token[] {
  const blank = (tok: Token) => tok.t === "text" && /^[ \t]+$/.test(tok.v);
  let i = 0;
  while (i < tokens.length) {
    if (!isCode(tokens[i])) {
      i++;
      continue;
    }
    // A cluster: codes, and space-only text between them.
    const start = i;
    while (i < tokens.length && (isCode(tokens[i]) || blank(tokens[i]!))) i++;
    const left = tokens[start - 1];
    const right = tokens[i];
    const leftText = left?.t === "text" ? left : undefined;
    const rightText = right?.t === "text" ? right : undefined;
    const leftChar = leftText ? lastChar(leftText.v.replace(/[ \t]+$/, "")) : "";
    const rightChar = rightText ? firstChar(rightText.v.replace(/^[ \t]+/, "")) : "";
    if (NO_SPACE_CHAR.test(leftChar) && NO_SPACE_CHAR.test(rightChar)) {
      if (leftText) leftText.v = leftText.v.replace(/[ \t]+$/, "");
      if (rightText) rightText.v = rightText.v.replace(/^[ \t]+/, "");
      for (let j = start; j < i; j++) if (blank(tokens[j]!)) (tokens[j] as { v: string }).v = "";
    }
  }
  return compact(tokens);
}

/**
 * Targets written with spaces: where the source had a space at a code
 * boundary and the output has a letter or digit directly on both sides, the
 * words are glued ("Kaufe<g>zwei</g>jetzt"). Not fixed silently: German
 * compounds legitimately lose the space. A placeholder is a word itself, so
 * each of its sides is checked on its own ("Kaufen Sie <x/>heute": the
 * protected brand runs into "heute").
 */
function gluedWords(tokens: Token[], codes: ReadonlyMap<number, CodeShape>): boolean {
  return tokens.some((tok, i) => {
    if (tok.t !== "open" && tok.t !== "close" && tok.t !== "x") return false;
    const shape = codes.get(tok.id);
    if (!shape) return false;
    const before = WORD_CHAR.test(charBefore(tokens, i));
    const after = WORD_CHAR.test(charAfter(tokens, i));
    if (tok.t === "x") return shape.kind === "x" && ((Boolean(shape.outerLead) && before) || (Boolean(shape.outerTrail) && after));
    const spaced = shape.kind === "g" && (tok.t === "open" ? shape.outerLead : shape.outerTrail);
    return Boolean(spaced) && before && after;
  });
}

/** Elements parse5 closed with an end tag of their own. */
function closedElements(nodes: T.ChildNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (!adapter.isElementNode(node)) continue;
    if (node.sourceCodeLocation?.endTag) count++;
    count += closedElements(adapter.getChildNodes(node));
  }
  return count;
}

/** Tokens → our segment markup, exactly as mock.ts serialises a tree. */
function serialise(tokens: Token[]): string {
  return tokens
    .map((tok) =>
      tok.t === "text" ? escapeXml(tok.v)
      : tok.t === "open" ? `<g id="${tok.id}">`
      : tok.t === "close" ? "</g>"
      : tok.t === "x" ? `<x id="${tok.id}"/>`
      : "",
    )
    .join("");
}

function decodeHtml(output: string, segment: WireSegment, targetLocale: string): { text: string; note?: SegmentNoteCode } {
  // The merchant's own "<br>" as text, un-escaped by the engine, can't be told from a break:
  // refused rather than turned into a space or deleted.
  if (segment.hasBrText && /<\/?br\b/i.test(output)) return REFUSED;
  const pre = pretokenise(output);
  if (pre === null) return REFUSED;
  const { html } = pre;
  const fragment = adapter.getChildNodes(parseFragment(html, { sourceCodeLocationInfo: true }));
  // The source's own tag text ("&lt;/span&gt;"), un-escaped by the engine, is an end tag that
  // closes nothing: parse5 drops it silently, and the word with it.
  if (segment.hasLessThan && pre.endTags > closedElements(fragment)) return REFUSED;
  const raw: Token[] = [];
  if (!walk(fragment, segment.codes, raw, html)) return REFUSED;

  // Line breaks: fewer than the source's are kept; invented ones in a one-line
  // source are spaces; more than a multi-line source had can't be placed.
  const breaks = raw.filter((tok) => tok.t === "br").length;
  if (segment.breaks > 0 && breaks > segment.breaks) return REFUSED;
  const asText = segment.breaks === 0 ? " " : segment.newline;
  const texts = raw.map((tok): Token => (tok.t === "br" ? { t: "text", v: asText } : tok));

  // A closing tag the pre-tokeniser kept as text ("x</span") is a broken tag, not words.
  if (!segment.hasLessThan && texts.some((tok) => tok.t === "text" && /<\/[A-Za-z]/.test(tok.v))) return REFUSED;

  let tokens = moveInnerSpace(compact(texts), segment.codes);
  collapseSpace(tokens);
  const noSpaces = NO_SPACE_TARGETS.has(targetLocale.toLowerCase().split("-")[0]!);
  if (noSpaces) tokens = dropSpaceBetweenScripts(tokens);
  const note = !noSpaces && gluedWords(tokens, segment.codes) ? ("SPACING_CHANGED" as const) : undefined;

  // Sources are trimmed (render restores the outer whitespace).
  const first = tokens[0];
  if (first?.t === "text") first.v = first.v.replace(/^\s+/, "");
  const last = tokens[tokens.length - 1];
  if (last?.t === "text") last.v = last.v.replace(/\s+$/, "");
  const text = serialise(compact(tokens));
  return note ? { text, note } : { text };
}

/**
 * An engine's output for one segment → our segment markup. The result holds
 * only `<g id>`, `</g>`, `<x id/>` and XML-escaped text. Unknown or repeated
 * ids are kept as codes: assertSameCodes downstream rejects them.
 */
export function decodeSegment(output: string, segment: WireSegment, targetLocale: string): { text: string; note?: SegmentNoteCode } {
  if (segment.mode === "html") return decodeHtml(output, segment, targetLocale);
  // Plain mode: entities are the engine's escaping, unless the source itself had a "&".
  const text =
    !segment.hasAmpersand && /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/.test(output) ? unescapeXml(output) : output;
  return { text: escapeXml(text).trim() };
}
