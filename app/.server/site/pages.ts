import { createHash } from "node:crypto";

import homeHtml from "../../../site/index.html?raw";
import privacyHtml from "../../../site/datenschutz.html?raw";
import imprintHtml from "../../../site/impressum.html?raw";
import pricingHtml from "../../../site/preise.html?raw";

// The marketing website (site/) served by the app on its public address.
const ASSETS = import.meta.glob<string>("../../../site/assets/*", { query: "?url", import: "default", eager: true });
const ASSET_URLS = new Map(Object.entries(ASSETS).map(([path, url]) => [path.split("/").pop()!, url]));

function render(html: string): string {
  return html
    .replace(/(src|href)="assets\/([^"]+)"/g, (match, attr: string, file: string) => {
      const url = ASSET_URLS.get(file);
      if (!url) throw new Error(`site asset missing: ${file}`);
      return `${attr}="${url}"`;
    })
    .replace(/href="index\.html(#[^"]*)?"/g, (_match, hash?: string) => `href="/${hash ?? ""}"`)
    .replace(/href="(preise|impressum|datenschutz)\.html(#[^"]*)?"/g, (_match, page: string, hash?: string) => `href="/${page}${hash ?? ""}"`);
}

function scriptHashes(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
}

const PAGES = { home: render(homeHtml), pricing: render(pricingHtml), imprint: render(imprintHtml), privacy: render(privacyHtml) };
const SCRIPTS = [...new Set(Object.values(PAGES).flatMap(scriptHashes))].join(" ");

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

export function sitePage(request: Request, page: keyof typeof PAGES): Response {
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
  return new Response(request.method === "HEAD" ? null : PAGES[page], { headers });
}
