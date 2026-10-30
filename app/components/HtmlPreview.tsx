/**
 * Rendered preview of store HTML (descriptions, pages, drafts). The HTML is
 * shown in a sandboxed frame: no scripts, no forms, no navigation, no access
 * to the app, plus a policy that only loads HTTPS images. Server-provided
 * HTML is also sanitised before it gets here (.server/lib/sanitize-html).
 */
import type { ReactNode } from "react";
import { useI18n } from "../i18n/react";
import { MARK_COLOUR } from "./Coverage";

const FRAME_POLICY = "default-src 'none'; img-src https:; style-src 'unsafe-inline'";
// Close to the admin's text styles; nothing the content can rely on.
const FRAME_CSS = `
  html { color-scheme: light; }
  body { margin: 0; padding: 12px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #303030; overflow-wrap: anywhere; }
  img, video { max-width: 100%; height: auto; }
  table { border-collapse: collapse; } td, th { border: 1px solid #e3e3e3; padding: 4px 8px; }
  a { color: #005bd3; pointer-events: none; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 0.8em 0 0.4em; } p { margin: 0 0 0.75em; }
  mark { background: ${MARK_COLOUR}; color: inherit; border-radius: 3px; }
`;
// An original beside its translation: grey like the plain originals, on the box's own background.
const SUBDUED_CSS = `html, body { background: transparent; } body { color: #616161; }`;
// A Polaris text box (Review: the HTML lines up with the plain texts above and below it, at their size).
// app/lib/text-box-height.ts counts lines with these sizes.
const TEXT_BOX_CSS =
  `body { padding: 12px 16px; font-size: 13px; line-height: 20px; } body > :first-child { margin-top: 0; } ` +
  `body > :last-child { margin-bottom: 0; } ul, ol { padding-inline-start: 1.5em; }`;

const escapeAttr = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, "");

export function previewDocument(html: string, lang: string, dir: "ltr" | "rtl" | "auto" = "auto", tone?: "subdued", textBox = false) {
  return (
    `<!doctype html><html lang="${escapeAttr(lang)}" dir="${dir}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">` +
    `<style>${FRAME_CSS}${tone === "subdued" ? SUBDUED_CSS : ""}${textBox ? TEXT_BOX_CSS : ""}</style></head><body>${html}</body></html>`
  );
}

/**
 * Frame height from the amount of text and the number of paragraphs, list
 * items and headings (the sandboxed frame can't report its own height):
 * short texts stay compact, long ones scroll.
 */
export function previewHeight(html: string): number {
  const text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().length;
  const blocks = (html.match(/<(p|li|h[1-6]|tr|br|blockquote|div)\b/gi) ?? []).length;
  const lines = Math.ceil(text / 55) + blocks;
  return Math.min(420, Math.max(96, 32 + lines * 21 + blocks * 6));
}

export function HtmlPreview({
  html,
  title,
  lang,
  dir = "auto",
  tone,
  blockSize,
  textBox = false,
  label,
}: {
  html: string;
  /** Accessible name, e.g. "Preview of the German description". */
  title: string;
  lang: string;
  dir?: "ltr" | "rtl" | "auto";
  /** "subdued": an original, grey and without a border (Review). */
  tone?: "subdued";
  /** The frame's height for each width of its container (a Polaris responsive value), e.g. one for an original and its translation side by side (app/lib/text-box-height.ts). */
  blockSize?: `@container${string}`;
  /** The text sits as in a Polaris text box: its size, 16 px in, no space above the first block or below the last (Review). */
  textBox?: boolean;
  /** Shown inside the box above the preview (Review on a phone: the box's language). */
  label?: ReactNode;
}) {
  const { t } = useI18n();
  if (!html.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(html)) {
    return (
      <s-box padding="base" border="base" borderRadius="base">
        {label}
        <s-text color="subdued">{t("editor.preview.empty")}</s-text>
      </s-box>
    );
  }
  const iframe = (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={previewDocument(html, lang, dir, tone, textBox)}
      style={{ display: "block", width: "100%", height: blockSize ? "100%" : previewHeight(html), border: 0, background: tone === "subdued" ? "transparent" : "#fff" }}
    />
  );
  // A responsive height: the frame fills a one-row grid whose row Polaris sizes by the container (a box's block size isn't responsive).
  const frame = blockSize ? <s-grid gridTemplateRows={blockSize}>{iframe}</s-grid> : iframe;
  return tone === "subdued" ? (
    <s-box background="subdued" borderRadius="base" overflow="hidden">
      {label}
      {frame}
    </s-box>
  ) : (
    <s-box border="base" borderRadius="base" overflow="hidden">
      {label}
      {frame}
    </s-box>
  );
}
