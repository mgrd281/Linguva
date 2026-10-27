import type { Segment, SegmentedDocument } from "../translation/html-segmenter";
import {
  escapeXml,
  parseMarkup,
  SegmentStructureError,
  type MarkupNode,
} from "../translation/segment-markup";

export interface SegmentPair {
  source: string;
  target: string;
}

function serialize(nodes: MarkupNode[], remap: Map<number, number>): string {
  return nodes
    .map((n) => {
      if (n.kind === "text") return escapeXml(n.value);
      const id = remap.get(n.id)!;
      return n.kind === "x" ? `<x id="${id}"/>` : `<g id="${id}">${serialize(n.children, remap)}</g>`;
    })
    .join("");
}

function collectIds(nodes: MarkupNode[], out: number[] = []): number[] {
  for (const n of nodes) {
    if (n.kind === "text") continue;
    out.push(n.id);
    if (n.kind === "g") collectIds(n.children, out);
  }
  return out;
}

/**
 * Rewrites a target segment's inline codes to the ids of the matching
 * source codes (same tag, attributes or literal). Returns null when the two
 * segments don't carry the same codes, so no wrong pair is stored.
 */
export function alignSegment(source: Segment, target: Segment): SegmentPair | null {
  let nodes: MarkupNode[];
  try {
    nodes = parseMarkup(target.source);
  } catch (error) {
    if (error instanceof SegmentStructureError) return null;
    throw error;
  }
  const available = new Map<string, number[]>();
  for (const [id, signature] of Object.entries(source.codes)) {
    available.set(signature, [...(available.get(signature) ?? []), Number(id)]);
  }
  const remap = new Map<number, number>();
  for (const id of collectIds(nodes)) {
    const candidates = available.get(target.codes[id]!);
    const match = candidates?.shift();
    if (match === undefined) return null;
    remap.set(id, match);
  }
  if ([...available.values()].some((ids) => ids.length > 0)) return null;
  return { source: source.source, target: serialize(nodes, remap) };
}

/**
 * Pairs the segments of a source document with those of a person's
 * translation, position by position. Segments whose structure differs are
 * left out rather than guessed.
 */
export function alignDocuments(source: SegmentedDocument, target: SegmentedDocument): SegmentPair[] {
  if (source.segments.length !== target.segments.length) return [];
  const pairs: SegmentPair[] = [];
  source.segments.forEach((seg, i) => {
    const other = target.segments[i]!;
    if (seg.kind !== other.kind) return;
    const pair = alignSegment(seg, other);
    if (pair) pairs.push(pair);
  });
  return pairs;
}
