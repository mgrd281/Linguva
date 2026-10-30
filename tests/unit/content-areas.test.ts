/**
 * The Content page's map of the store (app/lib/content-areas.ts): every type
 * in exactly one place, in the language page's areas, with icons Polaris
 * draws; what a tile says in each state, and what a screen reader hears.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HubStatus } from "../../app/.server/translation/content-hub";
import { requestableScopes } from "../../app/.server/translation/content-hub";
import { percentLabel } from "../../app/components/Coverage";
import { MoreTexts, tileLabel, tileLines } from "../../app/components/ContentTiles";
import { translator } from "../../app/i18n/i18n";
import { ATTACHED, GROUP_PARTS, HUB_TYPES, PART_ICON, placeOf, TILE_AREAS, tileState, type TileStateInput } from "../../app/lib/content-areas";
import { emptyCounts, type StateCounts } from "../../app/lib/coverage-rules";
import { tally } from "../../app/lib/coverage-view";
import { CATEGORIES, categoryOf, EXTRAS, TIERS } from "../../app/lib/language-categories";
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
      ...TILE_AREAS.map((id) => CATEGORIES[id].icon),
      ...Object.values(EXTRAS).map((extra) => extra.icon),
      // The page's own: lock, unlock, refused, running, counting, hidden, notes and chevrons.
      ...["lock", "unlock", "disabled", "in-progress", "chart-donut", "hide", "image", "metafields", "chevron-right", "chevron-down", "chevron-up", "language"],
    ];
    expect(used.filter((icon) => !icons.has(icon))).toEqual([]);
    // Every literal icon in the page's components too.
    const sources = ["app/components/ContentTiles.tsx", "app/routes/app.content._index.tsx"].map((path) => readFileSync(join(__dirname, "..", "..", path), "utf8")).join("\n");
    const literals = [...sources.matchAll(/(?:type|icon)="([a-z0-9-]+)"/g)].map((m) => m[1]!).filter((name) => !["submit", "hidden", "strong", "button"].includes(name));
    expect(literals.length).toBeGreaterThan(5);
    expect(literals.filter((icon) => !icons.has(icon))).toEqual([]);
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
    expect(tileLabel(de, { id: "products", state: "figure", tally: figure, locked: [], unavailable: [], translating: false })).toBe(
      `Produkte: ${percentLabel(de, 74, 156)} übersetzt. 74 fertig, 18 warten auf Freigabe, 4 veraltet, 2 fehlgeschlagen, 58 fehlen noch.`,
    );
  });

  it("reads the area and its lines without a figure, and a running translation in every state", () => {
    expect(tileLabel(de, { id: "checkout", state: "refused", tally: null, locked: ["SHOP_POLICY"], unavailable: ["PAYMENT_GATEWAY"], translating: false })).toBe(
      "Shop & Kasse. Kein Zugriff: Rechtstexte. Für Apps nicht verfügbar: Zahlungsarten.",
    );
    for (const state of ["refused", "recount", "notCounted", "counting", "incomplete", "new", "nothing", "figure"] as const) {
      const label = tileLabel(de, { id: "options", state, tally: state === "figure" || state === "incomplete" ? tally(counts({ missing: 3 })) : null, locked: [], unavailable: [], translating: true });
      expect(label, state).toMatch(/^Größen & Farben.*Wird gerade übersetzt\.$/);
    }
    expect(tileLabel(de, { id: "options", state: "notCounted", tally: null, locked: [], unavailable: [], translating: true })).toBe(
      "Größen & Farben. Noch nicht gezählt. Wird gerade übersetzt.",
    );
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
