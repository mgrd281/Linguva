/**
 * Security headers for every page and data response, on top of what the
 * Shopify library sets (Content-Security-Policy frame-ancestors for the
 * store's admin).
 *
 * Deliberately not set, because they would break the embedded app:
 * X-Frame-Options (the admin embeds the app; frame-ancestors decides),
 * Cross-Origin-Opener-Policy (App Bridge opens admin windows), and a
 * script-src policy (App Bridge and Polaris load from Shopify's CDN; to be
 * added only after testing on a development store).
 */

// The Shopify admin and storefront hosts that may embed the app when a
// request doesn't name a shop; the library sets the exact store otherwise.
const FALLBACK_FRAME_ANCESTORS = "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
const EXTRA_CSP = "base-uri 'self'; object-src 'none';";

export function addSecurityHeaders(
  request: Request,
  headers: Headers,
  { document, production = process.env.NODE_ENV === "production" }: { document: boolean; production?: boolean },
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (document) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    const csp = headers.get("Content-Security-Policy")?.trim() || FALLBACK_FRAME_ANCESTORS;
    headers.set("Content-Security-Policy", `${csp.endsWith(";") ? csp : `${csp};`} ${EXTRA_CSP}`);
  }
  // HSTS only where the app is really served over HTTPS (behind a proxy in
  // production), never on local http.
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  if (production && https) headers.set("Strict-Transport-Security", "max-age=31536000");
}
