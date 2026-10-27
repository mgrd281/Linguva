/**
 * Segment markup sent to translation providers (XLIFF-style inline codes):
 *
 *   Buy <g id="1">two</g> and save <x id="2"/>
 *
 * - `<g id="N">…</g>` stands for a paired inline element (b, a, span …).
 * - `<x id="N"/>` stands for content that must come back unchanged: void
 *   elements, opaque elements and protected spans (Liquid, URLs …).
 * - All other `<`, `>` and `&` are XML-escaped.
 *
 * Providers only ever return text plus these codes. Element names and
 * attributes are restored from the source document, so a provider can't
 * introduce markup.
 */

export type MarkupNode =
  | { kind: "text"; value: string }
  | { kind: "g"; id: number; children: MarkupNode[] }
  | { kind: "x"; id: number };

export type StructureErrorCode =
  | "UNBALANCED_TAGS"
  | "UNKNOWN_CODE"
  | "MISSING_CODE"
  | "DUPLICATE_CODE"
  | "CODE_KIND_MISMATCH";

export class SegmentStructureError extends Error {
  constructor(
    readonly code: StructureErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "SegmentStructureError";
  }
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

const TOKEN =
  /<g\s+id\s*=\s*["'](\d+)["']\s*>|<\/g\s*>|<x\s+id\s*=\s*["'](\d+)["']\s*\/>/g;

/** Parses provider output into a tree. Unknown tags stay literal text. */
export function parseMarkup(input: string): MarkupNode[] {
  const root: MarkupNode[] = [];
  const stack: Array<{ id: number; children: MarkupNode[] }> = [];
  const current = () => (stack.length ? stack[stack.length - 1]!.children : root);
  let last = 0;

  const pushText = (raw: string) => {
    if (!raw) return;
    current().push({ kind: "text", value: unescapeXml(raw) });
  };

  for (const match of input.matchAll(TOKEN)) {
    pushText(input.slice(last, match.index));
    last = match.index! + match[0].length;
    if (match[1] !== undefined) {
      const group = { id: Number(match[1]), children: [] as MarkupNode[] };
      current().push({ kind: "g", ...group });
      stack.push(group);
    } else if (match[2] !== undefined) {
      current().push({ kind: "x", id: Number(match[2]) });
    } else {
      if (!stack.length) {
        throw new SegmentStructureError("UNBALANCED_TAGS", "unexpected </g>");
      }
      stack.pop();
    }
  }
  pushText(input.slice(last));
  if (stack.length) {
    throw new SegmentStructureError("UNBALANCED_TAGS", "unclosed <g>");
  }
  return root;
}

/**
 * Checks that every inline code of the source appears exactly once and with
 * the same kind. Providers may reorder codes (word order differs between
 * languages) but may not add, drop or duplicate them.
 */
export function assertSameCodes(
  nodes: MarkupNode[],
  expected: ReadonlyMap<number, "g" | "x">,
): void {
  const seen = new Set<number>();
  const visit = (list: MarkupNode[]) => {
    for (const node of list) {
      if (node.kind === "text") continue;
      const kind = expected.get(node.id);
      if (!kind) {
        throw new SegmentStructureError("UNKNOWN_CODE", `id ${node.id}`);
      }
      if (kind !== node.kind) {
        throw new SegmentStructureError("CODE_KIND_MISMATCH", `id ${node.id}`);
      }
      if (seen.has(node.id)) {
        throw new SegmentStructureError("DUPLICATE_CODE", `id ${node.id}`);
      }
      seen.add(node.id);
      if (node.kind === "g") visit(node.children);
    }
  };
  visit(nodes);
  for (const id of expected.keys()) {
    if (!seen.has(id)) {
      throw new SegmentStructureError("MISSING_CODE", `id ${id}`);
    }
  }
}

/** Plain text of a segment, without inline codes (for previews and metrics). */
export function markupToPlainText(input: string): string {
  const flatten = (nodes: MarkupNode[]): string =>
    nodes
      .map((n) => (n.kind === "text" ? n.value : n.kind === "g" ? flatten(n.children) : ""))
      .join("");
  return flatten(parseMarkup(input));
}
