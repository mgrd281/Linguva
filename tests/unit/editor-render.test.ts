/**
 * The translation editor as the server renders it (React Router's static router, the interface
 * language's provider): the way back to the area list, the item's header with what is open, one tile
 * per text, the toolbar's counts (only open texts), the texts in Review's order with their state
 * first, HTML shown rendered with "Edit HTML", the image descriptions in the same publish, and one
 * "Publish translations". The browser behaviour is in tests/ui (editor-states, preview, structured,
 * unsaved, keyboard, flows).
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ResourceTranslationEditor } from "../../app/components/ResourceTranslationEditor";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

const DIGEST = "a".repeat(64);

function field(key: string, type: string, source: string, translation = "", outdated = false) {
  return {
    key,
    label: key,
    type,
    source,
    digest: DIGEST,
    translation,
    currentDigest: translation ? DIGEST : "none",
    outdated,
    machine: key !== "handle",
    history: [] as Array<{ id: string; value: string; origin: string; approved: boolean; createdAt: string; restorable: boolean; removed: boolean }>,
    sourcePreview: type === "HTML" ? source : null,
  };
}

/** A product as loadEditorData returns it: German name translated, description outdated, Google description missing; Shopify's order. */
function product(overrides: Record<string, unknown> = {}) {
  return {
    attached: {
      available: true,
      imagesWithoutAlt: 0,
      unsupported: 0,
      items: [
        {
          id: "gid://shopify/MediaImage/1",
          kind: "IMAGE",
          label: "Image",
          detail: null,
          previewUrl: "https://cdn.example.com/jacket.png",
          valueType: null,
          fields: [{ key: "alt", type: "SINGLE_LINE_TEXT_FIELD", source: "Red wool jacket", digest: DIGEST, translation: "", currentDigest: "none", outdated: false, machine: true }],
        },
      ],
    },
    kind: { type: "PRODUCT", label: "Products", singular: "product", path: "/app/products", plural: "products" },
    shopDomain: "ui-full.myshopify.com",
    title: "Product 2 jacket",
    target: { locale: "de", name: "German", rtl: false },
    sourceName: "English",
    sourceLocale: "en",
    fields: [
      field("title", "SINGLE_LINE_TEXT_FIELD", "Product 2 jacket", "Produkt 2 Jacke"),
      field("body_html", "HTML", "<p>Very warm <b>jacket</b> number 2.</p>", "<p>Warme <b>Jacke</b> Nummer 2.</p>", true),
      field("handle", "URI", "product-2", "produkt-2"),
      field("meta_title", "SINGLE_LINE_TEXT_FIELD", "Warm winter jacket", "Warme Winterjacke"),
      field("meta_description", "SINGLE_LINE_TEXT_FIELD", "A warm jacket for long winter walks."),
    ],
    paging: null,
    caution: null,
    seoPreview: true,
    smart: null,
    ai: { available: true, consent: true, consentTokens: ["deepl"], used: 1000, limit: 1_000_000, usedToday: 0, dailyLimit: 1_000_000, ownKey: null },
    ...overrides,
  };
}

async function render(data: Record<string, unknown>, locale: AppLocale = "en"): Promise<string> {
  const handler = createStaticHandler([{ id: "editor", path: "/app/products/:id", loader: () => data, Component: ResourceTranslationEditor }]);
  const context = await handler.query(new Request("http://localhost/app/products/2?lang=de"));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale, timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

/** The opening tags of one element, in document order. */
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
/** The text inside the first element with this attribute value. */
const sections = (markup: string) => tags(markup, "s-section").map((tag) => attr(tag, "accessibilityLabel") ?? attr(tag, "heading"));

describe("the editor's page", () => {
  it("leads back to the area list it is opened from, and names the item with what is open", async () => {
    const html = await render(product());
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/languages/de/products">Products in German</s-link>');
    expect(html).toContain('<h1 class="lv-h1 lv-ed-header__name">Product 2 jacket</h1>');
    // Name, description, Google title and description, the image's description: the web address doesn't count.
    expect(html).toContain("In German · 3 of 5 texts to translate");
    // The product's picture beside its name.
    expect(html).toContain('<img src="https://cdn.example.com/jacket.png?width=96" alt=""');
  });

  it("says it in German for a German admin user", async () => {
    const html = await render(product(), "de");
    expect(html).toContain('href="/app/languages/de/products">Produkte auf Deutsch</s-link>');
    expect(html).toContain("Auf Deutsch · 3 von 5 Texten offen");
  });

  it("shows the texts in Review's order, the Google preview before the Google texts, the web address last", async () => {
    const html = await render(product());
    expect(sections(html)).toEqual(["English → German", "Name", "Description", "On Google", "Google title", "Google description", "Web address", "Image descriptions and extra details"]);
  });

  it("starts every text with its state, and draws one tile per text in the same order", async () => {
    const html = await render(product());
    const badges = tags(html, "s-badge");
    expect(badges.slice(0, 3).map((tag) => attr(tag, "icon"))).toEqual(["check-circle-filled", "refresh", "check-circle-filled"]);
    expect(html).toMatch(/<s-badge icon="refresh" tone="caution">Outdated<\/s-badge>/);
    expect(html).toMatch(/<s-badge icon="circle-dashed">Not translated<\/s-badge>/);
    expect(html).toMatch(/<s-badge icon="edit">Manual only<\/s-badge>/);
    const tiles = [...html.matchAll(/<a href="#([^"]+)" class="lv-tile lv-ed-tile" data-state="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(tiles).toEqual([
      ["editor-text-title", "translated"],
      ["editor-text-body_html", "outdated"],
      ["editor-text-meta_title", "translated"],
      ["editor-text-meta_description", "missing"],
      ["editor-text-handle", "translated"],
      ["editor-attached", "open"],
    ]);
    expect(html).toContain('<span class="lv-sr">Description: Outdated</span>');
    // Each tile jumps to its text's heading row.
    expect(html).toContain('<div id="editor-text-body_html" class="lv-ed-head-row">');
  });

  it("works on the open texts only: their count in the buttons and in words", async () => {
    const html = await render(product());
    // Description (outdated), Google description (missing) and the image's description.
    expect(html).toContain('aria-label="Translate with AI: 3 open texts"');
    expect(html).toMatch(/Translate with AI<span class="lv-ed-count" aria-hidden="true">3<\/span>/);
    expect(html).toContain('aria-label="Translate Google texts only: 1 open text"');
    // The memory fills the item's own open texts.
    expect(html).toContain('aria-label="Fill from memory: 2 open texts"');
    expect(html).toContain("3 texts are missing or outdated: only these get drafts.");
    expect(html).not.toContain("Translate everything again");
  });

  it("offers to translate everything again, asking first, when nothing is open", async () => {
    const done = product({
      fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "Product 2 jacket", "Produkt 2 Jacke"), field("handle", "URI", "product-2")],
      attached: { available: true, imagesWithoutAlt: 0, unsupported: 0, items: [] },
    });
    const html = await render(done);
    expect(html).toContain("Nothing is missing or outdated: every text is translated.");
    expect(html).toMatch(/<button type="button" id="editor-again" class="lv-btn lv-btn--tertiary"[^>]*>/);
    expect(html).not.toContain("Translate with AI");
    expect(html).toContain("In German · its text is translated");
  });

  it("shows HTML rendered beside its rendered original, with the code one click away", async () => {
    const html = await render(product());
    expect(tags(html, "iframe").map((tag) => attr(tag, "title"))).toEqual(["Description, English original", "Description, German preview"]);
    // The text goes with the form as shown; no raw text area until "Edit HTML".
    expect(html).toContain('<input type="hidden" name="value:body_html" value="&lt;p&gt;Warme &lt;b&gt;Jacke&lt;/b&gt; Nummer 2.&lt;/p&gt;"/>');
    expect(tags(html, "s-text-area").filter((tag) => attr(tag, "name") === "value:body_html")).toHaveLength(0);
    expect(html).toMatch(/<span class="lv-btn__label">Edit HTML<\/span>/);
  });

  it("publishes everything with one button and the admin's save bar; removing is a quiet icon", async () => {
    const html = await render(product());
    expect(html.match(/<span class="lv-btn__label">Publish translations<\/span>/g)).toHaveLength(1);
    expect(html).toContain('<ui-save-bar id="linguva-editor-save-bar">');
    expect(html).not.toContain("Publish alt text and fields");
    expect(html).not.toContain("Translate missing alt text and fields with AI");
    expect(html).toContain('aria-label="Remove translation: Name"');
    // The image description: its state first, its own form.
    expect(html).toContain('<input type="hidden" name="intent" value="save-attached"/>');
    expect(html).toContain("<strong class=\"lv-strong\">Image description</strong>");
  });

  it("names a blog post's example address under its blog", async () => {
    const html = await render(product({ kind: { type: "ARTICLE", label: "Blog posts", singular: "blog post", path: "/app/articles", plural: "blog posts" } }));
    expect(html).toContain("ui-full.myshopify.com/de/blogs/…/produkt-2");
    expect(html).toContain('href="/app/languages/de/blog">Blog in German</s-link>');
  });

  it("leads theme texts back to their list under Content, without tiles while texts are paged", async () => {
    const theme = product({
      kind: { type: "ONLINE_STORE_THEME_LOCALE_CONTENT", label: "Theme language files", singular: "language file", path: "/app/content/theme-locale", plural: "language files" },
      seoPreview: false,
      attached: { available: true, imagesWithoutAlt: 0, unsupported: 0, items: [] },
      fields: [field("general.cart:0", "STRING", "Cart")],
      paging: { total: 120, matching: 120, page: 1, pages: 3, query: "", pageSize: 50 },
    });
    const html = await render(theme);
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/content/theme-locale?lang=de">Buttons &amp; fixed texts</s-link>');
    expect(html).toContain("In German · 120 texts");
    expect(html).not.toContain("lv-ed-tiles");
    expect(sections(html)).toContain("120 texts");
  });
});
