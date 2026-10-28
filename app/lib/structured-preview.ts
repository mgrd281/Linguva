/**
 * Lists and links (metafields, metaobject fields) in the browser: their
 * readable texts, and a translated value rebuilt from the original's items.
 * The server checks the shape and link addresses again before saving.
 */
export const STRUCTURED_DISPLAY_TYPES = new Set(["LIST_SINGLE_LINE_TEXT_FIELD", "LIST_MULTI_LINE_TEXT_FIELD", "LINK", "LIST_LINK"]);
export const RICH_TEXT_TYPE = "RICH_TEXT_FIELD";

/** Values shown readably (rich text, lists, links), never as raw JSON. */
export const isStructuredValueType = (type: string | null | undefined) =>
  Boolean(type && (type === RICH_TEXT_TYPE || STRUCTURED_DISPLAY_TYPES.has(type)));

/** The items of a list or link value; null if the value isn't one of these shapes. */
export function structuredItems(type: string, json: string | null | undefined): Array<{ text: string; url?: string }> | null {
  if (!json || !STRUCTURED_DISPLAY_TYPES.has(type)) return null;
  try {
    const value: unknown = JSON.parse(json);
    const link = (v: unknown) =>
      v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" && typeof (v as { url?: unknown }).url === "string"
        ? { text: (v as { text: string }).text, url: (v as { url: string }).url }
        : null;
    if (type === "LINK") {
      const l = link(value);
      return l ? [l] : null;
    }
    if (!Array.isArray(value)) return null;
    const items = type === "LIST_LINK" ? value.map(link) : value.map((v) => (typeof v === "string" ? { text: v } : null));
    return items.every(Boolean) ? (items as Array<{ text: string; url?: string }>) : null;
  } catch {
    return null;
  }
}

/**
 * The original's value with its texts replaced, item by item: the same
 * number of items and the same link addresses. "" when every text is empty.
 */
export function withTexts(type: string, sourceJson: string, texts: readonly string[]): string {
  const items = structuredItems(type, sourceJson);
  if (!items || texts.every((t) => !t.trim())) return "";
  const text = (i: number) => texts[i] ?? "";
  if (type === "LINK") return JSON.stringify({ text: text(0), url: items[0]!.url });
  if (type === "LIST_LINK") return JSON.stringify(items.map((item, i) => ({ text: text(i), url: item.url })));
  return JSON.stringify(items.map((_, i) => text(i)));
}
