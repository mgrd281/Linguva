/**
 * Shopify rich text (rich_text_field JSON) → HTML for previews, in the
 * browser and on the server. Text and attributes are escaped; previews are
 * shown in a sandboxed frame (components/HtmlPreview.tsx). Throws for
 * documents that aren't rich text.
 */
type Node = {
  type?: string;
  value?: unknown;
  bold?: boolean;
  italic?: boolean;
  url?: unknown;
  title?: unknown;
  level?: unknown;
  listType?: unknown;
  children?: Node[];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toHtml(node: Node, depth: number): string {
  if (depth > 20) throw new Error("Rich text too deep");
  const children = () => (Array.isArray(node.children) ? node.children.map((c) => toHtml(c, depth + 1)).join("") : "");
  switch (node.type) {
    case "text": {
      let html = esc(String(node.value ?? ""));
      if (node.italic) html = `<em>${html}</em>`;
      if (node.bold) html = `<strong>${html}</strong>`;
      return html;
    }
    case "link":
      return `<a href="${esc(String(node.url ?? ""))}"${typeof node.title === "string" ? ` title="${esc(node.title)}"` : ""}>${children()}</a>`;
    case "paragraph":
      return `<p>${children()}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.level) || 2));
      return `<h${level}>${children()}</h${level}>`;
    }
    case "list":
      return node.listType === "ordered" ? `<ol>${children()}</ol>` : `<ul>${children()}</ul>`;
    case "list-item":
      return `<li>${children()}</li>`;
    default:
      throw new Error(`Unknown rich text node ${String(node.type)}`);
  }
}

export function richTextToPreviewHtml(json: string): string {
  const root = JSON.parse(json) as Node;
  if (root?.type !== "root" || !Array.isArray(root.children)) throw new Error("Not rich text");
  return root.children.map((c) => toHtml(c, 1)).join("");
}

/** The preview, or null when the value isn't (valid) rich text. */
export function richTextPreviewOrNull(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    return richTextToPreviewHtml(json);
  } catch {
    return null;
  }
}
