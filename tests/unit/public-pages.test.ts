/**
 * The app's privacy policy (/privacy) and support page (/support): off by
 * default, never a draft in production, the same sections in English and
 * German, and links to them only when they are served.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getConfig } from "../../app/.server/lib/config";
import { applyEngineBlocks, DEEPL_ONLY } from "../../app/.server/site/engine-blocks";
import { engineBlocksWithOpenMarks, PUBLIC_ONLY, pageHtml, siteConfigWarnings, sitePage } from "../../app/.server/site/pages";
import { FAKE_AZURE_KEY } from "../support/engine-fixtures";

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

describe("the start log's guard for engine sections (what runs in production; preflight reads a local .env only)", () => {
  it("names an engine whose privacy section still has open points while the pages are public", () => {
    const azure = { DEEPL_API_KEY: "fictional:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" };
    expect(siteConfigWarnings(config({ ...base, PUBLIC_PAGES: "on", ...azure }))).toEqual([
      "PUBLIC_PAGES=on: the privacy page's azure section still has open points, so the draft notice shows on it",
    ]);
    // DeepL alone (its section is reviewed with the page) and pages that aren't public: nothing.
    expect(siteConfigWarnings(config({ ...base, PUBLIC_PAGES: "on", DEEPL_API_KEY: "fictional:fx" }))).toEqual([]);
    expect(siteConfigWarnings(config({ ...base, ...azure }))).toEqual([]);
  });
});

describe("engine blocks", () => {
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
  const tokens = (order: Array<"deepl" | "azure-eu" | "azure-global" | "google-eu" | "google-global">) => ({
    tags: new Set([...order, ...order.map((t) => t.split("-")[0]!)]),
    order,
  });

  it("render DeepL alone exactly as before, without markers", () => {
    for (const file of ["privacy.html", "support.html", "index.html", "preise.html"]) {
      const html = site(file);
      const served = pageHtml(html, { publicPages: true, reviewed: false });
      expect(served, file).not.toMatch(/<!--\/?engines?:/);
      expect(pageHtml(html, { publicPages: true, reviewed: false, engines: tokens(["deepl"]) }), file).toBe(served);
    }
    const privacy = pageHtml(site("privacy.html"), { publicPages: true, reviewed: false });
    expect(privacy).toContain("DeepL SE (Cologne, Germany)");
    expect(privacy).not.toContain("Microsoft");
    expect(privacy).not.toContain("Google Cloud");
    expect(privacy).not.toContain('id="en-engines"');
  });

  it("name no processor the deployment doesn't use", () => {
    const azureOnly = pageHtml(site("privacy.html"), { publicPages: true, reviewed: false, engines: tokens(["azure-eu"]) });
    expect(azureOnly).not.toContain("DeepL SE");
    expect(azureOnly).not.toContain('id="en-deepl"');
    expect(azureOnly).toContain('id="en-azure"');
    expect(azureOnly).toContain("processed only in data centres in the EU");
    expect(azureOnly).not.toContain("outside the EU.");
    expect(azureOnly).not.toContain("Google Cloud EMEA");
  });

  it("fill in the order with the legal names, in English and German", () => {
    const html = pageHtml(site("privacy.html"), { publicPages: true, reviewed: false, engines: tokens(["deepl", "azure-eu", "google-global"]) });
    expect(html).toContain(
      "in this order: DeepL SE (Germany) → Microsoft Ireland Operations Ltd. (Azure AI Translator, EU data centres) → Google Cloud EMEA Ltd. (Cloud Translation, data centres worldwide).",
    );
    expect(html).toContain("in dieser Reihenfolge: DeepL SE (Deutschland) → Microsoft Ireland Operations Ltd. (Azure AI Translator, Rechenzentren in der EU) →");
    expect(html).toContain("Requests may be processed in Google data centres outside the EU.");
    expect(html).not.toMatch(/<!--\/?engines?:/);
    const support = pageHtml(site("support.html"), { publicPages: true, reviewed: false, engines: tokens(["deepl", "azure-eu"]) });
    expect(support).toContain("What is sent to the translation services, and when?");
    expect(support).not.toContain("What is sent to DeepL");
  });

  it("say for a single engine beside no DeepL that consent comes first and can be withdrawn, with no order or failover", () => {
    for (const engine of ["azure-eu", "google-eu"] as const) {
      const html = visible(pageHtml(site("privacy.html"), { publicPages: true, reviewed: false, engines: tokens([engine]) }));
      expect(html, engine).toContain("That agreement can be withdrawn there at any time; from then on no texts are sent.");
      expect(html, engine).toContain("Diese Zustimmung lässt sich dort jederzeit widerrufen");
      for (const phrase of ["in this order", "more than one of these services", "in the order described above", "in dieser Reihenfolge", "in der oben beschriebenen Reihenfolge"]) {
        expect(html, `${engine}: ${phrase}`).not.toContain(phrase);
      }
      expect(visible(pageHtml(site("index.html"), { publicPages: true, reviewed: false, engines: tokens([engine]) })), engine).not.toContain("in dieser Reihenfolge");
    }
    // Two or more: the order and the back-references stay.
    const two = visible(pageHtml(site("privacy.html"), { publicPages: true, reviewed: false, engines: tokens(["azure-eu", "google-eu"]) }));
    expect(two).toContain("in this order: Microsoft Ireland Operations Ltd.");
    expect(two).toContain("in the order described above");
    expect(two).toContain("in der oben beschriebenen Reihenfolge");
  });

  it("name the translation services on the support page, in English and German, once more than DeepL is set up", () => {
    const cases = [
      { order: ["azure-eu"], names: ["Microsoft Ireland Operations Ltd."] },
      { order: ["deepl", "azure-eu", "google-global"], names: ["DeepL SE", "Microsoft Ireland Operations Ltd.", "Google Cloud EMEA Ltd."] },
    ] as const;
    for (const { order, names } of cases) {
      const html = pageHtml(site("support.html"), { publicPages: true, reviewed: false, engines: tokens([...order]) });
      expect(html, order.join(",")).not.toMatch(/<!--\/?engines?:/);
      const page = visible(html);
      const en = page.slice(0, page.indexOf("Was wird an"));
      const de = page.slice(page.indexOf("Was wird an"));
      expect(en, order.join(",")).toContain("Linguva uses ");
      expect(de, order.join(",")).toContain("Linguva nutzt ");
      for (const name of names) {
        expect(en, `${order.join(",")}: ${name}`).toContain(name);
        expect(de, `${order.join(",")}: ${name}`).toContain(name);
      }
      expect(page).toContain("Then Linguva sends only the texts to translate");
      expect(page).toContain("Never customer or order data");
    }
    // DeepL alone: unchanged.
    const single = visible(pageHtml(site("support.html"), { publicPages: true, reviewed: false, engines: tokens(["deepl"]) }));
    expect(single).toContain("What is sent to DeepL, and when?");
    expect(single).not.toContain("Linguva uses ");
    expect(single).not.toContain("Linguva nutzt ");
  });

  it("send no context and name no DeepL on the support page without DeepL", () => {
    for (const order of [["azure-eu"], ["azure-eu", "google-global"]] as const) {
      const support = visible(pageHtml(site("support.html"), { publicPages: true, reviewed: false, engines: tokens([...order]) }));
      for (const phrase of ["DeepL", "as context", "als Zusammenhang"]) expect(support, `${order.join(",")}: ${phrase}`).not.toContain(phrase);
      expect(support).toContain("Then Linguva sends only the texts to translate. Never customer or order data");
    }
    const withDeepL = visible(pageHtml(site("support.html"), { publicPages: true, reviewed: false, engines: tokens(["deepl", "azure-eu"]) }));
    expect(withDeepL).toContain("(the context goes to DeepL only)");
    expect(withDeepL).toContain("(der Zusammenhang geht nur an DeepL)");
  });

  // site/Dockerfile resolves the blocks for the separate Caddy image with Perl (it can't reach the app's code).
  const perl = spawnSync("perl", ["-v"]).status === 0;
  it.skipIf(!perl)("resolve in the Caddy image exactly as for DeepL alone", () => {
    const program = /perl -0pi -e '([^']+)' \/pages\/\*\.html/.exec(readFileSync("site/Dockerfile", "utf8"))?.[1];
    expect(program, "site/Dockerfile runs the Perl stage").toBeDefined();
    // What stays besides the app's output: the invisible markers of the DeepL-only texts.
    const markers = (html: string) => html.replace(/<!--\/?(?:engines:single|engine:deepl)-->/g, "");
    for (const file of ["privacy.html", "support.html", "index.html", "preise.html", "impressum.html", "datenschutz.html"]) {
      const html = site(file);
      const built = spawnSync("perl", ["-0p", "-e", program!], { input: html, encoding: "utf8" });
      expect(built.status, file).toBe(0);
      expect(built.stdout, file).not.toMatch(/<!--\/?engines:(?:multi|several|order)|<!--\/?engine:(?!deepl-->)/);
      expect(markers(built.stdout), file).toBe(applyEngineBlocks(html, DEEPL_ONLY));
    }
  });

  it("have the same new sections in English and German", () => {
    const privacy = site("privacy.html");
    const ids = (lang: "en" | "de") => [...privacy.matchAll(new RegExp(`id="${lang}-([a-z-]+)"`, "g"))].map(([, id]) => id);
    for (const id of ["engines", "azure", "google"]) expect(ids("en"), id).toContain(id);
  });

  it("show the draft notice only for open points that stay on the page", () => {
    const html = '<!--draft-->Draft<!--/draft--><!--engine:azure--><p>Azure <mark class="open">[x]</mark></p><!--/engine:azure-->';
    expect(pageHtml(html, { publicPages: true, reviewed: true })).toBe("");
    expect(pageHtml(html, { publicPages: true, reviewed: true, engines: tokens(["deepl", "azure-eu"]) })).toContain("Draft");
  });

  it("list the engine blocks with open points among those in use", () => {
    const privacy = site("privacy.html");
    expect(engineBlocksWithOpenMarks(privacy, new Set(["deepl"]))).toEqual(["deepl"]);
    expect(engineBlocksWithOpenMarks(privacy, tokens(["deepl", "azure-eu"]).tags).sort()).toEqual(["azure", "deepl"]);
    expect(engineBlocksWithOpenMarks('<!--engine:azure--><!--engine:azure-global--><mark class="open">x</mark><!--/engine:azure-global-->ok<!--/engine:azure-->', new Set(["azure", "azure-eu"]))).toEqual([]);
    expect(visible(pageHtml(privacy, { publicPages: true, reviewed: false }))).toContain("DeepL SE");
  });
});
