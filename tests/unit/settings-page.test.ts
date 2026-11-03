/**
 * Settings (app/routes/app.settings.tsx) rendered on the server with
 * fictional loader data, as the browser first receives it: the sections'
 * tiles say a section's state in their own few words where an option's name
 * doesn't fit a phone's tile (automatic publishing in French and Spanish),
 * and German "KI-" compounds in an option's text keep their non-breaking
 * hyphen, so no line ends in "KI-". (tests/ui/settings.spec.ts checks the
 * page with Polaris drawn, the lines a tile takes included.)
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

/** The state a section's tile shows (one tile per section: with a section shown, only the wide row is drawn). */
function tileState(html: string, key: string): string {
  const tiles = [...html.matchAll(new RegExp(`<a [^>]*data-section="${key}"[^>]*>([\\s\\S]*?)</a>`, "g"))];
  expect(tiles, key).toHaveLength(1);
  return tiles[0][1].match(/<span class="lv-tile__state">([^<]*)<\/span>/)![1];
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
});

describe("German texts in the options", () => {
  it("write \"KI-\" compounds with a non-breaking hyphen, so a narrow option never ends a line in \"KI-\"", async () => {
    const body = optionBody(await render(store(), "de", "/app/settings?section=memory"), "settings-memory-machine");
    expect(body).toBe(
      "Auch ungeprüfte KI‑Übersetzungen werden wiederverwendet. Das spart KI‑Zeichen und hält Formulierungen einheitlich; ein Fehler darin wiederholt sich aber überall, wo derselbe Text vorkommt.",
    );
    expect(body).not.toMatch(/KI-/);
  });
});
