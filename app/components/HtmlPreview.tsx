/**
 * Rendered preview of store HTML (descriptions, pages, drafts). The HTML is
 * shown in a sandboxed frame: no scripts, no forms, no navigation, no access
 * to the app, plus a policy that only loads HTTPS images. Server-provided
 * HTML is also sanitised before it gets here (.server/lib/sanitize-html).
 */
import { useI18n } from "../i18n/react";

const FRAME_POLICY = "default-src 'none'; img-src https:; style-src 'unsafe-inline'";
// Close to the admin's text styles; nothing the content can rely on.
const FRAME_CSS = `
  html { color-scheme: light; }
  body { margin: 0; padding: 12px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #303030; overflow-wrap: anywhere; }
  img, video { max-width: 100%; height: auto; }
  table { border-collapse: collapse; } td, th { border: 1px solid #e3e3e3; padding: 4px 8px; }
  a { color: #005bd3; pointer-events: none; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 0.8em 0 0.4em; } p { margin: 0 0 0.75em; }
`;

const escapeAttr = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, "");

export function previewDocument(html: string, lang: string, dir: "ltr" | "rtl" | "auto" = "auto") {
  return (
    `<!doctype html><html lang="${escapeAttr(lang)}" dir="${dir}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">` +
    `<style>${FRAME_CSS}</style></head><body>${html}</body></html>`
  );
}

export function HtmlPreview({
  html,
  title,
  lang,
  dir = "auto",
}: {
  html: string;
  /** Accessible name, e.g. "Preview of the German description". */
  title: string;
  lang: string;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const { t } = useI18n();
  if (!html.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(html)) {
    return (
      <s-box padding="base" border="base" borderRadius="base">
        <s-text color="subdued">{t("editor.preview.empty")}</s-text>
      </s-box>
    );
  }
  // Height from the amount of text: short texts stay compact, long ones scroll.
  const height = Math.min(420, Math.max(120, 60 + Math.ceil(html.replace(/<[^>]*>/g, "").length / 90) * 22));
  return (
    <s-box border="base" borderRadius="base" overflow="hidden">
      <iframe
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={previewDocument(html, lang, dir)}
        style={{ display: "block", width: "100%", height, border: 0, background: "#fff" }}
      />
    </s-box>
  );
}
