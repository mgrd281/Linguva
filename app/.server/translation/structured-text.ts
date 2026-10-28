/**
 * Metafield values that are JSON around plain text (LocalizableContentType,
 * Admin API 2026-10):
 *
 * - LIST_SINGLE_LINE_TEXT_FIELD, LIST_MULTI_LINE_TEXT_FIELD: a JSON array of
 *   strings; each string is translated, order and count stay.
 * - LINK: {"text": …, "url": …}; only the text is translated.
 * - LIST_LINK: an array of those.
 *
 * Each text is segmented like a plain-text field (placeholders, glossary,
 * memory). The result is rebuilt from the source, so URLs and the JSON
 * shape can't change. Values that don't have this shape are refused
 * (StructuredTextError) instead of being guessed at.
 */
import { segmentPlainText, type Segment, type SegmentedDocument } from "./html-segmenter";
import type { ProtectOptions } from "./protect";

export const STRUCTURED_TEXT_TYPES = new Set(["LIST_SINGLE_LINE_TEXT_FIELD", "LIST_MULTI_LINE_TEXT_FIELD", "LINK", "LIST_LINK"]);

const MAX_ITEMS = 128;

export class StructuredTextError extends Error {
  constructor(reason: string) {
    super(`Structured text: ${reason}`);
    this.name = "StructuredTextError";
  }
}

interface Link {
  text: string;
  url: string;
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new StructuredTextError("not JSON");
  }
}

function asLink(value: unknown): Link {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StructuredTextError("link is not an object");
  const { text, url, ...rest } = value as Record<string, unknown>;
  if (typeof text !== "string" || typeof url !== "string" || Object.keys(rest).length) throw new StructuredTextError("unexpected link shape");
  return { text, url };
}

function asList<T>(value: unknown, item: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new StructuredTextError("not a list");
  if (value.length > MAX_ITEMS) throw new StructuredTextError("too many items");
  return value.map(item);
}

const asString = (v: unknown) => {
  if (typeof v !== "string") throw new StructuredTextError("list item is not text");
  return v;
};

/** The texts of a value, in order (throws StructuredTextError for an unexpected shape). */
export function structuredTexts(type: string, json: string): string[] {
  const value = parse(json);
  switch (type) {
    case "LIST_SINGLE_LINE_TEXT_FIELD":
    case "LIST_MULTI_LINE_TEXT_FIELD":
      return asList(value, asString);
    case "LINK":
      return [asLink(value).text];
    case "LIST_LINK":
      return asList(value, asLink).map((l) => l.text);
    default:
      throw new StructuredTextError(`unsupported type ${type}`);
  }
}

/** The value with its texts replaced, in the same order; everything else from the source. */
function rebuild(type: string, json: string, texts: readonly string[]): string {
  const value = parse(json);
  switch (type) {
    case "LIST_SINGLE_LINE_TEXT_FIELD":
    case "LIST_MULTI_LINE_TEXT_FIELD":
      return JSON.stringify(asList(value, asString).map((_, i) => texts[i]));
    case "LINK":
      return JSON.stringify({ ...asLink(value), text: texts[0] });
    case "LIST_LINK":
      return JSON.stringify(asList(value, asLink).map((l, i) => ({ ...l, text: texts[i] })));
    default:
      throw new StructuredTextError(`unsupported type ${type}`);
  }
}

/** Segments every text of the value; rendering rebuilds the JSON from the source. */
export function segmentStructuredText(type: string, json: string, protect: ProtectOptions = {}): SegmentedDocument {
  const docs = structuredTexts(type, json).map((text) => segmentPlainText(text, protect));
  const segments: Segment[] = docs.flatMap((doc, i) => doc.segments.map((s) => ({ ...s, id: `t${i}.${s.id}` })));
  return {
    segments,
    render(translations) {
      const texts = docs.map((doc, i) => {
        const prefix = `t${i}.`;
        const own = new Map<string, string>();
        for (const [id, value] of translations) if (id.startsWith(prefix)) own.set(id.slice(prefix.length), value);
        return doc.render(own);
      });
      return rebuild(type, json, texts);
    },
  };
}

/**
 * True when a posted value has the source's shape: the same number of
 * texts and, for links, the same URLs. Used before saving a person's edit.
 */
export function sameStructuredShape(type: string, value: string, sourceJson: string): boolean {
  try {
    const texts = structuredTexts(type, value);
    if (texts.length !== structuredTexts(type, sourceJson).length) return false;
    // Same texts in both shapes: equal only if everything else (URLs, order) matches.
    return rebuild(type, sourceJson, texts) === rebuild(type, value, texts);
  } catch (error) {
    if (error instanceof StructuredTextError) return false;
    throw error;
  }
}

/** True when an item that has text in the source is blank in the value (an unfinished translation). */
export function structuredHasBlankItem(type: string, value: string, sourceJson: string): boolean {
  try {
    const texts = structuredTexts(type, value);
    return structuredTexts(type, sourceJson).some((source, i) => source.trim() && !texts[i]?.trim());
  } catch (error) {
    // A value of another shape is refused by sameStructuredShape.
    if (error instanceof StructuredTextError) return false;
    throw error;
  }
}

/** The texts joined, for readability checks (script, form of address). */
export function structuredReadableText(type: string, json: string): string {
  try {
    return structuredTexts(type, json).join("\n");
  } catch {
    return "";
  }
}
