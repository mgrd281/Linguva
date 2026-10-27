import { describe, expect, it } from "vitest";
import { addSecurityHeaders } from "../../app/.server/lib/security-headers";

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
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com; base-uri 'self'; object-src 'none';",
    );
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
