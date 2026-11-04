/**
 * The tools pages' header and cards: each tool's sign is the icon and tint of its tile in Settings › Tools,
 * the header draws the trail back to Settings › Tools, the sign and the page's one h1 (the Plan page's
 * PageHeader the same way), and a tools page's cards keep their edge on a phone with their heading in the
 * type scale, never a Polaris section's second, hidden heading.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "../../app/components/Card";
import { PAGE_LOOK, PageHeader } from "../../app/components/PageHeader";
import { PermissionCard } from "../../app/components/PermissionCard";
import { TOOL_LOOK, ToolHeader, TOOLS_HREF } from "../../app/components/ToolHeader";
import { translator } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

const html = (node: ReactNode) => renderToStaticMarkup(createElement(I18nProvider, { locale: "de", timeZone: "Europe/Berlin" } as ComponentProps<typeof I18nProvider>, node));

describe("the tools' signs", () => {
  it("are the icons and tints of their tiles in Settings › Tools", () => {
    const settings = readFileSync(join(__dirname, "../../app/routes/app.settings.tsx"), "utf8");
    for (const look of Object.values(TOOL_LOOK)) {
      const tile = new RegExp(`\\{ href: "${look.href.replace(/\//g, "\\/")}", icon: "([\\w-]+)", tint: "(\\w+)"`).exec(settings);
      expect(tile, look.href).not.toBeNull();
      expect({ icon: tile![1], tint: tile![2] }, look.href).toEqual({ icon: look.icon, tint: look.tint });
    }
  });
});

describe("the Plan's sign", () => {
  it("is Settings' 'Plan & usage' tile's icon and tint, and never gauge (the AI characters' sign)", () => {
    const settings = readFileSync(join(__dirname, "../../app/routes/app.settings.tsx"), "utf8");
    const tile = /\n {2}plan: \{ icon: "([\w-]+)", tint: "(\w+)" \}/.exec(settings);
    expect(tile).not.toBeNull();
    expect({ icon: tile![1], tint: tile![2] }).toEqual(PAGE_LOOK.plan);
    expect(PAGE_LOOK.plan).toEqual({ icon: "credit-card", tint: "rose" });
    expect(html(createElement(PageHeader, { page: "plan", title: "Plan" }))).toContain('<span class="lv-icon-square" data-tint="rose" aria-hidden="true"><s-icon type="credit-card"');
  });
});

describe("ToolHeader", () => {
  it("draws the trail to Settings › Tools, the tool's sign and the page's heading with its lead", () => {
    const markup = html(createElement(ToolHeader, { tool: "glossary", title: "Glossar", lead: "Begriffe, die die KI immer gleich behandelt.", i18n: translator("de") }));
    expect(markup).toContain('<nav aria-label="Brotkrumen">');
    expect(markup).toContain('<s-link href="/app/settings">Einstellungen</s-link>');
    expect(markup).toContain(`<s-link href="${TOOLS_HREF}">Werkzeuge</s-link>`);
    // The phone's 44 px back row leads to the tools.
    expect(markup).toMatch(new RegExp(`<s-clickable href="${TOOLS_HREF.replace("?", "\\?")}"[^>]*minBlockSize="44px"`));
    expect(markup).toContain('<span class="lv-icon-square" data-tint="violet" aria-hidden="true"><s-icon type="book-open"');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('<h1 class="lv-h1">Glossar</h1>');
    expect(markup).toContain("Begriffe, die die KI immer gleich behandelt.");
  });
});

describe("the headers' sign", () => {
  it("is centred beside a heading alone, and marked for the narrow page's rule where a lead can wrap", () => {
    const tool = html(createElement(ToolHeader, { tool: "memory", title: "Übersetzungsspeicher", lead: "Jede veröffentlichte Übersetzung …", i18n: translator("de") }));
    // ui.css (.lv-page-head): on a narrow page the sign stays level with the heading instead of the lead's middle.
    expect(tool).toContain('<div class="lv-page-head"><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center"><span class="lv-icon-square" data-tint="amber"');
    const alone = html(createElement(PageHeader, { page: "smart", title: "Smarter Zeitplan" }));
    expect(alone).not.toContain("lv-page-head");
    expect(alone).toContain('<div><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center"><span class="lv-icon-square" data-tint="violet"');
  });

  it("gives the Plan page its trail as close to the heading as a tools page's, with the phone's back row", () => {
    const i18n = translator("en");
    const markup = html(createElement(PageHeader, { page: "plan", title: "Plan", lead: "Your plan …", trail: { i18n, links: [{ href: "/app/settings?section=plan", label: "Settings" }] } }));
    const tool = html(createElement(ToolHeader, { tool: "glossary", title: "Glossary", lead: "Words …", i18n }));
    // The same stack between the trail and the heading on both pages.
    for (const header of [markup, tool]) expect(header).toMatch(/^<s-query-container><s-stack direction="block" gap="small-200"><nav aria-label="Breadcrumb">/);
    expect(markup).toMatch(/<s-clickable href="\/app\/settings\?section=plan"[^>]*minBlockSize="44px"/);
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    // Without a trail, the menu pages' header has none.
    expect(html(createElement(PageHeader, { page: "jobs", title: "Jobs" }))).not.toContain("<nav");
  });

  it("is the page's subject on a page about one thing (a flag, an area, a picture), its badges beside the one heading", () => {
    const i18n = translator("en");
    const markup = html(
      createElement(PageHeader, {
        sign: createElement("span", { className: "flag" }),
        title: "Products in German",
        badges: createElement("s-badge", { icon: "hide" }, "Hidden"),
        lead: "48 products",
        trail: { i18n, links: [{ href: "/app/languages/de", label: "German" }], current: "Products" },
      }),
    );
    // The same opening as every header: trail, then the row with the sign.
    expect(markup).toMatch(/^<s-query-container><s-stack direction="block" gap="small-200"><nav aria-label="Breadcrumb">/);
    expect(markup).toContain('<div class="lv-page-head"><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center"><span class="flag"></span>');
    expect(markup).not.toContain("lv-icon-square");
    expect(markup).toContain('<s-stack direction="inline" gap="small-200" alignItems="center"><h1 class="lv-h1">Products in German</h1><s-badge icon="hide">Hidden</s-badge></s-stack>');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    // The trail ends in the page's own short name.
    expect(markup).toContain('<span aria-current="page"><s-text color="subdued">Products</s-text></span>');
    // Without badges the heading stands alone, as on the menu pages.
    expect(html(createElement(PageHeader, { sign: createElement("span"), title: "Jobs" }))).toContain('<s-stack direction="block" gap="small-500"><h1 class="lv-h1">Jobs</h1></s-stack>');
  });
});

describe("a tools page's card", () => {
  const cards = (node: ReactNode) => html(node);

  it("is a section with the card's edge on every width, named by its heading in the type scale", () => {
    const markup = cards(createElement(Card, { heading: "Add a term" }, createElement("p", null, "Form")));
    expect(markup).not.toContain("<s-section");
    expect(markup).toMatch(/^<section aria-labelledby="([^"]+)"><s-box background="base" border="base" borderRadius="large-100" padding="base"><s-stack direction="block" gap="base"><h2 id="\1" class="lv-h2">Add a term<\/h2><p>Form<\/p>/);
  });

  it("keeps a table's card padded around its heading only, and names a card by a heading inside it", () => {
    const table = cards(createElement(Card, { heading: "Terms (3)", padding: "none" }, createElement("s-table")));
    expect(table).toMatch(/<s-box background="base" border="base" borderRadius="large-100" padding="none" overflow="hidden"><s-box padding="base base small-200"><h2 id="[^"]+" class="lv-h2">Terms \(3\)<\/h2><\/s-box><s-table><\/s-table>/);
    const named = cards(createElement(Card, { labelledBy: "plan-hero-heading" }, "Pro"));
    expect(named).toBe('<section aria-labelledby="plan-hero-heading"><s-box background="base" border="base" borderRadius="large-100" padding="base">Pro</s-box></section>');
    // Unnamed (a form, a fold): a plain section, no landmark.
    expect(cards(createElement(Card, null, "Fold"))).toMatch(/^<section><s-box /);
  });
});

describe("a permission's card", () => {
  it("draws the lock, what the permission is for, what it unlocks with its icons, and its one button beside the note", () => {
    const markup = html(
      createElement(PermissionCard, {
        id: "markets-access",
        heading: "See your languages per market",
        body: "To show this, Linguva needs to read your markets.",
        itemsLabel: "What you see with it",
        items: [
          { icon: "language", label: "Languages per market" },
          { icon: "domain", label: "Web addresses" },
        ],
        action: createElement("button", { type: "submit" }, "Allow access to markets"),
        note: "You confirm it once in Shopify.",
      }),
    );
    expect(markup).toMatch(/^<section aria-labelledby="markets-access"><s-box background="base" border="base" borderRadius="large-100" padding="large">/);
    expect(markup).toContain('<span class="lv-icon-square" data-tint="slate" aria-hidden="true"><s-icon type="lock"');
    expect(markup).toContain('<h2 id="markets-access" class="lv-h2">See your languages per market</h2>');
    expect(markup).toContain('<ul aria-label="What you see with it"');
    expect(markup).toContain('<s-chip><s-icon slot="graphic" type="domain"></s-icon>Web addresses</s-chip>');
    expect(markup).toContain('<button type="submit">Allow access to markets</button><s-text color="subdued">You confirm it once in Shopify.</s-text>');
  });
});
