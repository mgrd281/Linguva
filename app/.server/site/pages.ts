import { createHash } from "node:crypto";

import homeHtml from "../../../site/index.html?raw";
import privacyHtml from "../../../site/datenschutz.html?raw";
import imprintHtml from "../../../site/impressum.html?raw";
import pricingHtml from "../../../site/preise.html?raw";
import appPrivacyHtml from "../../../site/privacy.html?raw";
import supportHtml from "../../../site/support.html?raw";
import { getConfig, type AppConfig } from "../lib/config";

// The marketing website (site/) served by the app on its public address.
const ASSETS = import.meta.glob<string>("../../../site/assets/*", { query: "?url", import: "default", eager: true });
const ASSET_URLS = new Map(Object.entries(ASSETS).map(([path, url]) => [path.split("/").pop()!, url]));

function render(html: string): string {
  return html
    .replace(/(src|href)="assets\/([^"]+)"/g, (match, attr: string, file: string) => {
      const url = ASSET_URLS.get(file);
      // (Unit tests load stylesheets as an empty URL: only a missing file fails.)
      if (url === undefined) throw new Error(`site asset missing: ${file}`);
      return `${attr}="${url}"`;
    })
    .replace(/href="index\.html(#[^"]*)?"/g, (_match, hash?: string) => `href="/${hash ?? ""}"`)
    .replace(/href="(preise|impressum|datenschutz|privacy|support)\.html(#[^"]*)?"/g, (_match, page: string, hash?: string) => `href="/${page}${hash ?? ""}"`);
}

function scriptHashes(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
}

const PAGES = {
  home: render(homeHtml),
  pricing: render(pricingHtml),
  imprint: render(imprintHtml),
  privacy: render(privacyHtml),
  appPrivacy: render(appPrivacyHtml),
  support: render(supportHtml),
};
export type SitePage = keyof typeof PAGES;
const SCRIPTS = [...new Set(Object.values(PAGES).flatMap(scriptHashes))].join(" ");

// The app's own privacy policy and the support page exist only with
// PUBLIC_PAGES=on; until then they answer 404 and no page links to them.
export const PUBLIC_ONLY: ReadonlySet<SitePage> = new Set(["appPrivacy", "support"]);

/**
 * A page as served. `<!--public-->…<!--/public-->` (links to the gated pages)
 * stays only with PUBLIC_PAGES=on. `<!--draft-->…<!--/draft-->` (the draft
 * notice) stays until LEGAL_TEXTS_REVIEWED=yes and no open point
 * (`<mark class="open">`) is left in the page.
 */
export function pageHtml(html: string, { publicPages, reviewed }: { publicPages: boolean; reviewed: boolean }): string {
  const draft = !reviewed || html.includes('<mark class="open">');
  return html
    .replace(/<!--public-->([\s\S]*?)<!--\/public-->/g, (_match, inner: string) => (publicPages ? inner : ""))
    .replace(/<!--draft-->([\s\S]*?)<!--\/draft-->/g, (_match, inner: string) => (draft ? inner : ""));
}

const CSP = [
  "default-src 'none'",
  "img-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  `script-src ${SCRIPTS}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function sitePage(
  request: Request,
  page: SitePage,
  config: Pick<AppConfig, "PUBLIC_PAGES" | "LEGAL_TEXTS_REVIEWED"> = getConfig(),
): Response {
  const publicPages = config.PUBLIC_PAGES === "on";
  if (PUBLIC_ONLY.has(page) && !publicPages) {
    throw new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const html = pageHtml(PAGES[page], { publicPages, reviewed: config.LEGAL_TEXTS_REVIEWED === "yes" });
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // A preview for the owner until the legal pages and a real domain exist.
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "public, max-age=300",
  });
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  if (process.env.NODE_ENV === "production" && https) headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(request.method === "HEAD" ? null : html, { headers });
}
