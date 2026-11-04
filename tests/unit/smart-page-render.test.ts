/**
 * The smart schedule's page (app/routes/app.settings_.automatic.tsx)
 * rendered on the server with fictional loader data, as the browser first
 * receives it: how often, the texts and outdated translations are Settings'
 * option cards (the saved choice marked, each choice posted by a hidden
 * field the cards keep up to date), the languages and the content are rows
 * of their card with no box around them, the page says "texts", never
 * "fields", and a lead that only repeats the labels under it is gone.
 * (tests/ui/smart-auto.spec.ts checks the page with Polaris drawn.)
 */
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import SmartAutomatic from "../../app/routes/app.settings_.automatic";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

// Only the page's component runs here (with the loader's data given): Shopify's app isn't built.
vi.mock("../../app/shopify.server", () => ({ authenticate: {} }));

const NOW = Date.parse("2026-11-04T09:00:00.000Z");

/** A Business store with the schedule on: every day at 23:00, German and French, products, all texts, outdated ones translated again. */
function page(config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    backToJob: null,
    engines: { configured: ["deepl"], text: ["deepl"] },
    entitled: true,
    consent: true,
    available: true,
    basicOn: false,
    autoPublishInPlan: true,
    allowance: 1_000_000,
    trial: null,
    languages: [
      { locale: "de", name: "German", inPlan: true },
      { locale: "fr", name: "French", inPlan: true },
    ],
    shopTimeZone: "Europe/Berlin",
    zones: ["Europe/Berlin", "UTC"],
    panel: {
      config: {
        enabled: true,
        mode: "daily",
        timeZone: "Europe/Berlin",
        times: [23 * 60],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        locales: ["de", "fr"],
        resourceTypes: ["PRODUCT"],
        fieldGroups: [],
        includeAttached: false,
        publishMode: "DRAFT",
        replaceOutdatedMachine: true,
        dailyBudget: 50_000,
        monthlyBudget: null,
        version: 3,
        ...config,
      },
      status: { state: "on" },
      zone: "Europe/Berlin",
      nextChecks: [],
      publishing: "DRAFT",
      lastSuccessAt: null,
      lastRun: { resourcesChanged: 3, fieldsDetected: 12, finishedAt: null },
      runs: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          trigger: "SCHEDULED",
          status: "COMPLETED",
          errorCode: null,
          createdAt: "2026-11-03T22:00:00.000Z",
          finishedAt: "2026-11-03T22:05:00.000Z",
          resourcesChecked: 64,
          resourcesChanged: 3,
          fieldsDetected: 12,
          charsEstimated: 0,
          excludedSkipped: 0,
          billed: 1_200,
          fromMemory: 640,
          failed: 0,
          retryable: 0,
          jobs: [],
        },
      ],
      translating: 0,
      estimate: null,
      remeasure: false,
      noAccess: [],
      usage: { today: 0, month: 0 },
      exclusions: [],
    },
    checkKey: "00000000-0000-4000-8000-000000000000",
    now: NOW,
    ...extra,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale = "en") {
  const handler = createStaticHandler([{ id: "smart", path: "/app/settings/automatic", loader: () => data, Component: SmartAutomatic }]);
  const context = await handler.query(new Request("https://linguva.test/app/settings/automatic"));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(I18nProvider, { locale, timeZone: "Europe/Berlin" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })));
}

/** Text as read: React writes ' and & as entities. */
const decoded = (text: string) => text.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

/** A card's markup, by its section id. */
function card(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

/** The whole element (a div) that starts at `start`: its tags counted until the one that closes it. */
function div(html: string, start: number): string {
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error("unclosed div");
}

/** The option cards of a group, by the group's name: each card's title, and whether it is the chosen one or can be chosen. */
function options(html: string, group: string): Array<{ title: string; current: boolean; choosable: boolean }> {
  const start = html.indexOf(`<div role="group" aria-label="${group}" class="lv-options"`);
  expect(start, group).toBeGreaterThanOrEqual(0);
  const grid = div(html, start);
  return [...grid.matchAll(/<div role="group" aria-labelledby="[^"]+" class="([^"]+)" data-option="[^"]+">/g)].map((m) => {
    const option = div(grid, m.index);
    return {
      title: decoded(option.match(/class="lv-option__title">([^<]*)</)![1]!),
      current: m[1]!.includes("lv-option--current"),
      choosable: m[1]!.includes("lv-option--choosable"),
    };
  });
}

/** What a reader sees: the text without its tags. */
const words = (html: string) => decoded(html.replace(/<[^>]+>/g, " "));

/** A hidden field's value, by its name. */
const hidden = (html: string, name: string) => html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"/>`))?.[1];

describe("the smart page's choices", () => {
  it("are option cards, not radio buttons: how often, the texts and outdated translations, the saved choice marked and posted", async () => {
    const html = await render(page());
    // No native radio left on the page (the Polaris checkboxes and selects aside).
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("lv-smart-tile");
    const often = options(html, "How often");
    expect(often.map((o) => o.title)).toEqual(["Shortly after each change", "Every day", "On chosen weekdays", "Several times a day", "Only on demand"]);
    expect(often.filter((o) => o.current).map((o) => o.title)).toEqual(["Every day"]);
    // Every other one is a button as a whole; the chosen one isn't.
    expect(often.filter((o) => o.choosable).map((o) => o.title)).toEqual(["Shortly after each change", "On chosen weekdays", "Several times a day", "Only on demand"]);
    expect(hidden(html, "mode")).toBe("daily");
    const texts = options(html, "Texts");
    expect(texts).toEqual([
      { title: "All texts (except web addresses)", current: true, choosable: false },
      { title: "Only certain texts", current: false, choosable: true },
    ]);
    expect(hidden(html, "fields")).toBe("all");
    const outdated = options(html, "Outdated translations");
    expect(outdated.map((o) => [o.title, o.current])).toEqual([
      ["Translate again", true],
      ["Keep them as they are", false],
    ]);
    expect(hidden(html, "outdated")).toBe("replace");
    // The chosen one says so in Settings' words, and its card's line stays under its name.
    expect(card(html, "smart-schedule")).toContain("Current setting");
    expect(decoded(card(html, "smart-schedule"))).toContain('<span class="lv-option__body">When you press “Check now”</span>');
  });

  it("start from what is saved: several times a day, only certain texts (their kinds listed), outdated ones kept", async () => {
    const html = await render(page({ mode: "custom", times: [9 * 60, 21 * 60], fieldGroups: ["title"], replaceOutdatedMachine: false }));
    expect(options(html, "How often").filter((o) => o.current).map((o) => o.title)).toEqual(["Several times a day"]);
    expect(hidden(html, "mode")).toBe("custom");
    expect(options(html, "Texts").filter((o) => o.current).map((o) => o.title)).toEqual(["Only certain texts"]);
    expect(hidden(html, "fields")).toBe("chosen");
    // The kinds of text right under the cards, in the card itself (no grey box around them).
    const scope = card(html, "smart-scope");
    expect(scope).toContain('<s-choice-list name="group" label="Kinds of text" multiple="true"');
    expect(scope).not.toContain('background="subdued"');
    expect(options(html, "Outdated translations").filter((o) => o.current).map((o) => o.title)).toEqual(["Keep them as they are"]);
    expect(hidden(html, "outdated")).toBe("keep");
    // The chosen way's panel adds only what its card's line doesn't say.
    expect(card(html, "smart-schedule")).toContain("At least an hour apart.");
  });

  it("after a move to a plan without it, are shown and marked but none can be chosen", async () => {
    const html = await render(page({}, { entitled: false }));
    for (const group of ["How often", "Texts", "Outdated translations"]) {
      const cards = options(html, group);
      expect(cards.some((o) => o.current), group).toBe(true);
      expect(cards.some((o) => o.choosable), group).toBe(false);
    }
    expect(html).not.toContain('class="lv-option__choose"');
  });
});

describe("the smart page's cards", () => {
  it("draw the languages and the content as rows of the card, apart by a line, with no box inside it", async () => {
    const scope = card(await render(page()), "smart-scope");
    // The card's own frame, then none inside it.
    expect(scope.match(/border="base"/g)).toHaveLength(1);
    expect(scope).toContain('<ul aria-labelledby="smart-languages"');
    expect(scope).toContain('<ul aria-labelledby="smart-types"');
    // Four labels at one level, the third in the app's word for them.
    expect([...scope.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1])).toEqual(["Languages", "Content", "Texts", "Outdated translations"]);
  });

  it("say texts, never fields, and keep one short line where a lead only repeated the labels under it", async () => {
    const html = decoded(await render(page()));
    expect(html).toContain("3 changes in 12 texts");
    expect(html).toContain("(12 texts)");
    expect(words(html)).not.toMatch(/\bfields?\b/i);
    // The scope, publishing and recent checks need no lead; a saved budget isn't written out under its own field.
    expect(html).not.toContain("The languages and content each check translates.");
    expect(html).not.toContain("Applies to the smart schedule's translations.");
    expect(html).not.toContain("The last checks, what they found");
    expect(html).not.toContain("Saved: 50,000 characters");
    expect(html).toContain("These are never translated by the smart schedule.");
  });

  it("are German for a German admin, in the same words", async () => {
    const html = decoded(await render(page(), "de"));
    expect(html).toContain("3 Änderungen in 12 Texten");
    expect(options(html, "Wie oft").filter((o) => o.current).map((o) => o.title)).toEqual(["Jeden Tag"]);
    expect(options(html, "Texte").map((o) => o.title)).toEqual(["Alle Texte (außer Webadressen)", "Nur bestimmte Texte"]);
    expect(words(html)).not.toMatch(/Feld/);
  });
});
