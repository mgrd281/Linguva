/**
 * The app's privacy policy (/privacy) and support page (/support): off by
 * default, never a draft in production, the same sections in English and
 * German, and links to them only when they are served.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getConfig } from "../../app/.server/lib/config";
import { PUBLIC_ONLY, pageHtml, sitePage } from "../../app/.server/site/pages";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  NODE_ENV: "production",
  REDIS_URL: "redis://localhost:6379",
};
const production = { ...base, LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes" };
const config = (env: Record<string, string>) => getConfig(env as NodeJS.ProcessEnv);
const request = (path: string) => new Request(`https://linguva.example${path}`);
const site = (file: string) => readFileSync(`site/${file}`, "utf8");

describe("PUBLIC_PAGES and LEGAL_TEXTS_REVIEWED", () => {
  it("are off by default", () => {
    expect(config(base).PUBLIC_PAGES).toBe("off");
    expect(config(base).LEGAL_TEXTS_REVIEWED).toBeUndefined();
  });

  it("never serve a draft in production", () => {
    expect(() => config({ ...production, PUBLIC_PAGES: "on" })).toThrow(/PUBLIC_PAGES: PUBLIC_PAGES=on in production needs LEGAL_TEXTS_REVIEWED=yes/);
    expect(config({ ...production, PUBLIC_PAGES: "on", LEGAL_TEXTS_REVIEWED: "yes" }).PUBLIC_PAGES).toBe("on");
    // Staging and local builds may show the drafts.
    expect(config({ ...base, PUBLIC_PAGES: "on" }).PUBLIC_PAGES).toBe("on");
    expect(() => config({ ...base, PUBLIC_PAGES: "yes" })).toThrow(/PUBLIC_PAGES/);
  });
});

describe("serving the pages", () => {
  it("answers 404 for the app's privacy policy and the support page while PUBLIC_PAGES=off", () => {
    for (const page of PUBLIC_ONLY) {
      let thrown: unknown;
      try {
        sitePage(request("/x"), page, { PUBLIC_PAGES: "off", LEGAL_TEXTS_REVIEWED: undefined });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, page).toBeInstanceOf(Response);
      expect((thrown as Response).status, page).toBe(404);
    }
  });

  it("links to them only while they are served", async () => {
    const off = await sitePage(request("/"), "home", { PUBLIC_PAGES: "off", LEGAL_TEXTS_REVIEWED: undefined }).text();
    expect(off).not.toContain('href="/privacy');
    expect(off).not.toContain('href="/support');
    const on = await sitePage(request("/"), "home", { PUBLIC_PAGES: "on", LEGAL_TEXTS_REVIEWED: undefined }).text();
    expect(on).toContain('href="/privacy"');
    expect(on).toContain('href="/support#faq"');
    // The imprint and the website's privacy page stay as they are.
    expect(on).toContain('href="/impressum"');
    expect(on).toContain('href="/datenschutz"');
  });

  it("serves the drafts with their notice and open points, and sets no cookie", async () => {
    for (const page of PUBLIC_ONLY) {
      const response = sitePage(request("/x"), page, { PUBLIC_PAGES: "on", LEGAL_TEXTS_REVIEWED: undefined });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await response.text();
      expect(html).toContain('class="draft"');
      expect(html).toContain('<mark class="open">');
      expect(html).not.toMatch(/<!--\/?(draft|public)-->/);
    }
  });
});

describe("pageHtml", () => {
  const html = '<p><!--public--><a href="/privacy">x</a><!--/public--></p><!--draft--><p class="draft">Draft</p><!--/draft-->';

  it("keeps the draft notice until the texts are reviewed and no open point is left", () => {
    expect(pageHtml(html, { publicPages: true, reviewed: false })).toContain("Draft");
    expect(pageHtml(html, { publicPages: true, reviewed: true })).not.toContain("Draft");
    expect(pageHtml(`${html}<mark class="open">[x]</mark>`, { publicPages: true, reviewed: true })).toContain("Draft");
  });

  it("drops links to the gated pages while they are off", () => {
    expect(pageHtml(html, { publicPages: false, reviewed: false })).not.toContain("/privacy");
    expect(pageHtml(html, { publicPages: true, reviewed: false })).toContain('<a href="/privacy">x</a>');
  });
});

describe("the texts", () => {
  const ids = (html: string, lang: "en" | "de") => [...html.matchAll(new RegExp(`id="${lang}-([a-z-]+)"`, "g"))].map(([, id]) => id);

  it("have the same sections in English and German", () => {
    const privacy = site("privacy.html");
    expect(ids(privacy, "en").length).toBeGreaterThanOrEqual(7);
    expect(ids(privacy, "de")).toEqual(ids(privacy, "en"));
    const support = site("support.html");
    const count = (lang: "en" | "de") => support.split(`id="${lang}"`)[1]!.split("</section>")[0]!.match(/<details>/g)?.length;
    expect(count("en")).toBeGreaterThanOrEqual(8);
    expect(count("de")).toBe(count("en"));
  });

  it("name the facts the code relies on", () => {
    const privacy = site("privacy.html");
    // Retention as implemented: shop/redact 48 h after uninstall, webhook log 14 days, smart runs 90 days.
    for (const fact of ["48 hours", "14 days", "90 days", "DeepL SE", "Railway Corporation", "no customer or order data"]) expect(privacy).toContain(fact);
    // The FAQ names no prices, so it can't drift from PLAN_PRICES.
    expect(site("support.html")).not.toMatch(/\$\s?\d/);
  });

  it("are linked from every website page's footer, gated", () => {
    for (const file of ["index.html", "preise.html", "impressum.html", "datenschutz.html", "privacy.html", "support.html"]) {
      const html = site(file);
      expect(html, file).toContain('<!--public--><li><a href="privacy.html">Datenschutz der App</a></li><!--/public-->');
      expect(html, file).toContain('<!--public--><li><a href="support.html#faq">Hilfe und FAQ</a></li><!--/public-->');
    }
  });
});
