/**
 * Security headers for every page and data response, on top of what the
 * Shopify library sets (Content-Security-Policy frame-ancestors for the
 * store's admin).
 *
 * Scripts: only the app's own files, Shopify's CDN (App Bridge, Polaris)
 * and inline scripts carrying the page's nonce (React Router's hydration
 * data). An injected inline script or event handler doesn't run. Not set
 * on the Vite dev server, whose refresh script is inline without a nonce.
 *
 * Deliberately not set, because they would break the embedded app:
 * X-Frame-Options (the admin embeds the app; frame-ancestors decides) and
 * Cross-Origin-Opener-Policy (App Bridge opens admin windows).
 *
 * The admin console (/admin, never embedded) gets a policy of its own
 * instead (adminHeaders), replacing whatever came before, so a `?shop=`
 * the Shopify library reacts to can't loosen it.
 */

// The Shopify admin may embed the app when a request doesn't name a shop; the
// library sets the exact store otherwise. No wildcard: Shopify's security check
// rates a static "https://*.myshopify.com" (STATIC_FRAME_ANCESTORS) as High.
const FALLBACK_FRAME_ANCESTORS = "frame-ancestors https://admin.shopify.com;";
const EXTRA_CSP = "base-uri 'self'; object-src 'none';";
const SCRIPT_HOSTS = "https://cdn.shopify.com";

/**
 * An admin console path as React Router matches it (case-insensitive, after
 * decoding each segment), including its data requests (/admin.data,
 * /admin/x.data).
 */
export function isAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    // Not decodable: React Router doesn't match it either; check it as it is.
  }
  return /^\/+admin(?:\/|\.data$|$)/i.test(path);
}

/**
 * The console's pages: nothing from elsewhere but Shopify's font CDN (root's
 * Inter stylesheet), no framing, no inline script without the nonce, forms
 * only to itself, never cached or indexed. Without a nonce in development,
 * what Vite's dev server needs (its inline scripts and styles, the refresh
 * socket).
 */
function adminPolicy(scriptNonce: string | undefined, production: boolean): string {
  const development = !production && !scriptNonce;
  return [
    "default-src 'none'",
    `script-src 'self'${scriptNonce ? ` 'nonce-${scriptNonce}'` : development ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ""} https://cdn.shopify.com`,
    "font-src https://cdn.shopify.com",
    "img-src 'self' data:",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * The console's headers. Applied by addSecurityHeaders to its pages and data
 * requests; every Response the console builds itself (redirects, refusals,
 * resource routes) gets them from adminResponse or adminRedirect.
 */
export function adminHeaders(headers: Headers, scriptNonce?: string, production = process.env.NODE_ENV === "production"): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", adminPolicy(scriptNonce, production));
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  // The library's preload of App Bridge and Polaris (on ?shop=): the console loads neither.
  headers.delete("Link");
}

export function addSecurityHeaders(
  request: Request,
  headers: Headers,
  {
    document,
    production = process.env.NODE_ENV === "production",
    scriptNonce,
  }: { document: boolean; production?: boolean; scriptNonce?: string },
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isAdminPath(new URL(request.url).pathname)) {
    adminHeaders(headers, scriptNonce, production);
  } else if (document) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    const csp = headers.get("Content-Security-Policy")?.trim() || FALLBACK_FRAME_ANCESTORS;
    const scripts = scriptNonce ? ` script-src 'self' 'nonce-${scriptNonce}' ${SCRIPT_HOSTS};` : "";
    headers.set("Content-Security-Policy", `${csp.endsWith(";") ? csp : `${csp};`} ${EXTRA_CSP}${scripts}`);
  }
  strictTransportSecurity(request, headers, production);
}

/** HSTS only where the app is really served over HTTPS (behind a proxy in production), never on local http. */
function strictTransportSecurity(request: Request, headers: Headers, production: boolean): void {
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  if (production && https) headers.set("Strict-Transport-Security", "max-age=31536000");
}

/**
 * A Response the console builds itself (a refusal, a resource route's
 * answer), with the console's headers and HSTS. React Router hands some
 * loader and action Responses out as they are, past entry.server: a
 * redirect, even on a page request, and whatever a resource route answers
 * or throws. So these carry the headers themselves.
 */
export function adminResponse(
  request: Request,
  body: BodyInit | null,
  { status, headers: init }: { status: number; headers?: HeadersInit },
  production = process.env.NODE_ENV === "production",
): Response {
  const headers = new Headers(init);
  adminHeaders(headers, undefined, production);
  strictTransportSecurity(request, headers, production);
  return new Response(body, { status, headers });
}

/**
 * A redirect from the console (to the sign-in page, after signing in or
 * out, a language switch), with the console's headers: 302 unless told
 * otherwise. `location` must be a valid header value (ASCII; safeNext's
 * answers are).
 */
export function adminRedirect(
  request: Request,
  location: string,
  { status = 302, headers: init }: { status?: 301 | 302 | 303 | 307 | 308; headers?: HeadersInit } = {},
  production = process.env.NODE_ENV === "production",
): Response {
  const headers = new Headers(init);
  headers.set("Location", location);
  return adminResponse(request, null, { status, headers }, production);
}
