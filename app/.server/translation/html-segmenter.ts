import {
  defaultTreeAdapter as adapter,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as T,
} from "parse5";
import { findProtectedSpans, type ProtectOptions } from "./protect";
import {
  assertSameCodes,
  escapeXml,
  markupToPlainText,
  parseMarkup,
  SegmentStructureError,
  type MarkupNode,
} from "./segment-markup";

export interface Segment {
  /** Stable within one source document. */
  id: string;
  kind: "content" | "attribute";
  /** Segment markup to translate (see segment-markup.ts). */
  source: string;
  /** Source without inline codes, for memory lookups and length checks. */
  text: string;
}

export interface SegmentedDocument {
  segments: Segment[];
  /**
   * Rebuilds the document with the given translations (segment id → target
   * markup). Missing ids keep the source text. Throws SegmentStructureError
   * if a translation breaks the inline structure.
   */
  render(translations: ReadonlyMap<string, string>): string;
}

// Elements that flow inside a sentence and are translated with their text.
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "data", "del", "dfn", "em", "font",
  "i", "ins", "label", "mark", "q", "s", "small", "span", "strong", "sub",
  "sup", "time", "u",
]);
// Inline elements carried through unchanged as a single code.
const VOID_INLINE = new Set(["br", "wbr", "img"]);
const OPAQUE_INLINE = new Set([
  "code", "kbd", "samp", "var", "svg", "math", "input", "select", "textarea",
  "button", "video", "audio", "object", "canvas", "iframe", "embed", "picture",
]);
// Never descended into.
const SKIPPED_BLOCK = new Set(["script", "style", "pre", "template", "noscript"]);

const TRANSLATABLE_ATTRIBUTES = ["alt", "title", "placeholder", "aria-label"];

type Ref =
  | { kind: "element"; node: T.Element }
  | { kind: "opaque"; node: T.ChildNode }
  | { kind: "literal"; value: string };

interface RunPlan {
  segmentId: string;
  parent: T.ParentNode;
  nodes: T.ChildNode[];
  leading: string;
  trailing: string;
  refs: Map<number, Ref>;
}

interface AttributePlan {
  segmentId: string;
  element: T.Element;
  attribute: string;
  refs: Map<number, Ref>;
}

const isElement = (node: T.Node): node is T.Element => "tagName" in node;
const isText = (node: T.Node): node is T.TextNode => node.nodeName === "#text";

function isNoTranslate(element: T.Element): boolean {
  return element.attrs.some(
    (a) =>
      (a.name === "translate" && a.value.trim().toLowerCase() === "no") ||
      (a.name === "class" && /(^|\s)notranslate(\s|$)/.test(a.value)),
  );
}

function isOpaque(node: T.ChildNode): boolean {
  if (!isElement(node)) return node.nodeName === "#comment";
  return OPAQUE_INLINE.has(node.tagName) || (INLINE.has(node.tagName) && isNoTranslate(node));
}

/** Whether a node belongs inside a sentence-level run. */
function isRunNode(node: T.ChildNode): boolean {
  if (isText(node) || node.nodeName === "#comment") return true;
  if (!isElement(node)) return false;
  if (VOID_INLINE.has(node.tagName) || isOpaque(node)) return true;
  return INLINE.has(node.tagName) && node.childNodes.every(isRunNode);
}

function hasTranslatableText(markup: string): boolean {
  const text = markup.replace(/<x id="\d+"\/>/g, "").replace(/<\/?g[^>]*>/g, "");
  return /\p{L}/u.test(text);
}

class Encoder {
  private next = 1;
  readonly refs = new Map<number, Ref>();

  constructor(private readonly protect: ProtectOptions) {}

  text(value: string): string {
    let out = "";
    let cursor = 0;
    for (const span of findProtectedSpans(value, this.protect)) {
      out += escapeXml(value.slice(cursor, span.start));
      out += this.code({ kind: "literal", value: span.value });
      cursor = span.end;
    }
    return out + escapeXml(value.slice(cursor));
  }

  nodes(nodes: T.ChildNode[]): string {
    return nodes.map((n) => this.node(n)).join("");
  }

  private node(node: T.ChildNode): string {
    if (isText(node)) return this.text(node.value);
    if (!isElement(node) || VOID_INLINE.has(node.tagName) || isOpaque(node)) {
      return this.code({ kind: "opaque", node });
    }
    const id = this.next++;
    this.refs.set(id, { kind: "element", node });
    return `<g id="${id}">${this.nodes(node.childNodes)}</g>`;
  }

  private code(ref: Ref): string {
    const id = this.next++;
    this.refs.set(id, ref);
    return `<x id="${id}"/>`;
  }
}

function analyze(fragment: T.DocumentFragment, protect: ProtectOptions) {
  const segments: Segment[] = [];
  const runs: RunPlan[] = [];
  const attributes: AttributePlan[] = [];

  const addSegment = (kind: Segment["kind"], source: string) => {
    const id = `${kind === "content" ? "c" : "a"}${segments.length}`;
    segments.push({ id, kind, source, text: markupToPlainText(source) });
    return id;
  };

  const collectAttributes = (element: T.Element) => {
    if (isNoTranslate(element)) return;
    for (const name of TRANSLATABLE_ATTRIBUTES) {
      const attr = element.attrs.find((a) => a.name === name);
      if (!attr) continue;
      const encoder = new Encoder(protect);
      const source = encoder.text(attr.value).trim();
      if (!hasTranslatableText(source)) continue;
      attributes.push({
        segmentId: addSegment("attribute", source),
        element,
        attribute: name,
        refs: encoder.refs,
      });
    }
  };

  const walkAttributes = (node: T.ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (SKIPPED_BLOCK.has(child.tagName)) continue;
      collectAttributes(child);
      if (!OPAQUE_INLINE.has(child.tagName) && !isNoTranslate(child)) {
        walkAttributes(child);
      }
    }
  };

  const flush = (parent: T.ParentNode, run: T.ChildNode[]) => {
    if (run.length === 0) return;
    const encoder = new Encoder(protect);
    const encoded = encoder.nodes(run);
    if (!hasTranslatableText(encoded)) return;
    const leading = /^\s*/.exec(encoded)![0];
    const trailing = encoded.length > leading.length ? /\s*$/.exec(encoded)![0] : "";
    runs.push({
      segmentId: addSegment("content", encoded.slice(leading.length, encoded.length - trailing.length)),
      parent,
      nodes: [...run],
      leading,
      trailing,
      refs: encoder.refs,
    });
  };

  const walkContent = (parent: T.ParentNode) => {
    let run: T.ChildNode[] = [];
    for (const child of parent.childNodes) {
      if (isRunNode(child)) {
        run.push(child);
        continue;
      }
      flush(parent, run);
      run = [];
      if (isElement(child) && !SKIPPED_BLOCK.has(child.tagName) && !isNoTranslate(child)) {
        walkContent(child);
      }
    }
    flush(parent, run);
  };

  // Attribute segments are numbered after content segments are collected so
  // ids stay stable regardless of attribute order.
  walkContent(fragment);
  walkAttributes(fragment);
  return { segments, runs, attributes };
}

function expectedCodes(refs: Map<number, Ref>): Map<number, "g" | "x"> {
  return new Map([...refs].map(([id, ref]) => [id, ref.kind === "element" ? "g" : "x"]));
}

function buildNodes(markup: MarkupNode[], refs: Map<number, Ref>): T.ChildNode[] {
  return markup.map((node): T.ChildNode => {
    if (node.kind === "text") {
      return { nodeName: "#text", value: node.value, parentNode: null } as T.TextNode;
    }
    const ref = refs.get(node.id)!;
    if (ref.kind === "literal") {
      return { nodeName: "#text", value: ref.value, parentNode: null } as T.TextNode;
    }
    if (ref.kind === "opaque") {
      adapter.detachNode(ref.node);
      return ref.node;
    }
    // Shallow copy of the source element: same tag, same attributes.
    const element = adapter.createElement(
      ref.node.tagName,
      ref.node.namespaceURI,
      ref.node.attrs.map((a) => ({ ...a })),
    );
    for (const child of buildNodes(node.kind === "g" ? node.children : [], refs)) {
      adapter.appendChild(element, child);
    }
    return element;
  });
}

function decodeToString(markup: string, refs: Map<number, Ref>, segmentId: string): string {
  const parsed = parseMarkup(markup);
  assertSameCodes(parsed, expectedCodes(refs));
  return parsed
    .map((node) => {
      if (node.kind === "text") return node.value;
      const ref = refs.get(node.id)!;
      if (ref.kind !== "literal") {
        throw new SegmentStructureError("CODE_KIND_MISMATCH", `segment ${segmentId}`);
      }
      return ref.value;
    })
    .join("");
}

function replaceRun(run: RunPlan, replacement: T.ChildNode[]) {
  const siblings = run.parent.childNodes;
  const start = siblings.indexOf(run.nodes[0]!);
  siblings.splice(start, run.nodes.length);
  for (const node of run.nodes) node.parentNode = null;
  const withSpacing: T.ChildNode[] = [
    ...(run.leading ? [{ nodeName: "#text", value: run.leading, parentNode: null } as T.TextNode] : []),
    ...replacement,
    ...(run.trailing ? [{ nodeName: "#text", value: run.trailing, parentNode: null } as T.TextNode] : []),
  ];
  for (const node of withSpacing) node.parentNode = run.parent;
  siblings.splice(start, 0, ...withSpacing);
}

function withContext(segmentId: string, fn: () => void) {
  try {
    fn();
  } catch (error) {
    if (error instanceof SegmentStructureError) {
      throw new SegmentStructureError(error.code, `segment ${segmentId}: ${error.message}`);
    }
    throw error;
  }
}

/** Splits an HTML fragment (for example product body_html) into segments. */
export function segmentHtml(html: string, protect: ProtectOptions = {}): SegmentedDocument {
  const { segments } = analyze(parseFragment(html), protect);
  return {
    segments,
    render(translations) {
      // Re-parse so every render starts from the untouched source tree.
      const fragment = parseFragment(html);
      const plan = analyze(fragment, protect);

      // Attributes first: opaque nodes (for example <img>) are moved as-is
      // into rebuilt runs and must already carry their translated alt text.
      for (const attr of plan.attributes) {
        const target = translations.get(attr.segmentId);
        if (target === undefined) continue;
        withContext(attr.segmentId, () => {
          const value = decodeToString(target, attr.refs, attr.segmentId);
          attr.element.attrs.find((a) => a.name === attr.attribute)!.value = value;
        });
      }
      for (const run of plan.runs) {
        const target = translations.get(run.segmentId);
        if (target === undefined) continue;
        withContext(run.segmentId, () => {
          const parsed = parseMarkup(target);
          assertSameCodes(parsed, expectedCodes(run.refs));
          replaceRun(run, buildNodes(parsed, run.refs));
        });
      }
      return serialize(fragment);
    },
  };
}

/** Plain-text fields (titles, SEO fields): one segment, protection applied. */
export function segmentPlainText(text: string, protect: ProtectOptions = {}): SegmentedDocument {
  const encoder = new Encoder(protect);
  const encoded = encoder.text(text);
  const leading = /^\s*/.exec(encoded)![0];
  const trailing = encoded.length > leading.length ? /\s*$/.exec(encoded)![0] : "";
  const source = encoded.slice(leading.length, encoded.length - trailing.length);
  const segments: Segment[] = hasTranslatableText(source)
    ? [{ id: "c0", kind: "content", source, text: markupToPlainText(source) }]
    : [];
  return {
    segments,
    render(translations) {
      const target = segments.length ? translations.get("c0") : undefined;
      if (target === undefined) return text;
      let value = "";
      withContext("c0", () => {
        value = decodeToString(target, encoder.refs, "c0");
      });
      return leading + value + trailing;
    },
  };
}
