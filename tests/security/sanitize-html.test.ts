/**
 * The preview sanitiser against common XSS vectors: nothing executable,
 * no event handlers, no dangerous URLs, no styles, no foreign namespaces.
 */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../../app/.server/lib/sanitize-html";

const VECTORS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `<img src="https://cdn.shopify.com/a.png" onerror="alert(1)">`,
  `<a href="javascript:alert(1)">x</a>`,
  `<a href="JaVaScRiPt:alert(1)">x</a>`,
  `<a href="java\tscript:alert(1)">x</a>`,
  `<a href="&#106;avascript:alert(1)">x</a>`,
  `<a href=" javascript:alert(1)">x</a>`,
  `<a href="vbscript:msgbox(1)">x</a>`,
  `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
  `<a href="//evil.example/x">x</a>`,
  `<svg onload=alert(1)><circle/></svg>`,
  `<svg><script>alert(1)</script></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
  `<iframe src="https://evil.example"></iframe>`,
  `<object data="x.swf"></object><embed src="x.swf">`,
  `<form action="https://evil.example"><input name=a><button>go</button></form>`,
  `<div style="background:url(javascript:alert(1))">x</div>`,
  `<p style="position:fixed;inset:0">overlay</p>`,
  `<style>body{display:none}</style>`,
  `<link rel=stylesheet href="https://evil.example/a.css">`,
  `<meta http-equiv="refresh" content="0;url=https://evil.example">`,
  `<base href="https://evil.example/">`,
  `<details open ontoggle=alert(1)>x</details>`,
  `<video><source onerror=alert(1)></video>`,
  `<p onclick="alert(1)" onmouseover="alert(1)">x</p>`,
  `<!--<img src=x onerror=alert(1)>-->`,
  `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
  `<template><script>alert(1)</script></template>`,
  `<img src="data:image/svg+xml;base64,PHN2Zy8+">`,
  `<img src="http://insecure.example/a.png">`,
  `<a href="https://ok.example" target="_top" rel="opener">x</a>`,
  `<x-custom onclick="alert(1)">text</x-custom>`,
  `<p dir="javascript:alert(1)">x</p>`,
  `<td colspan="1 onmouseover=alert(1)">x</td>`,
];

describe("preview sanitiser", () => {
  for (const vector of VECTORS) {
    it(`neutralises ${vector.slice(0, 60)}`, () => {
      const out = sanitizeHtml(vector);
      expect(out).not.toMatch(/<\s*(script|style|iframe|object|embed|svg|math|form|input|button|link|meta|base|template|noscript|video|source)\b/i);
      expect(out).not.toMatch(/\son[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:|vbscript:|data:/i);
      expect(out).not.toMatch(/\sstyle\s*=/i);
      expect(out).not.toMatch(/href="\/\//i);
      expect(out).not.toMatch(/src="http:/i);
      expect(out).not.toMatch(/target="_top"|rel="opener"/i);
      // Re-sanitising is stable (no mutation-based bypass after serialising).
      expect(sanitizeHtml(out)).toBe(out);
    });
  }

  it("keeps ordinary product description formatting", () => {
    const html =
      `<h2>Details</h2><p>Warm <strong>merino</strong> wool, <em>machine</em> washable.</p>` +
      `<ul><li>Size S–XL</li><li>Made in Portugal</li></ul>` +
      `<p><a href="/pages/care">Care guide</a> · <a href="https://example.com/x">More</a></p>` +
      `<img src="https://cdn.shopify.com/s/files/a.jpg" alt="Jacket" width="300">` +
      `<table><tr><th scope="col">Size</th><td colspan="2">S</td></tr></table>`;
    const out = sanitizeHtml(html);
    expect(out).toContain("<h2>Details</h2>");
    expect(out).toContain("<strong>merino</strong>");
    expect(out).toContain("<li>Made in Portugal</li>");
    expect(out).toContain(`<a href="/pages/care" rel="noopener noreferrer nofollow" target="_blank">Care guide</a>`);
    expect(out).toContain(`<img src="https://cdn.shopify.com/s/files/a.jpg" alt="Jacket" width="300">`);
    expect(out).toContain(`<th scope="col">Size</th><td colspan="2">S</td>`);
  });

  it("keeps the text of unknown elements and Liquid as text", () => {
    expect(sanitizeHtml(`<x-badge>New</x-badge> {{ product.title }}`)).toBe("New {{ product.title }}");
    expect(sanitizeHtml(`<p>5 < 6 & "quoted"</p>`)).toBe("<p>5 &lt; 6 &amp; \"quoted\"</p>");
  });

  it("bounds the work on very large input", () => {
    const out = sanitizeHtml("<p>" + "a".repeat(500_000) + "</p>");
    expect(out.length).toBeLessThan(200_100);
  });
});
