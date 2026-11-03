/**
 * The tools pages' header: each tool's sign is the icon and tint of its tile in Settings › Tools, and the
 * header draws the trail back to Settings › Tools, the sign and the page's one h1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
