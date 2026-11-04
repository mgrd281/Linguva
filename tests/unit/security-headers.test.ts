import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addSecurityHeaders, adminHeaders, isAdminPath } from "../../app/.server/lib/security-headers";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("security headers", () => {
  it("keeps Shopify's frame-ancestors for the store and adds base-uri and object-src", () => {
    const headers = new Headers({ "Content-Security-Policy": "frame-ancestors https://a.myshopify.com https://admin.shopify.com;" });
    addSecurityHeaders(req("https://app.example/app?shop=a.myshopify.com"), headers, { document: true, production: true });
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://a.myshopify.com https://admin.shopify.com; base-uri 'self'; object-src 'none';",
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    // Never X-Frame-Options: the admin embeds the app.
    expect(headers.get("X-Frame-Options")).toBeNull();
  });

  it("protects pages without a shop parameter from being framed elsewhere", () => {
    const headers = new Headers();
    addSecurityHeaders(req("https://app.example/auth/login"), headers, { document: true, production: true });
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://admin.shopify.com; base-uri 'self'; object-src 'none';",
    );
  });

  it("allows scripts only from the app, Shopify's CDN and inline scripts with the page's nonce", () => {
    const headers = new Headers();
    addSecurityHeaders(req("https://app.example/app?shop=a.myshopify.com"), headers, { document: true, production: true, scriptNonce: "bm9uY2U=" });
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://admin.shopify.com; base-uri 'self'; object-src 'none'; script-src 'self' 'nonce-bm9uY2U=' https://cdn.shopify.com;",
    );
    // No nonce (the Vite dev server): no script policy.
    const dev = new Headers();
    addSecurityHeaders(req("https://app.example/app"), dev, { document: true, production: false });
    expect(dev.get("Content-Security-Policy")).not.toContain("script-src");
  });

  it("sets HSTS only in production over HTTPS", () => {
    const behindProxy = new Headers();
    addSecurityHeaders(req("http://internal:3000/app", { "x-forwarded-proto": "https" }), behindProxy, { document: true, production: true });
    expect(behindProxy.get("Strict-Transport-Security")).toBe("max-age=31536000");

    const localHttp = new Headers();
    addSecurityHeaders(req("http://localhost:3000/app"), localHttp, { document: true, production: true });
    expect(localHttp.get("Strict-Transport-Security")).toBeNull();

    const dev = new Headers();
    addSecurityHeaders(req("https://tunnel.example/app"), dev, { document: true, production: false });
    expect(dev.get("Strict-Transport-Security")).toBeNull();
  });

  it("gives data responses the basic headers without a page policy", () => {
    const headers = new Headers();
    addSecurityHeaders(req("https://app.example/app/products.data"), headers, { document: false, production: true });
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });
});

describe("the admin console's headers", () => {
  const STRICT =
    "default-src 'none'; script-src 'self' 'nonce-bm9uY2U='; style-src 'self' https://cdn.shopify.com; font-src https://cdn.shopify.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

  it("give its pages a strict policy of their own: no framing, no foreign scripts, never cached or indexed", () => {
    const headers = new Headers();
    addSecurityHeaders(req("https://admin.linguva.app/admin/customers"), headers, { document: true, production: true, scriptNonce: "bm9uY2U=" });
    expect(headers.get("Content-Security-Policy")).toBe(STRICT);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(headers.get("Referrer-Policy")).toBe("same-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("replace what the Shopify library set for a ?shop= parameter, and drop its App Bridge preload", () => {
    const headers = new Headers({
      "Content-Security-Policy": "frame-ancestors https://evil.myshopify.com https://admin.shopify.com;",
      Link: '<https://cdn.shopify.com/shopifycloud/app-bridge.js>; rel="preload"; as="script"',
      "Cache-Control": "public, max-age=3600",
    });
    addSecurityHeaders(req("https://admin.linguva.app/admin?shop=evil.myshopify.com"), headers, { document: true, production: true, scriptNonce: "bm9uY2U=" });
    expect(headers.get("Content-Security-Policy")).toBe(STRICT);
    expect(headers.get("Link")).toBeNull();
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("cover its data requests (client navigation), without a nonce", () => {
    for (const path of ["/admin.data", "/admin/prices.data", "/admin/customers/1.data?_routes=routes%2Fadmin"]) {
      const headers = new Headers();
      addSecurityHeaders(req(`https://admin.linguva.app${path}`), headers, { document: false, production: true });
      expect(headers.get("Content-Security-Policy"), path).toBe(STRICT.replace(" 'nonce-bm9uY2U='", ""));
      expect(headers.get("Cache-Control"), path).toBe("no-store");
      expect(headers.get("X-Frame-Options"), path).toBe("DENY");
    }
  });

  it("allow what Vite's dev server needs in development (no nonce there), and nothing from other sites", () => {
    const headers = new Headers();
    addSecurityHeaders(req("http://localhost:3000/admin"), headers, { document: true, production: false });
    expect(headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.shopify.com; font-src https://cdn.shopify.com; img-src 'self' data:; connect-src 'self' ws: wss:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    );
    expect(headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("match the console's paths as the router does (any case, encoded), and nothing else", () => {
    for (const path of ["/admin", "/admin/", "/admin/login", "/ADMIN/prices", "/%61dmin/customers", "//admin", "/admin.data"]) expect(isAdminPath(path), path).toBe(true);
    for (const path of ["/", "/app", "/app/admin", "/administrator", "/admin-x", "/admin.css", "/preise", "/auth/login"]) expect(isAdminPath(path), path).toBe(false);
  });

  it("leave every other page exactly as before", () => {
    for (const path of ["/app", "/administrator", "/app/admin"]) {
      const headers = new Headers();
      addSecurityHeaders(req(`https://app.example${path}`), headers, { document: true, production: true, scriptNonce: "bm9uY2U=" });
      expect(headers.get("Content-Security-Policy"), path).toBe(
        "frame-ancestors https://admin.shopify.com; base-uri 'self'; object-src 'none'; script-src 'self' 'nonce-bm9uY2U=' https://cdn.shopify.com;",
      );
      expect(headers.get("X-Frame-Options"), path).toBeNull();
      expect(headers.get("Cache-Control"), path).toBeNull();
      expect(headers.get("Referrer-Policy"), path).toBe("strict-origin-when-cross-origin");
    }
  });

  it("can be set by a resource route of its own", () => {
    const headers = new Headers();
    adminHeaders(headers, undefined, true);
    expect(headers.get("Content-Security-Policy")).toBe(STRICT.replace(" 'nonce-bm9uY2U='", ""));
    expect(headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("frame-ancestors in the app's code", () => {
  it("never allows a wildcard host (Shopify's STATIC_FRAME_ANCESTORS check)", () => {
    const files = execSync("git ls-files app", { encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((f) => /["'`]frame-ancestors[^"'`\n]*\*/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
