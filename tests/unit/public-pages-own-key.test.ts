/**
 * The Own key plan's texts on the website (docs/PRICING_DECISION.md §9 step 11): gated blocks
 * `<!--ownkey-->…<!--/ownkey-->` (only with OWN_KEY_PLAN_VISIBLE=on) and
 * `<!--ownkey:off-->…<!--/ownkey:off-->` (only without it). With the flag off every page is what it
 * was before the plan existed; the Caddy image always serves it that way.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getConfig } from "../../app/.server/lib/config";
import { applyEngineBlocks, applyOwnKeyBlocks, DEEPL_ONLY, ownKeyBlocksHaveOpenMarks } from "../../app/.server/site/engine-blocks";
import { openOwnKeySection, pageHtml, siteConfigWarnings, sitePage, type SitePage } from "../../app/.server/site/pages";
import { FAKE_AZURE_KEY } from "../support/engine-fixtures";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  NODE_ENV: "production",
  REDIS_URL: "redis://localhost:6379",
};
const config = (env: Record<string, string>) => getConfig(env as NodeJS.ProcessEnv);
const request = (path: string) => new Request(`https://linguva.example${path}`);
const site = (file: string) => readFileSync(`site/${file}`, "utf8");
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const tokens = (order: Array<"deepl" | "azure-eu" | "azure-global" | "google-eu" | "google-global">) => ({
  tags: new Set([...order, ...order.map((t) => t.split("-")[0]!)]),
  order,
});
const served = (file: string, ownKeyPlan: boolean, engines = DEEPL_ONLY) => pageHtml(site(file), { publicPages: true, reviewed: false, engines, ownKeyPlan });
const FILES = ["privacy.html", "support.html", "index.html", "preise.html", "impressum.html", "datenschutz.html"];
const GATED = ["privacy.html", "support.html", "index.html", "preise.html"];
const PAGES: SitePage[] = ["home", "pricing", "imprint", "privacy", "appPrivacy", "support"];

describe("applyOwnKeyBlocks", () => {
  const html = "a<!--ownkey-->ON<!--/ownkey-->b<!--ownkey:off-->OFF<!--/ownkey:off-->c<!--ownkey-->\nTWO\n<!--/ownkey-->d";

  it("keeps the plan's blocks only while it is shown, and the off blocks only while it isn't", () => {
    expect(applyOwnKeyBlocks(html, false)).toBe("abOFFcd");
    expect(applyOwnKeyBlocks(html, true)).toBe("aONbc\nTWO\nd");
    expect(applyOwnKeyBlocks("<!--engine:azure-->x<!--/engine:azure-->", true)).toBe("<!--engine:azure-->x<!--/engine:azure-->");
  });

  it("are the default of pageHtml (hidden) and resolve after the engine blocks", () => {
    expect(pageHtml(html, { publicPages: true, reviewed: true })).toBe("abOFFcd");
    expect(pageHtml(html, { publicPages: true, reviewed: true, ownKeyPlan: true })).toBe("aONbc\nTWO\nd");
  });

  it("never show the draft notice for an open point in a hidden block", () => {
    const page = '<!--draft-->Draft<!--/draft--><!--ownkey--><p>Own key <mark class="open">[x]</mark></p><!--/ownkey-->';
    expect(pageHtml(page, { publicPages: true, reviewed: true })).toBe("");
    expect(pageHtml(page, { publicPages: true, reviewed: true, ownKeyPlan: true })).toContain("Draft");
    expect(ownKeyBlocksHaveOpenMarks(page)).toBe(true);
    expect(ownKeyBlocksHaveOpenMarks('<mark class="open">x</mark><!--ownkey-->y<!--/ownkey-->')).toBe(false);
  });
});

describe("the website's own-key blocks", () => {
  it("are well formed: paired, never nested in each other or in an engine block", () => {
    for (const file of FILES) {
      const html = site(file);
      const count = (marker: string) => html.split(marker).length - 1;
      expect(count("<!--ownkey-->"), file).toBe(count("<!--/ownkey-->"));
      expect(count("<!--ownkey:off-->"), file).toBe(count("<!--/ownkey:off-->"));
      for (const [, inner] of html.matchAll(/<!--ownkey(?::off)?-->([\s\S]*?)<!--\/ownkey(?::off)?-->/g)) {
        expect(inner, file).not.toMatch(/<!--\/?(?:ownkey|engines?:)/);
      }
      // Whatever engines are in use, every own-key marker survives the engine blocks.
      for (const engines of [DEEPL_ONLY, tokens(["azure-eu"]), tokens(["deepl", "azure-global", "google-global"])]) {
        const resolved = applyEngineBlocks(html, engines);
        expect(resolved.split("<!--ownkey-->").length - 1, file).toBe(count("<!--ownkey-->"));
        expect(resolved.split("<!--ownkey:off-->").length - 1, file).toBe(count("<!--ownkey:off-->"));
      }
    }
    for (const file of GATED) expect(site(file), file).toContain("<!--ownkey-->");
  });

  it("are gone while the flag is off: no marker, no Own key text", async () => {
    for (const engines of [DEEPL_ONLY, tokens(["deepl", "azure-eu", "google-global"])]) {
      for (const file of FILES) {
        const html = served(file, false, engines);
        expect(html, file).not.toMatch(/ownkey/i);
        expect(html, file).not.toContain("Own key");
        expect(html, file).not.toContain("Eigener");
        expect(html, file).not.toContain("own-key.css");
      }
    }
    // As served, with the flag unset and set to off.
    for (const flag of [undefined, "off" as const]) {
      for (const page of PAGES) {
        const html = await sitePage(request("/x"), page, { PUBLIC_PAGES: "on", LEGAL_TEXTS_REVIEWED: undefined, OWN_KEY_PLAN_VISIBLE: flag }).text();
        expect(html, page).not.toMatch(/ownkey|Own key|Eigener/i);
      }
    }
  });

  it("keep today's words while the flag is off and the plan's words while it is on", () => {
    const off = visible(served("index.html", false));
    expect(off).toContain("Bei Pro und Business kannst du automatisches Veröffentlichen einschalten");
    expect(off).toContain("Automatisches Veröffentlichen kannst du bei Pro und Business einschalten");
    expect(off).toContain('<span class="tag">Glossar ab Pro</span>');
    expect(off).toContain('<ul class="mini" aria-label="Die vier Tarife">');
    expect(off).not.toContain("Pro, Business und Own key");

    const on = visible(served("index.html", true));
    expect(on).toContain("Bei Pro, Business und Own key kannst du automatisches Veröffentlichen einschalten");
    expect(on).toContain("Automatisches Veröffentlichen kannst du bei Pro, Business und Own key einschalten");
    expect(on).toContain('<span class="tag">Glossar ab Pro und in Own key</span>');
    expect(on).toContain('<ul class="mini" aria-label="Die fünf Tarife">');
    expect(on).not.toContain("Die vier Tarife");
    expect(on.match(/<ul class="mini"/g)).toHaveLength(1);
    expect(on).toContain('<p class="pn">Own key</p><p class="pp">49&nbsp;$ <span class="per">/ Monat</span></p>');
    expect(on).toContain("Im Tarif Own key übersetzt Linguva nur mit deinem eigenen Schlüssel für DeepL, Microsoft Azure oder Google Cloud.");
    expect(on).not.toContain("Pro und Business");
  });

  it("show the Own key card on /preise only with the flag, spanning the plans grid, monthly only and without a trial", async () => {
    const off = await sitePage(request("/preise"), "pricing", { PUBLIC_PAGES: "off", LEGAL_TEXTS_REVIEWED: undefined }).text();
    expect(off).toContain('<meta name="description" content="Linguva-Preise: Free, Starter, Pro und Business, mit kostenloser Testphase.">');
    expect(off.match(/<article class="plan[" ]/g)).toHaveLength(4);

    const on = await sitePage(request("/preise"), "pricing", { PUBLIC_PAGES: "off", LEGAL_TEXTS_REVIEWED: undefined, OWN_KEY_PLAN_VISIBLE: "on" }).text();
    expect(on).toContain('<meta name="description" content="Linguva-Preise: Free, Starter, Pro, Business und Own key mit deinem eigenen Übersetzungsschlüssel.">');
    expect(on.match(/<meta name="description"/g)).toHaveLength(1);
    expect(on.match(/<article class="plan[" ]/g)).toHaveLength(5);
    const card = on.slice(on.indexOf('<article class="plan plan-wide"'), on.indexOf("</article>", on.indexOf("plan-wide")));
    expect(card).toContain('<h2 id="plan-ownkey" class="plan-name">Own key</h2>');
    expect(card).toContain('<span class="amt">49&nbsp;$</span> <span class="per">/ Monat</span>');
    expect(card).toContain('<p class="plan-year">Nur monatlich</p>');
    expect(card).toContain("Lege bei deinem Dienst ein Kostenlimit oder Budget fest.");
    expect(card).toContain("Linguva wechselt nie zu eigenen Diensten.");
    expect(card).toContain("Ohne Testphase und ohne intelligenten Zeitplan.");
    expect(card).not.toContain("Jahr");
    // The card's stylesheet, below the shared one.
    expect(on).toMatch(/<link rel="stylesheet" href="[^"]*">\n<link rel="stylesheet" href="[^"]*">\n<\/head>/);
    expect(off).not.toMatch(/<link rel="stylesheet" href="[^"]*">\n<link rel="stylesheet"/);
    expect(site("preise.html")).toContain('<!--ownkey-->\n<link rel="stylesheet" href="assets/own-key.css"><!--/ownkey-->\n</head>');
    expect(on).toContain("Own key: die Funktionen von Pro mit deinem eigenen Übersetzungsschlüssel statt KI&#8209;Zeichen, 49&nbsp;$ im Monat, nur monatlich.");
    expect(on).toContain("Im Tarif Own key zählt Linguva keine KI&#8209;Zeichen");
    // The trial sentences stay true (Starter, Pro and Business).
    expect(on).toContain("Starter, Pro und Business kannst du bis zu 7 Tage kostenlos testen");
  });

  it("make the privacy policy name every service, what it gets and that the store's contract applies, also with DeepL alone", () => {
    for (const engines of [DEEPL_ONLY, tokens(["deepl", "azure-eu", "google-global"])]) {
      const page = visible(served("privacy.html", true, engines));
      const en = page.slice(0, page.indexOf('id="de"'));
      const de = page.slice(page.indexOf('id="de"'));
      for (const name of ["DeepL SE", "Microsoft Ireland Operations Ltd.", "Google Cloud EMEA Ltd."]) {
        expect(en, name).toContain(name);
        expect(de, name).toContain(name);
      }
      expect(en).toContain('<h2 id="en-ownkeys">Stores on the Own key plan</h2>');
      expect(de).toContain('<h2 id="de-ownkeys">Shops im Tarif Own key</h2>');
      expect(en).toContain("The store is the customer of each of these services: its own contract and data processing terms with the service apply");
      expect(de).toContain("Der Shop ist Kunde jedes dieser Dienste");
      expect(en).toContain("Linguva never sends that store's texts to the translation services it uses with its own keys");
      expect(de).toContain("Linguva sendet die Texte dieses Shops nie an die Übersetzungsdienste, die Linguva mit eigenen Schlüsseln nutzt");
      expect(en).toContain("Translation keys (Own key plan):");
      expect(en).toContain("translation memory, glossary, translation keys and jobs.");
      expect(de).toContain("Übersetzungsspeicher, Glossar, Übersetzungsschlüssel und Aufträge.");
      expect(en).toContain("So are its own translation keys; encrypted copies remain in the database backups until those expire");
      expect(de).toContain("Ebenso seine eigenen Übersetzungsschlüssel");
      expect(en).toContain('<p class="stand">Last updated: 1 November 2026</p>');
      expect(de).toContain('<p class="stand">Stand: 1. November 2026</p>');
    }
    // DeepL alone: the operator's Azure and Google sections stay hidden (they describe Linguva's own use).
    const deeplOnly = served("privacy.html", true);
    expect(deeplOnly).not.toContain('id="en-azure"');
    expect(deeplOnly).not.toContain('id="en-google"');
    expect(deeplOnly).not.toContain('id="en-engines"');
    // The open point keeps the draft notice, even after the review.
    expect(pageHtml(site("privacy.html"), { publicPages: true, reviewed: true, ownKeyPlan: true })).toContain('class="draft"');
    // Flag off: today's date and none of the section.
    const off = visible(served("privacy.html", false));
    expect(off).toContain('<p class="stand">Last updated: 31 October 2026</p>');
    expect(off).toContain('<p class="stand">Stand: 31. Oktober 2026</p>');
    expect(off).not.toContain("Microsoft");
  });

  it("keep the same sections in English and German, and the support FAQ's parity, with the flag on", () => {
    const ids = (html: string, lang: "en" | "de") => [...html.matchAll(new RegExp(`id="${lang}-([a-z-]+)"`, "g"))].map(([, id]) => id);
    const privacy = site("privacy.html");
    expect(ids(privacy, "en")).toContain("ownkeys");
    expect(ids(privacy, "de")).toEqual(ids(privacy, "en"));
    const shown = served("privacy.html", true);
    expect(ids(shown, "en")).toContain("ownkeys");
    expect(ids(shown, "de")).toEqual(ids(shown, "en"));

    const count = (html: string, lang: "en" | "de") => html.split(`id="${lang}"`)[1]!.split("</section>")[0]!.match(/<details>/g)?.length;
    const on = served("support.html", true);
    const off = served("support.html", false);
    expect(count(on, "en")).toBe(count(on, "de"));
    expect(count(on, "en")).toBe(count(off, "en")! + 1);
    expect(visible(on)).toContain("Can I translate with my own DeepL, Microsoft Azure or Google Cloud key?");
    expect(visible(on)).toContain("Kann ich mit meinem eigenen Schlüssel für DeepL, Microsoft Azure oder Google Cloud übersetzen?");
    expect(visible(on)).toContain("set a cost limit or budget in your account with the service");
    expect(visible(on)).toContain("Settings › Your translation keys shows what went through your keys.");
    expect(visible(on)).toContain("Einstellungen › Deine Übersetzungsschlüssel zeigt, was über deine Schlüssel lief.");
    // The FAQ still names no prices.
    expect(on).not.toMatch(/\$\s?\d/);
  });

  // site/Dockerfile hides the plan's texts for the separate Caddy image (it can't see the app's config).
  const perl = spawnSync("perl", ["-v"]).status === 0;
  it.skipIf(!perl)("resolve in the Caddy image exactly as the app serves them with the flag off", () => {
    const programs = [...readFileSync("site/Dockerfile", "utf8").matchAll(/perl -0pi -e '([^']+)' \/pages\/\*\.html/g)].map(([, program]) => program!);
    expect(programs).toHaveLength(2);
    const markers = (html: string) => html.replace(/<!--\/?(?:engines:single|engine:deepl)-->/g, "");
    for (const file of FILES) {
      const html = site(file);
      let built = html;
      for (const program of programs) {
        const run = spawnSync("perl", ["-0p", "-e", program], { input: built, encoding: "utf8" });
        expect(run.status, file).toBe(0);
        built = run.stdout;
      }
      expect(built, file).not.toMatch(/ownkey/);
      expect(markers(built), file).toBe(applyOwnKeyBlocks(applyEngineBlocks(html, DEEPL_ONLY), false));
    }
  });
});

describe("the start log's guard for the own-key section", () => {
  const ownKeyWarning = "OWN_KEY_PLAN_VISIBLE=on and PUBLIC_PAGES=on: the privacy page's own-key section still has open points, so the draft notice shows on it";

  it("warns while the plan is shown on public pages and the section still has open points", () => {
    expect(openOwnKeySection()).toBe(true);
    expect(siteConfigWarnings(config({ ...base, PUBLIC_PAGES: "on", OWN_KEY_PLAN_VISIBLE: "on" }))).toEqual([ownKeyWarning]);
    // Next to an engine section's warning.
    const azure = { DEEPL_API_KEY: "fictional:fx", AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" };
    expect(siteConfigWarnings(config({ ...base, ...azure, PUBLIC_PAGES: "on", OWN_KEY_PLAN_VISIBLE: "on" }))).toEqual([
      "PUBLIC_PAGES=on: the privacy page's azure section still has open points, so the draft notice shows on it",
      ownKeyWarning,
    ]);
    // The plan hidden or the pages not public: nothing.
    expect(siteConfigWarnings(config({ ...base, PUBLIC_PAGES: "on" }))).toEqual([]);
    expect(siteConfigWarnings(config({ ...base, OWN_KEY_PLAN_VISIBLE: "on" }))).toEqual([]);
    expect(openOwnKeySection('<!--ownkey--><p>done</p><!--/ownkey--><mark class="open">x</mark>')).toBe(false);
  });
});
