/**
 * The Overview page (app/routes/app._index.tsx) rendered on the server with
 * fictional loader data, as the browser first receives it: the next step
 * first and the page's only primary button, each step's icon in its square,
 * the store's card with its count, the quieter rows naming their language,
 * one heading size for the sections, and the welcome after a plan is chosen.
 * (The browser tests in tests/ui/overview.spec.ts check the same page
 * with Polaris drawn.)
 */
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Overview from "../../app/routes/app._index";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

// Only the page's component runs here (with the loader's data given): Shopify's app isn't built, so its
// session storage never polls a database the unit tests don't have.
vi.mock("../../app/shopify.server", () => ({ authenticate: {} }));

const counts = { complete: 16, review: 0, draft: 6, failed: 0, outdated: 1, missing: 71 };
const language = (locale: string, name: string, published = true) => ({
  locale,
  name,
  published,
  measured: true,
  partial: false,
  unchecked: 0,
  percent: 17,
  counts,
  complete: 16,
  total: 94,
});
const row = (code: string, name: string, languages: Array<Record<string, unknown>>) => ({ code, name, markets: ["Europe"], status: "partial", languages, percent: 17 });

/** A store like the demo store: drafts to approve, an outdated text, a hidden language, countries without theirs. */
function demo(extra: Record<string, unknown> = {}) {
  return {
    shopName: "Alpine Demo Store",
    targetLocales: ["de", "es"],
    primary: "English",
    primaryLocale: "en",
    maxLocales: 20,
    remainingLocales: 17,
    aiAvailable: true,
    checklist: [],
    progress: [language("de", "German"), language("es", "Spanish", false)],
    storeShare: { complete: 16, total: 94, counts, languages: 1, published: 1, payoff: 23 },
    unreadable: null,
    measuredAt: "2026-10-30T00:53:00.000Z",
    measurement: { state: "done", done: 0, total: 0, since: null },
    next: { id: "review", count: 6 },
    attention: [
      { id: "outdated", count: 1, locales: [{ locale: "de", name: "German", count: 1 }] },
      { id: "countries", reason: "unpublished", locales: [{ locale: "es", name: "Spanish", countries: 1 }], countries: 1, notAdded: 1, free: 17 },
    ],
    countries: {
      access: true,
      rows: [
        row("DE", "Germany", [{ locale: "de", available: true, primary: false, percent: 17 }]),
        row("ES", "Spain", [{ locale: "es", available: false, reason: "unpublished", primary: false, percent: 17 }]),
        row("CZ", "Czechia", [{ locale: "cs", available: false, reason: "not-added", primary: false, percent: null }]),
        row("US", "United States", [{ locale: "en", available: true, primary: true, percent: 100 }]),
      ],
      missing: [],
      counts: { missing: 1, low: 2, partial: 0, ok: 1 },
    },
    pendingDrafts: 6,
    activeJobs: 0,
    jobs: [],
    ownKeys: null,
    usage: { used: 0, limit: 1_200_000, usedToday: 0, dailyLimit: 1_200_000, level: "ok", trialEndsAt: null },
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    jobsAvailable: true,
    workerStopped: false,
    deeplQuota: null,
    engines: null,
    welcome: false,
    ...extra,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale = "en") {
  const handler = createStaticHandler([{ id: "overview", path: "/app", loader: () => data, Component: Overview }]);
  const context = await handler.query(new Request("https://linguva.test/app"));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })));
}

/** The markup of one native section, by its id or label. */
function section(html: string, attribute: string): string {
  const start = html.indexOf(`<section ${attribute}`);
  expect(start, attribute).toBeGreaterThanOrEqual(0);
  // Sections inside it close before it does: count them.
  let depth = 0;
  const tags = /<section\b|<\/section>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0] === "</section>" ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index);
  }
  throw new Error(`${attribute} never closes`);
}

const primaries = (html: string) => html.match(/data-variant="primary"/g) ?? [];

/** A link button by its address, variant and words, whatever the order of its attributes. */
const linkButton = (href: string, variant: "primary" | "secondary", label: string) =>
  new RegExp(`<a (?=[^>]*href="${href.replace(/[/?]/g, "\\$&")}")(?=[^>]*data-variant="${variant}")[^>]*><span class="lv-btn__label">${label}</span>`);

describe("the Overview page", () => {
  it("puts the next step first, with the page's only primary button and the icon of the place it opens", async () => {
    const html = await render(demo());
    expect(html.indexOf('<section id="overview-next"')).toBeLessThan(html.indexOf('<section aria-label="Your store"'));
    expect(primaries(html)).toHaveLength(1);
    const next = section(html, 'id="overview-next"');
    expect(next).toContain('<h2 id="overview-next-heading" class="lv-h2">Next</h2>');
    expect(next).toContain('<span class="lv-icon-square" data-tint="violet" aria-hidden="true"><s-icon type="eye-check-mark"');
    expect(next).toContain('<h3 class="lv-h3">Approve 6 translations</h3>');
    // The primary button carries no icon: the step's square is its icon.
    expect(next).toMatch(linkButton("/app/review", "primary", "Approve now"));
  });

  it("names the language in a quieter row's title and button, and opens Shopify's settings with one label and icon", async () => {
    const next = section(await render(demo()), 'id="overview-next"');
    expect(next).toContain('<strong class="lv-strong">1 text in German is outdated</strong>');
    expect(next).toContain("You changed the original. Customers still see the old translation.");
    expect(next).not.toContain("In German.");
    expect(next).toMatch(linkButton("/app/languages/de", "secondary", "Open German"));
    expect(next).toMatch(/<a href="shopify:\/\/admin\/settings\/languages"[^>]*target="_top"><span class="lv-btn__icon" aria-hidden="true"><s-icon type="language" size="small"><\/s-icon><\/span><span class="lv-btn__label">Open language settings<\/span>/);
  });

  it("keeps the store's figure in a card with its count and the button that counts again, without repeating what approving brings", async () => {
    const store = section(await render(demo()), 'aria-label="Your store"');
    expect(store).toContain('<s-box background="base" border="base" borderRadius="large-100" padding="base">');
    expect(store).toContain('<h2 class="lv-h2">Your store in 1 other language</h2>');
    expect(store).not.toContain("Once you approve");
    expect(store).toContain("Last counted: Oct 30, 2026, 12:53 AM UTC. New translations count right away.");
    expect(store).toMatch(/<button type="submit" class="lv-btn lv-btn--secondary"[^>]*><span class="lv-btn__icon" aria-hidden="true"><s-icon type="chart-donut" size="small"><\/s-icon><\/span><span class="lv-btn__label">Count translations again<\/span>/);
    // Its live region is ready before a count starts (it takes the focus once the button is gone).
    expect(store).toContain('<div role="status" tabindex="-1" class="lv-ov-status">');
  });

  it("keeps the other pages' width, its top row's two cards each as tall as its content, the step in its card without a box", async () => {
    const html = await render(demo());
    // Not "large": Content and the language pages are as wide.
    expect(html).toMatch(/<s-page heading="Overview">/);
    expect(html).toContain('<s-grid gridTemplateColumns="@container (inline-size &gt; 760px) 1fr 1fr, 1fr" gap="base" alignItems="start">');
    // No card stretched to the other's height (a half-empty card).
    expect(html).not.toContain('alignItems="stretch"');
    for (const attribute of ['id="overview-next"', 'aria-label="Your store"']) {
      expect(section(html, attribute), attribute).toMatch(/^<section [^>]*><s-box background="base" border="base" borderRadius="large-100" padding="base">/);
      expect(section(html, attribute), attribute).not.toMatch(/^<section [^>]*style=/);
    }
    // The next step sits in its card itself, not in a grey box inside it; a line divides it from the rows under it.
    const next = section(html, 'id="overview-next"');
    expect(next).not.toContain('background="subdued"');
    expect(next.indexOf("<s-divider>")).toBeGreaterThan(next.indexOf("Approve now"));
  });

  it("shows what approving brings under the figure when approving isn't the next step", async () => {
    const store = section(await render(demo({ next: { id: "translate", locale: "de", name: "German", complete: 16, total: 94 }, attention: [] })), 'aria-label="Your store"');
    expect(store).toContain("Once you approve all 6: 23%");
  });

  it("gives every section one heading size and the countries a switch of pressed buttons, the sort said in the intro", async () => {
    const html = await render(demo());
    expect(html).toContain('<h2 id="overview-places-heading" class="lv-h2">Your customers by country</h2>');
    expect(html).toContain("Each country shows the language customers read there – the least translated first.");
    expect(html).not.toContain("Least translated first");
    expect(html).not.toContain('type="sort"');
    expect(html).toContain('<div role="group" aria-label="Show by" class="lv-seg lv-seg--buttons">');
    expect(html).toContain('aria-pressed="true"><span class="lv-seg__icon" aria-hidden="true"><s-icon type="globe" size="small"></s-icon></span>Countries</button>');
    // Every card keeps its edge on a phone: none is a Polaris section.
    expect(html).not.toContain("<s-section");
    // Titles and names are semibold (Polaris draws type="strong" at the body weight); only the shared
    // state lines' figures still use it (ItemStates.tsx).
    expect(html.replace(/<s-text type="strong">\d+<\/s-text>/g, "")).not.toContain('type="strong"');
    // The page's foot: the AI characters with their icon.
    expect(html).toContain('<s-icon type="gauge" color="subdued" size="small"></s-icon></span><s-text color="subdued">AI translation this month: 0 of 1,200,000 characters</s-text>');
  });

  it("says in the languages view how the cards are sorted in one line, as the countries view does", async () => {
    const html = await render(demo({ countries: { access: false } }));
    expect(html).toContain('<h2 id="overview-places-heading" class="lv-h2">Your languages</h2>');
    expect(html).toContain("A translation counts for every country where customers read that language – the least translated first.</s-text>");
    // The cards are links: no sentence saying so.
    expect(html).not.toContain("Choose one to see");
  });

  it("marks the running jobs' section with its state's icon", async () => {
    const job = { id: "job-1", resourceType: "PRODUCT", locale: "de", done: 3, total: 10, percent: 30, discoveryDone: true, remainingMs: null, publishMode: "DRAFT" };
    const html = await render(demo({ jobs: [job], activeJobs: 1 }));
    expect(section(html, 'aria-labelledby="overview-jobs-heading"')).toContain(
      '<h2 id="overview-jobs-heading" class="lv-h2 lv-ov-heading"><span class="lv-ov-heading__icon" aria-hidden="true"><s-icon type="in-progress" tone="info"></s-icon></span>Running now</h2>',
    );
  });

  it("welcomes the merchant back from Shopify's plan page above the next step, asking for the key first on Own key", async () => {
    const welcomed = await render(demo({ welcome: true }));
    expect(welcomed).toContain('<s-banner tone="success" heading="Thanks for choosing a plan"><s-paragraph>Your plan is active. You can start translating now.</s-paragraph></s-banner>');
    expect(welcomed.indexOf("Thanks for choosing a plan")).toBeLessThan(welcomed.indexOf('<section id="overview-next"'));
    expect(primaries(welcomed)).toHaveLength(1);
    expect(await render(demo())).not.toContain("Thanks for choosing a plan");
    const ownKey = await render(demo({ welcome: true, ownKeys: { access: "plan", keys: [], startsOn: null }, next: { id: "own-key" }, attention: [] }));
    expect(ownKey).toContain("Your Own key plan is active. Add your DeepL, Microsoft Azure or Google Cloud key to start translating.");
    expect(ownKey).toContain('<s-link href="/app/settings?section=keys">Add your key</s-link>');
    expect(section(ownKey, 'id="overview-next"')).toContain('data-tint="slate" aria-hidden="true"><s-icon type="key"');
    // Its foot says a key is needed, with the key's icon.
    expect(ownKey).toContain('<s-icon type="key" color="subdued" size="small"></s-icon></span><s-text color="subdued">AI translation needs your translation key</s-text>');
  });

  it("draws each next step with its place's icon and tint, and done as a success mark", async () => {
    const square = async (next: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const html = section(await render(demo({ next, attention: [], ...extra })), 'id="overview-next"');
      return /<span class="lv-icon-square" data-tint="(\w+)" aria-hidden="true"><s-icon type="([\w-]+)"/.exec(html)?.slice(1).join(" ") ?? null;
    };
    expect(await square({ id: "consent" })).toBe("teal shield-check-mark");
    expect(await square({ id: "own-key" })).toBe("slate key");
    expect(await square({ id: "translate", locale: "de", name: "German", complete: 16, total: 94 })).toBe("blue language-translate");
    expect(await square({ id: "first-translation", href: "/app/languages/de/products" })).toBe("blue language-translate");
    expect(await square({ id: "publish-language" })).toBe("blue language");
    expect(await square({ id: "measure" }, { measurement: { state: "never", done: 0, total: 0, since: null } })).toBe("green chart-donut");
    expect(await square({ id: "unread", locale: "de" })).toBe("green chart-donut");
    expect(await square({ id: "access", types: 1, href: null })).toBe("grey lock");
    expect(await square({ id: "countries", reason: "not-in-market", locales: [{ locale: "de", name: "German", countries: 1 }], countries: 1, notAdded: 0, free: 17 })).toBe("teal globe");
    const done = section(await render(demo({ next: { id: "done" }, attention: [] })), 'id="overview-next"');
    expect(done).not.toContain("lv-icon-square");
    expect(done).toContain('<s-icon type="check-circle-filled" tone="success"></s-icon>');
  });

  it("hides the countries' own button while the next step offers adding their languages", async () => {
    const adding = { id: "countries", reason: "not-added", locales: [{ locale: "cs", name: null, countries: 1 }], countries: 1, notAdded: 1, free: 17 };
    const offered = await render(demo({ attention: [adding] }));
    const missing = section(offered, 'aria-label="No language of their own"');
    expect(missing).toContain("Czechia");
    expect(missing).not.toContain("data-button");
    expect(section(await render(demo()), 'aria-label="No language of their own"')).toContain("Open language settings");
  });

  it("reads naturally in German: other languages, counting translations, opening a language", async () => {
    const html = await render(demo(), "de");
    expect(html).toContain("Dein Shop in 1 weiteren Sprache");
    expect(html).toContain("Übersetzungen neu zählen");
    expect(html).toContain("1 Text auf Deutsch ist veraltet");
    expect(html).toContain('<span class="lv-btn__label">Deutsch öffnen</span>');
    expect(html).toContain('<h2 id="overview-next-heading" class="lv-h2">Als Nächstes</h2>');
    expect(html).toContain("Fertig: 16 von 94 Texten – in allen Sprachen, die Kunden wählen können.");
  });

  it("names the language a row opens in French and Spanish, and the store's figure reads right for 1 done text", async () => {
    // One done text of many: the label comes first, so no verb disagrees with it.
    const one = { storeShare: { complete: 1, total: 94, counts: { ...counts, complete: 1 }, languages: 1, published: 1, payoff: 23 } };
    const fr = await render(demo(one), "fr");
    // The page it opens, not a display language ("Voir en allemand").
    expect(section(fr, 'id="overview-next"')).toMatch(linkButton("/app/languages/de", "secondary", "Ouvrir la langue \\(allemand\\)"));
    expect(fr).toContain("Terminés : 1 sur 94 textes – dans toutes les langues que les clients peuvent choisir.");
    const es = await render(demo(one), "es");
    expect(section(es, 'id="overview-next"')).toMatch(linkButton("/app/languages/de", "secondary", "Abrir alemán"));
    expect(es).toContain("Listos: 1 de 94 textos – en todos los idiomas que los clientes pueden elegir.");
  });
});
