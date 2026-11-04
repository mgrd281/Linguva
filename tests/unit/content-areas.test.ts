/**
 * The Content page's map of the store (app/lib/content-areas.ts): every type
 * in exactly one place, in the language page's areas, with icons Polaris
 * draws; what a tile says in each state, and what a screen reader hears.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ContentArea, ContentPage } from "../../app/.server/content/content-page";
import type { HubStatus } from "../../app/.server/translation/content-hub";
import { requestableScopes } from "../../app/.server/translation/content-hub";
import { cardGrid } from "../../app/components/CategoryCard";
import { percentLabel } from "../../app/components/Coverage";
import { AreaTile, countNotice, LanguageChips, MoreTexts, tileLabel, tileLines } from "../../app/components/ContentTiles";
import { translator } from "../../app/i18n/i18n";
import { ATTACHED, cardColumns, GROUP_PARTS, HUB_TYPES, PART_ICON, placeOf, SCOPE_ICON, TILE_AREAS, tileState, type TileStateInput } from "../../app/lib/content-areas";
import { emptyCounts, type StateCounts } from "../../app/lib/coverage-rules";
import { tally } from "../../app/lib/coverage-view";
import { CATEGORIES, CATEGORY_IDS, categoryOf, EXTRAS, TIERS } from "../../app/lib/language-categories";
import { CONTENT_TYPES, RESOURCE_KINDS } from "../../app/lib/resource-kinds";

const STATUSES: HubStatus[] = ["has-content", "empty", "needs-permission", "unavailable", "unknown"];
const scopeOf = (type: string) => (Object.hasOwn(CONTENT_TYPES, type) ? CONTENT_TYPES[type as keyof typeof CONTENT_TYPES].scope : null);

/** The public icon names of polaris-types (what s-icon draws; private-only names draw nothing). */
function publicIcons(): Set<string> {
  const source = readFileSync(join(__dirname, "..", "..", "node_modules", "@shopify", "polaris-types", "dist", "polaris.d.ts"), "utf8");
  const union = /\ntype IconType = ([^;]+);/.exec(source)![1]!;
  return new Set([...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!));
}

describe("where each type is listed", () => {
  it("covers the 26 types of the page: products, collections, pages, blog posts, blogs and every other content type", () => {
    expect(HUB_TYPES).toHaveLength(26);
    expect(new Set(HUB_TYPES)).toEqual(new Set([...Object.keys(RESOURCE_KINDS), ...Object.keys(CONTENT_TYPES)]));
  });

  it("gives each type exactly one place for each live state", () => {
    for (const type of HUB_TYPES) {
      for (const status of STATUSES) {
        const scope = scopeOf(type);
        // A type gets "needs-permission" only with a scope the merchant can grant (content-hub.ts).
        if (status === "needs-permission" && !scope) continue;
        const place = placeOf({ type, status, scope });
        const expected = {
          "has-content": categoryOf(type) === "theme" || categoryOf(type) === "notifications" ? "part" : "tile",
          empty: "empty",
          "needs-permission": "access",
          unavailable: "unavailable",
          unknown: "unknown",
        }[status];
        expect(place.kind, `${type} ${status}`).toBe(expected);
      }
    }
  });

  it("puts theme and notification types under More texts, the others in their area's tile", () => {
    for (const type of HUB_TYPES) {
      const area = categoryOf(type);
      const place = placeOf({ type, status: "has-content", scope: scopeOf(type) });
      if (area === "theme" || area === "notifications") expect(place).toEqual({ kind: "part", extra: area });
      else expect(place).toEqual({ kind: "tile", area });
    }
    // Image descriptions and custom fields are notes in their owners' tiles, not tiles.
    expect(TILE_AREAS).toEqual(TIERS.flatMap((tier) => tier.categories).filter((id) => id !== "images" && id !== "customFields"));
  });

  it("asks only for allow-listed scopes", () => {
    const allowed = requestableScopes();
    for (const type of HUB_TYPES) {
      const scope = scopeOf(type);
      if (!scope) continue;
      const place = placeOf({ type, status: "needs-permission", scope });
      expect(place.kind === "access" && allowed.includes(place.scope), type).toBe(true);
    }
  });

  it("lists the types area by area, in the areas' order, and the groups' parts in the page's order", () => {
    const areaOrder = [...TILE_AREAS, "theme", "notifications"];
    const positions = HUB_TYPES.map((type) => areaOrder.indexOf(categoryOf(type)!));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const id of ["theme", "notifications"] as const) {
      expect([...GROUP_PARTS[id]].sort()).toEqual([...EXTRAS[id].types].sort());
      expect(GROUP_PARTS[id]).toEqual(HUB_TYPES.filter((type) => categoryOf(type) === id));
    }
  });

  it("notes the seven image and custom-field types once each, in their owners' tiles", () => {
    const noted = Object.values(ATTACHED).flatMap((parts) => [...parts.images, ...parts.customFields]);
    expect(noted).toHaveLength(7);
    expect(new Set(noted)).toEqual(new Set([...CATEGORIES.images.types, ...CATEGORIES.customFields.types]));
    expect(Object.keys(ATTACHED).every((area) => TILE_AREAS.includes(area as never))).toBe(true);
  });

  it("only uses icons Polaris draws", () => {
    const icons = publicIcons();
    expect(icons.size).toBeGreaterThan(400);
    const used = [
      ...Object.values(PART_ICON),
      // Every area's square, those without a tile of their own too (the language page's cards and steps).
      ...CATEGORY_IDS.map((id) => CATEGORIES[id].icon),
      ...Object.values(EXTRAS).map((extra) => extra.icon),
      ...Object.values(SCOPE_ICON),
      // The page's own: lock, unlock, refused, running, counting, a stalled count, hidden, notes, chevrons, no language, nothing yet.
      ...["lock", "unlock", "disabled", "in-progress", "chart-donut", "alert-triangle", "hide", "image-alt", "metafields", "chevron-right", "chevron-down", "chevron-up", "language", "product-add"],
    ];
    expect(used.filter((icon) => !icons.has(icon))).toEqual([]);
    // Every literal icon in the Content and language pages' components too.
    const files = [
      "app/components/ContentTiles.tsx",
      "app/components/CategoryCard.tsx",
      "app/components/CategoryList.tsx",
      "app/components/StepStrip.tsx",
      "app/components/ResourceList.tsx",
      "app/routes/app.content._index.tsx",
      "app/routes/app.languages.tsx",
      "app/routes/app.languages_.$locale.tsx",
      "app/routes/app.languages_.$locale_.$category.tsx",
    ];
    const sources = files.map((path) => readFileSync(join(__dirname, "..", "..", path), "utf8")).join("\n");
    const literals = [...sources.matchAll(/(?:type|icon)="([a-z0-9-]+)"/g)].map((m) => m[1]!).filter((name) => !["submit", "hidden", "strong", "button"].includes(name));
    expect(literals.length).toBeGreaterThan(5);
    expect(literals.filter((icon) => !icons.has(icon))).toEqual([]);
  });

  it("shows on the permission card what each permission unlocks, every one it can ask for", () => {
    for (const scope of requestableScopes()) expect(SCOPE_ICON[scope], scope).toBeDefined();
    expect(new Set(Object.values(SCOPE_ICON)).size).toBe(Object.keys(SCOPE_ICON).length);
    // Shopify's own pictures; a gear would read as Linguva's Settings, a table as a data grid.
    expect(PART_ICON.ONLINE_STORE_THEME_SETTINGS_CATEGORY).toBe("paint-brush-flat");
    expect(PART_ICON.METAOBJECT).toBe("metaobject");
    expect(PART_ICON.ONLINE_STORE_THEME).not.toBe(EXTRAS.theme.icon);
  });
});

describe("rows of cards", () => {
  it("are always full: one card the full width, two or three side by side, four as two by two", () => {
    expect([1, 2, 3, 4, 5, 6].map(cardColumns)).toEqual([1, 2, 3, 2, 3, 3]);
    expect(cardColumns(0)).toBe(1);
    expect(cardGrid(1)).toBe("1fr");
    expect(cardGrid(2)).toBe("@container (inline-size > 560px) 1fr 1fr, 1fr");
    expect(cardGrid(3)).toBe("@container (inline-size > 860px) 1fr 1fr 1fr, 1fr");
    expect(cardGrid(4)).toBe(cardGrid(2));
  });
});

describe("the language chips and the area tiles", () => {
  const de = translator("de");
  const languages: ContentPage["languages"] = [
    { locale: "de", name: "German", published: true, country: "DE", measured: true, complete: 3, total: 12 },
    { locale: "fr", name: "French", published: true, country: "FR", measured: false, complete: 0, total: 0 },
    { locale: "ar", name: "Arabic", published: false, country: null, measured: false, complete: 0, total: 0 },
  ];
  const render = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(StaticRouter, { location: "/app/content" }, node));

  it("show the current language in the chosen look, not as a link; the others are links named for screen readers", () => {
    const html = render(createElement(LanguageChips, { languages, current: "de", i18n: de }));
    expect(html).toMatch(/<span class="lv-lang" aria-current="page">/);
    // Visible languages first, by their German names; the hidden one last.
    expect([...html.matchAll(/<li class="lv-langs__item">/g)]).toHaveLength(3);
    expect(html.indexOf("Deutsch")).toBeLessThan(html.indexOf("Französisch"));
    expect(html.indexOf("Französisch")).toBeLessThan(html.indexOf("Arabisch"));
    expect(html).toMatch(/<a class="lv-lang" href="\/app\/content\?lang=fr"[^>]*><span class="lv-sr">Französisch<\/span><span aria-hidden="true">/);
    expect(html).toContain('<span class="lv-sr">Arabisch (versteckt)</span>');
    expect(html).not.toContain('href="/app/content?lang=de"');
    // A language's figure is on its tiles and its own page, not on its chip (German is counted: 25 %).
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/%|—/);
  });

  it("open their area's list saying they come from Content, with the area's own icon square", () => {
    const area: ContentArea = {
      id: "products",
      tier: "first",
      href: "/app/languages/de/products",
      items: 6,
      textTypes: ["PRODUCT"],
      tally: tally({ ...emptyCounts(), complete: 3, missing: 9 }),
      state: "figure",
      locked: [],
      unavailable: [],
      translating: null,
      attached: ["images"],
      pictures: false,
    };
    const html = renderToStaticMarkup(createElement(AreaTile, { area, i18n: de, pictures: undefined }));
    expect(html).toContain('href="/app/languages/de/products?from=content"');
    expect(html).toContain('<span class="lv-icon-square" data-tint="blue" aria-hidden="true"><s-icon type="product"');
    // The note on what goes with the products: alt text's own picture.
    expect(html).toContain('type="image-alt"');
    expect(html).toContain("3 von 12 Texten");
    // A running translation in the Jobs page's signs: finding its texts first, then translating them.
    const finding = renderToStaticMarkup(createElement(AreaTile, { area: { ...area, translating: "finding" }, i18n: de, pictures: undefined }));
    expect(finding).toContain('<s-icon type="search-list" tone="info" size="small"></s-icon><s-text>Texte werden gesucht</s-text>');
    const translating = renderToStaticMarkup(createElement(AreaTile, { area: { ...area, translating: "translating" }, i18n: de, pictures: undefined }));
    expect(translating).toContain('<s-icon type="in-progress" tone="info" size="small"></s-icon><s-text>Wird übersetzt</s-text>');
  });
});

describe("a tile's state", () => {
  const base: TileStateInput = { locked: [], unavailable: [], segment: { kind: "ok" }, measured: true, scanning: false, total: 10, itemsAll: 5, live: true };

  it("shows the figure of a counted area", () => {
    expect(tileState(base)).toBe("figure");
  });

  it("goes by precedence: refused, recount, not counted or counting, incomplete, new, nothing", () => {
    const noAccess: TileStateInput["segment"] = { kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content/policies" };
    // 1. A type refused live, whatever else is true.
    expect(tileState({ ...base, locked: ["SHOP_POLICY"], segment: noAccess, measured: false, scanning: true })).toBe("refused");
    expect(tileState({ ...base, unavailable: ["PAYMENT_GATEWAY"] })).toBe("refused");
    // 2. Refused at the last count, readable now.
    expect(tileState({ ...base, segment: noAccess, measured: false })).toBe("recount");
    // 3. Not counted, or being counted.
    expect(tileState({ ...base, measured: false, segment: { kind: "incomplete" } })).toBe("notCounted");
    expect(tileState({ ...base, measured: false, scanning: true })).toBe("counting");
    expect(tileState({ ...base, segment: { kind: "counting" }, scanning: true })).toBe("counting");
    // 4. Not read in full.
    expect(tileState({ ...base, segment: { kind: "incomplete" }, total: 0 })).toBe("incomplete");
    // 5. Nothing stored by the last count, but the store has some now.
    expect(tileState({ ...base, total: 0, itemsAll: 0 })).toBe("new");
    // 6. Counted: nothing to translate.
    expect(tileState({ ...base, total: 0 })).toBe("nothing");
    expect(tileState({ ...base, total: 0, itemsAll: 0, live: false })).toBe("nothing");
  });
});

describe("a tile's words", () => {
  const de = translator("de");
  const counts = (partial: Partial<StateCounts>) => ({ ...emptyCounts(), ...partial });

  it("names refused types in two kinds: a permission the card unlocks, and none anyone can", () => {
    expect(tileLines(de, { state: "refused", locked: ["SHOP_POLICY"], unavailable: ["PAYMENT_GATEWAY"] })).toEqual([
      { icon: "lock", text: "Kein Zugriff: Rechtstexte" },
      { icon: "disabled", text: "Für Apps nicht verfügbar: Zahlungsarten" },
    ]);
    expect(tileLines(de, { state: "new", locked: [], unavailable: [] })).toEqual([{ text: "Neu seit dem letzten Zählen – zähle den Shop neu" }]);
    expect(tileLines(de, { state: "figure", locked: [], unavailable: [] })).toEqual([]);
  });

  it("reads the figure with every state that has texts, not only the two the tile shows", () => {
    const figure = tally(counts({ complete: 74, draft: 18, outdated: 4, failed: 2, missing: 58 }));
    expect(tileLabel(de, { id: "products", state: "figure", tally: figure, locked: [], unavailable: [], translating: null })).toBe(
      `Produkte: ${percentLabel(de, 74, 156)} übersetzt. 74 fertig, 18 warten auf Freigabe, 4 veraltet, 2 fehlgeschlagen, 58 fehlen noch.`,
    );
  });

  it("reads the area and its lines without a figure, and a running translation in every state", () => {
    expect(tileLabel(de, { id: "checkout", state: "refused", tally: null, locked: ["SHOP_POLICY"], unavailable: ["PAYMENT_GATEWAY"], translating: null })).toBe(
      "Shop & Kasse. Kein Zugriff: Rechtstexte. Für Apps nicht verfügbar: Zahlungsarten.",
    );
    for (const state of ["refused", "recount", "notCounted", "counting", "incomplete", "new", "nothing", "figure"] as const) {
      const label = tileLabel(de, { id: "options", state, tally: state === "figure" || state === "incomplete" ? tally(counts({ missing: 3 })) : null, locked: [], unavailable: [], translating: "translating" });
      expect(label, state).toMatch(/^Größen & Farben.*Wird übersetzt\.$/);
    }
    expect(tileLabel(de, { id: "options", state: "notCounted", tally: null, locked: [], unavailable: [], translating: "translating" })).toBe(
      "Größen & Farben. Noch nicht gezählt. Wird übersetzt.",
    );
    // While the translation still finds its texts, the Jobs page's word for it.
    expect(tileLabel(de, { id: "options", state: "notCounted", tally: null, locked: [], unavailable: [], translating: "finding" })).toBe(
      "Größen & Farben. Noch nicht gezählt. Texte werden gesucht.",
    );
  });
});

describe("the count notice", () => {
  const page: Parameters<typeof countNotice>[0] = {
    language: { locale: "de", name: "German", published: true },
    measured: false,
    scanning: false,
    measurement: { state: "never", done: 0, total: 0 },
    recount: [],
    nothing: false,
  };

  it("offers counting a language not counted yet, and counting again what was unlocked", () => {
    expect(countNotice(page)).toBe("notCounted");
    expect(countNotice({ ...page, measured: true, measurement: { state: "done", done: 5, total: 5 }, recount: ["SHOP_POLICY"] })).toBe("recount");
  });

  it("offers no count in a store with nothing to translate: it would find nothing", () => {
    expect(countNotice({ ...page, nothing: true })).toBeNull();
    expect(countNotice({ ...page, measured: true, measurement: { state: "done", done: 5, total: 5 }, recount: ["SHOP_POLICY"], nothing: true })).toBeNull();
  });
});

describe("More texts", () => {
  const de = translator("de");
  const render = (extras: Parameters<typeof MoreTexts>[0]["extras"]) => renderToStaticMarkup(createElement(MoreTexts, { extras, open: null, i18n: de }));

  it("still opens the parts Linguva may read of a group refused in part, and names the refused part", () => {
    const html = render({
      theme: null,
      notifications: {
        tally: null,
        state: "refused",
        locked: [],
        unavailable: ["PACKING_SLIP_TEMPLATE"],
        parts: [{ type: "EMAIL_TEMPLATE", href: "/app/content/email-templates?lang=de", tally: null }],
      },
      urls: null,
    });
    expect(html).toContain('<details id="notifications"');
    expect(html).toContain('href="/app/content/email-templates?lang=de"');
    expect(html).toContain("Für Apps nicht verfügbar: Lieferschein");
  });

  it("shows a group Linguva may read nothing of as a row without parts to open", () => {
    const html = render({
      theme: { tally: null, state: "refused", locked: ["ONLINE_STORE_THEME_JSON_TEMPLATE"], unavailable: [], parts: [] },
      notifications: null,
      urls: null,
    });
    expect(html).not.toContain("<details");
    expect(html).toContain('<div id="theme">');
    expect(html).toContain("Kein Zugriff: Texte in Vorlagen");
  });
});
