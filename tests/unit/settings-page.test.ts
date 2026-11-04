/**
 * Settings (app/routes/app.settings.tsx) rendered on the server with
 * fictional loader data, as the browser first receives it: the sections'
 * tiles say a section's state in their own few words where an option's name
 * doesn't fit a phone's tile (automatic publishing in French and Spanish)
 * or would say a choice's label out of context (the usual form of address),
 * German "KI-" compounds in an option's text keep their non-breaking
 * hyphen, so no line ends in "KI-", how AI writes heads both its topics and
 * draws the glossary's link blue, and the Business lock says its plan once.
 * (tests/ui/settings.spec.ts checks the page with Polaris drawn, the lines a
 * tile takes included.)
 */
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Settings from "../../app/routes/app.settings";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

// Only the page's component runs here (with the loader's data given): Shopify's app isn't built, so its
// session storage never polls a database the unit tests don't have.
vi.mock("../../app/shopify.server", () => ({ authenticate: {} }));

/** A Pro store with one language, AI allowed, publishing automatically and reusing AI translations. */
function store(extra: Record<string, unknown> = {}) {
  return {
    engines: { configured: ["deepl"], text: ["deepl"], missing: [], servedBy: null, noFormality: [] },
    smartCheckKey: "00000000-0000-4000-8000-000000000000",
    smart: null,
    style: { languages: [{ locale: "de", name: "German", formality: "default" }], storeContext: "", maxContext: 500 },
    glossaryTerms: 0,
    consent: true,
    consentAt: "2026-10-01T09:00:00.000Z",
    publishMode: "AUTO_PUBLISH",
    autoPublishInPlan: true,
    reuseMachineMemory: true,
    auto: { enabled: false, locales: [], available: true, planIncludes: true, allowedLocales: ["de"], paused: null },
    aiAvailable: true,
    now: "2026-11-03T09:00:00.000Z",
    version: { builtAt: null, commit: null },
    resetsOn: "2026-12-01T00:00:00.000Z",
    used: 0,
    limit: 1_200_000,
    plan: { state: "ACTIVE", configured: true, handle: "pro" },
    ownKeys: null,
    backToJob: null,
    ...extra,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale, path = "/app/settings?section=publish") {
  const handler = createStaticHandler([{ id: "settings", path: "/app/settings", loader: () => data, Component: Settings }]);
  const context = await handler.query(new Request(`https://linguva.test${path}`));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })));
}

/** Text as read: React writes ' and & as entities. */
const decoded = (text: string) => text.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The state a section's tile shows (one tile per section: with a section shown, only the wide row is drawn). */
function tileState(html: string, key: string): string {
  const tiles = [...html.matchAll(new RegExp(`<a [^>]*data-section="${key}"[^>]*>([\\s\\S]*?)</a>`, "g"))];
  expect(tiles, key).toHaveLength(1);
  return decoded(tiles[0][1].match(/<span class="lv-tile__state">([^<]*)<\/span>/)![1]);
}

/** A section's markup, by its element id. */
function sectionHtml(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

/** An option's body text, by the id of its title. */
function optionBody(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  return html.slice(start).match(/<span class="lv-option__body">([^<]*)<\/span>/)![1];
}

describe("the section tiles' few words", () => {
  it("name automatic publishing in words that fit a phone's tile (French and Spanish as a noun, like the review's state)", async () => {
    const expected: Record<AppLocale, [string, string]> = {
      en: ["Publish automatically", "Review first"],
      de: ["Automatisch veröffentlichen", "Erst prüfen"],
      fr: ["Publication automatique", "Révision préalable"],
      es: ["Publicación automática", "Revisión previa"],
    };
    for (const [locale, [auto, review]] of Object.entries(expected) as Array<[AppLocale, [string, string]]>) {
      expect(tileState(await render(store(), locale), "publish"), locale).toBe(auto);
      expect(tileState(await render(store({ publishMode: "DRAFT" }), locale), "publish"), locale).toBe(review);
      // Left on from a bigger plan, nothing publishes by itself: the tile says what really happens.
      expect(tileState(await render(store({ autoPublishInPlan: false }), locale), "publish"), locale).toBe(review);
    }
    // The option itself keeps its own name.
    expect(await render(store(), "fr")).toContain(">Publier automatiquement<");
    expect(await render(store(), "es")).toContain(">Publicar automáticamente<");
  });

  it("name the usual form of address as the setting, not as the choice's label: the tile has no hint beside it", async () => {
    const expected: Record<AppLocale, string> = { en: "Usual form of address", de: "Übliche Anrede", fr: "Forme d'adresse habituelle", es: "Tratamiento habitual" };
    for (const [locale, words] of Object.entries(expected) as Array<[AppLocale, string]>) {
      expect(tileState(await render(store(), locale), "style"), locale).toBe(words);
    }
    // The choice itself keeps its label ("Automatic", never "DeepL decides"), explained by the hint beside it.
    const style = sectionHtml(await render(store(), "en", "/app/settings?section=style"), "settings-style");
    expect(style).toContain(">Automatic<");
    expect(decoded(style)).toContain("Automatic: each language's usual form.");
    expect(style).not.toContain("DeepL decides");
    const labels: Record<AppLocale, string> = { en: "Automatic", de: "Automatisch", fr: "Automatique", es: "Automático" };
    for (const [locale, label] of Object.entries(labels) as Array<[AppLocale, string]>) {
      expect(sectionHtml(await render(store(), locale, "/app/settings?section=style"), "settings-style"), locale).toContain(`<span class="lv-seg__text">${label}</span>`);
    }
  });
});

describe("how AI writes", () => {
  it("heads its two topics alike: the store's description under its own heading, its field's label kept for screen readers", async () => {
    const style = sectionHtml(await render(store(), "en", "/app/settings?section=style"), "settings-style");
    expect([...style.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1])).toEqual(["Form of address", "About your store"]);
    expect(style.indexOf("<s-divider>")).toBeLessThan(style.indexOf(">About your store</h3>"));
    const area = style.match(/<s-text-area [^>]*>/)![0];
    expect(area).toContain('label="About your store"');
    expect(area).toContain('labelAccessibilityVisibility="exclusive"');
    // An example, said as one (the field is empty: a full sentence in grey read as a saved value).
    expect(area).toContain('placeholder="e.g. outdoor clothing for families, friendly and simple"');
  });

  it("draws the glossary's link as a link: outside the line's s-text, after a middle dot", async () => {
    const style = sectionHtml(await render(store({ glossaryTerms: 3 }), "en", "/app/settings?section=style"), "settings-style");
    expect(style).toContain('<span><s-text>Fixed terms in the glossary: 3</s-text> · <s-link href="/app/glossary">Edit glossary</s-link></span>');
  });
});

describe("the Business lock", () => {
  it("is its badge and the plans link on one line: no sentence repeating the plan's name", async () => {
    const html = await render(store(), "en", "/app/settings?section=changes");
    const smart = html.slice(html.indexOf('data-option="settings-changes-smart"'));
    expect(smart).toContain('<div class="lv-option__foot"><s-stack direction="inline" gap="small-200" alignItems="center"><s-badge icon="lock">Business</s-badge><s-link href="/app/plan">See plans</s-link></s-stack></div>');
    expect(html).not.toContain("In the Business plan.");
  });
});

describe("German texts in the options", () => {
  it("write \"KI-\" compounds with a non-breaking hyphen, so a narrow option never ends a line in \"KI-\"", async () => {
    const body = optionBody(await render(store(), "de", "/app/settings?section=memory"), "settings-memory-machine");
    expect(body).toBe("Spart KI‑Zeichen, aber ein Fehler wiederholt sich überall, wo derselbe Text vorkommt.");
    expect(body).not.toMatch(/KI-/);
  });
});

describe("one card per section, with less said twice", () => {
  it("draws the services added after the permission as a part of its card under a heading, not as a box inside it", async () => {
    const data = store({ engines: { configured: ["deepl", "azure-eu"], text: ["deepl"], missing: ["azure-eu"], servedBy: null, noFormality: [] } });
    const ai = sectionHtml(await render(data, "en", "/app/settings?section=ai"), "settings-ai");
    // The section's card is the only frame.
    expect(ai.match(/border="base"/g)).toHaveLength(1);
    expect(ai).toContain('<div id="settings-ai-extra" role="group" aria-labelledby="settings-ai-extra-heading">');
    expect(ai).toMatch(/<h3 id="settings-ai-extra-heading"[^>]*>More translation services<\/h3>/);
    expect(ai).toContain(">Allow these too<");
  });

  it("leaves out a lead that only names what follows: How AI writes, Plan & usage and Tools start with their content", async () => {
    for (const [key, gone] of [
      ["style", "How AI addresses your customers"],
      ["plan", "Your plan and the AI characters"],
      ["tools", "More pages around your translations"],
    ] as const) {
      const html = sectionHtml(await render(store(), "en", `/app/settings?section=${key}`), `settings-${key}`);
      expect(decoded(html), key).not.toContain(gone);
      // No lead: the section's heading row has no line under it.
      expect(html.slice(0, html.indexOf("</h2>") + 200), key).not.toContain('<s-text color="subdued">');
    }
  });

  it("says what happens while jobs can't run, never a “background service”", async () => {
    const smart = {
      entitled: true,
      status: { state: "waiting", reason: "WORKER" },
      zone: "UTC",
      config: { enabled: true, mode: "daily", timeZone: "UTC", times: [180], weekdays: [1, 2, 3, 4, 5, 6, 7], locales: ["de"] },
      nextChecks: [],
    };
    for (const locale of ["en", "de", "fr", "es"] as const) {
      // What a reader sees: the words without the tags (a box's background="base" is no text).
      const words = decoded(await render(store({ smart }), locale, "/app/settings?section=changes")).replace(/<[^>]+>/g, " ");
      expect(words, locale).not.toMatch(/background|Hintergrund|arrière-plan|segundo plano/i);
    }
    expect(decoded(await render(store({ smart }), "en", "/app/settings?section=changes"))).toContain("Translating paused");
  });
});
