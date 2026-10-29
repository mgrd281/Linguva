/**
 * Allowlist HTML sanitiser for previews of store content (product
 * descriptions, pages, drafts). Only formatting elements and a few safe
 * attributes survive; scripts, styles, event handlers, forms, frames and
 * unknown elements are removed. Previews are additionally rendered in a
 * sandboxed iframe without scripts (components/HtmlPreview.tsx), so this is
 * one of two independent layers.
 *
 * Never used to change what is published: only for showing content.
 */
import { defaultTreeAdapter as adapter, parseFragment, serialize, type DefaultTreeAdapterTypes as T } from "parse5";

const ALLOWED = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "dd", "del", "dfn", "div", "dl",
  "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
  "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);
// Removed with everything inside (their text isn't content).
const DROPPED = new Set([
  "script", "style", "template", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "svg",
  "math", "form", "input", "button", "select", "textarea", "option", "link", "meta", "base", "title", "head",
  "audio", "video", "source", "track", "canvas", "dialog", "portal",
]);
const ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  "*": new Set(["title", "lang", "dir"]),
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start", "reversed", "type"]),
  time: new Set(["datetime"]),
};
const MAX_INPUT = 200_000;

/** http(s), mailto and tel links, and relative store links; nothing else. */
function safeHref(value: string): string | null {
  // Browsers ignore whitespace and control characters inside the scheme.
  // eslint-disable-next-line no-control-regex -- matching them is the point
  const compact = value.replace(/[\u0000- \u007f-\u009f]+/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme === undefined) return compact.startsWith("//") ? null : value.trim();
  return ["http", "https", "mailto", "tel"].includes(scheme) ? value.trim() : null;
}

/** Images only over HTTPS (no data:, no http mixed content, no tracking via other schemes). */
function safeSrc(value: string): string | null {
  const v = value.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : null;
}

function cleanAttributes(element: T.Element): T.Element["attrs"] {
  const allowed = ATTRIBUTES[element.tagName];
  const result: T.Element["attrs"] = [];
  for (const attr of element.attrs) {
    if (attr.namespace) continue;
    const name = attr.name.toLowerCase();
    if (!ATTRIBUTES["*"]!.has(name) && !allowed?.has(name)) continue;
    let value: string | null = attr.value;
    if (name === "href") value = safeHref(value);
    else if (name === "src") value = safeSrc(value);
    else if (name === "dir") value = ["ltr", "rtl", "auto"].includes(value.toLowerCase()) ? value.toLowerCase() : null;
    else if (["width", "height", "colspan", "rowspan", "start"].includes(name)) value = /^\d{1,4}$/.test(value) ? value : null;
    if (value === null) continue;
    result.push({ name, value });
  }
  if (element.tagName === "a" && result.some((a) => a.name === "href")) {
    // Preview links never act on the app's window.
    result.push({ name: "rel", value: "noopener noreferrer nofollow" }, { name: "target", value: "_blank" });
  }
  if (element.tagName === "img" && !result.some((a) => a.name === "src")) return [];
  return result;
}

function cleanChildren(parent: T.ParentNode): void {
  for (const node of [...adapter.getChildNodes(parent)]) {
    if (adapter.isCommentNode(node) || adapter.isDocumentTypeNode(node)) {
      adapter.detachNode(node);
      continue;
    }
    if (!adapter.isElementNode(node)) continue;
    const element = node as T.Element;
    // Only HTML elements; anything from another namespace goes with its content.
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || DROPPED.has(element.tagName)) {
      adapter.detachNode(element);
      continue;
    }
    cleanChildren(element);
    if (!ALLOWED.has(element.tagName)) {
      // Unknown element: keep its (already cleaned) content, drop the tag.
      for (const child of [...adapter.getChildNodes(element)]) {
        adapter.detachNode(child);
        adapter.insertBefore(parent, child, element);
      }
      adapter.detachNode(element);
      continue;
    }
    if (element.tagName === "img" && !cleanAttributes(element).length) {
      adapter.detachNode(element);
      continue;
    }
    element.attrs = cleanAttributes(element);
  }
}

export function sanitizeHtml(html: string): string {
  const fragment = parseFragment(html.slice(0, MAX_INPUT));
  cleanChildren(fragment);
  return serialize(fragment);
}
