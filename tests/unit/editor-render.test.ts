/**
 * The translation editor as the server renders it (React Router's static router, the interface
 * language's provider): the way back to the area list (keeping where that list was opened from), the
 * item's header with what is open, one tile per text, the toolbar's counts (only open texts, those of
 * one AI request) and what they leave, the texts in Review's order with their state first, HTML shown
 * rendered with "Edit HTML", the image descriptions in the same publish, and one "Publish
 * translations"; and the area list's rows that open it. The browser behaviour is in tests/ui
 * (editor-states, preview, structured, unsaved, keyboard, flows).
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AttachedResourcesPanel, type AttachedDrafts } from "../../app/components/AttachedResourcesPanel";
import { CategoryList } from "../../app/components/CategoryList";
import { attachedForAi, ResourceTranslationEditor } from "../../app/components/ResourceTranslationEditor";
import { translator, type AppLocale } from "../../app/i18n/i18n";
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
    // Its featured media's picture, as the area list reads it.
    picture: "https://cdn.example.com/jacket.png",
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

async function render(data: Record<string, unknown>, locale: AppLocale = "en", url = "http://localhost/app/products/2?lang=de"): Promise<string> {
  const handler = createStaticHandler([{ id: "editor", path: "/app/products/:id", loader: () => data, Component: ResourceTranslationEditor }]);
  const context = await handler.query(new Request(url));
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
// A text's section is named by data-text (its heading row is its one heading), the toolbar's by its Polaris heading.
const sections = (markup: string) => tags(markup, "s-section").map((tag) => attr(tag, "data-text") ?? attr(tag, "heading"));

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

  it("shows the item's picture as its area list does, also when no image has a description; else the area's icon", async () => {
    // The only image has no description: nothing to translate in its section, the picture beside the name all the same.
    const noAlt = product({ attached: { available: true, imagesWithoutAlt: 1, unsupported: 0, items: [] } });
    expect(await render(noAlt)).toContain('<div class="lv-ed-header"><span class="lv-ed-picture"><img src="https://cdn.example.com/jacket.png?width=96" alt=""');
    // A collection's image (its image description has no picture of its own); the size joins its query.
    const collection = product({ kind: { type: "COLLECTION", label: "Collections", singular: "collection", path: "/app/collections", plural: "collections" }, picture: "https://cdn.example.com/winter.png?v=2" });
    expect(await render(collection)).toContain('<img src="https://cdn.example.com/winter.png?v=2&amp;width=96" alt=""');
    const none = await render(product({ picture: null }));
    expect(none).not.toContain("<img");
    expect(none).toContain('<div class="lv-ed-header"><span class="lv-icon-square" data-tint="grey" aria-hidden="true" style="width:48px;height:48px;border-radius:14px"><s-icon type="product"');
  });

  it("opened from a list that came from Content, leads back to it and to the language page keeping that; its pages keep it too", async () => {
    const fromContent = "http://localhost/app/products/2?lang=de&from=content";
    const html = await render(product(), "en", fromContent);
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/languages/de/products?from=content">Products in German</s-link>');
    expect(html).toContain('<s-link href="/app/languages/de?from=content">German</s-link>');
    expect(html).toContain('<s-link href="/app/languages/de/products?from=content">Products</s-link>');
    const paged = await render(product({ paging: { total: 120, matching: 120, page: 1, pages: 3, query: "", pageSize: 50 } }), "en", fromContent);
    expect(paged).toMatch(/href="\/app\/products\/2\?lang=de&amp;page=2&amp;from=content"/);
    expect(paged).toContain('<input type="hidden" name="from" value="content"/>');
  });

  it("opened from its type's own list, leads back there: a language not counted yet has no rows in the area list", async () => {
    const html = await render(product(), "en", "http://localhost/app/products/2?lang=de&from=list");
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/products?lang=de">Products</s-link>');
    expect(html).toContain('<s-link href="/app/content?lang=de">Content</s-link>');
    expect(html).toContain('<s-link href="/app/products?lang=de">Products</s-link>');
    expect(html).not.toContain("/app/languages/de/products");
  });

  it("says it in German for a German admin user", async () => {
    const html = await render(product(), "de");
    expect(html).toContain('href="/app/languages/de/products">Produkte auf Deutsch</s-link>');
    expect(html).toContain("Auf Deutsch · 3 von 5 Texten offen");
  });

  it("calls a page's first text its title wherever a text mentions it, a product's its name", async () => {
    const page = product({
      kind: { type: "PAGE", label: "Pages", singular: "page", path: "/app/pages", plural: "pages" },
      title: "About us",
      picture: null,
      attached: { available: true, imagesWithoutAlt: 0, unsupported: 0, items: [] },
      fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "About us", "Über uns"), field("body_html", "HTML", "<p>We make warm clothes.</p>"), field("handle", "URI", "about-us", "ueber-uns")],
    });
    const html = await render(page);
    expect(sections(html)).toEqual(["English → German", "Title", "Description", "On Google", "Web address"]);
    // No Google title of its own: the preview and the web address's suggestion name the same text.
    expect(html).toContain("No Google title: Shopify uses the translated title.");
    expect(html).toMatch(/<span class="lv-btn__label">Suggest from the translated title<\/span>/);
    const german = await render(page, "de");
    expect(german).toContain("Kein Google-Titel: Shopify verwendet den übersetzten Titel.");
    expect(german).toContain("Aus dem übersetzten Titel vorschlagen");

    const named = await render(product({ fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "Product 2 jacket", "Produkt 2 Jacke"), field("handle", "URI", "product-2", "produkt-2")] }));
    expect(named).toContain("No Google title: Shopify uses the translated name.");
    expect(named).toMatch(/<span class="lv-btn__label">Suggest from the translated name<\/span>/);
  });

  it("keeps a region for the AI's and the memory's result, there before the result comes (so it is announced)", async () => {
    const html = await render(product());
    // Out of the way while empty: the toolbar's spacing stays as it is.
    expect(html).toContain('<div role="status" class="lv-sr"></div></s-stack></s-section>');
  });

  it("shows the texts in Review's order, the Google preview before the Google texts, the web address last", async () => {
    const html = await render(product());
    expect(sections(html)).toEqual(["English → German", "Name", "Description", "On Google", "Google title", "Google description", "Web address", "Image descriptions and extra details"]);
    // One heading per text: an accessibilityLabel would make Polaris add a hidden second one with the same name.
    expect(html).not.toMatch(/<s-section[^>]*accessibilityLabel/);
    expect(html.match(/<h2 id="editor-text-title-heading"/g)).toHaveLength(1);
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
    // The figure's leading space keeps "Translate with AI 3" apart in the visible text (axe: label in name).
    expect(html).toMatch(/Translate with AI<span class="lv-ed-count" aria-hidden="true"> 3<\/span>/);
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

  it("says that open texts AI can't write are translated by hand, never that every text is translated", async () => {
    // A metaobject entry: its name is translated, its link is a web address AI never translates.
    const entry = product({
      kind: { type: "METAOBJECT", label: "Metaobjects", singular: "entry", path: "/app/content/metaobjects", plural: "entries" },
      title: "Care guide",
      picture: null,
      seoPreview: false,
      attached: { available: true, imagesWithoutAlt: 0, unsupported: 0, items: [] },
      fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "Care guide", "Pflegehinweise"), { ...field("link", "URL", "https://example.com/care"), machine: false }],
    });
    const html = await render(entry);
    expect(html).toContain("In German · 1 of 2 texts to translate");
    expect(html).toContain("1 text is missing or outdated and can only be translated by hand: it&#x27;s marked “Manual only” below.");
    expect(html).toMatch(/<s-badge icon="edit">Manual only<\/s-badge>/);
    expect(html).not.toContain("every text is translated");
    expect(html).not.toContain("Translate with AI");
  });

  it("counts the image descriptions one AI request drafts (25 items), and says the rest come after publishing", async () => {
    const image = (n: number) => ({
      id: `gid://shopify/MediaImage/${n}`,
      kind: "IMAGE",
      label: "Image",
      detail: null,
      previewUrl: null,
      valueType: null,
      fields: [{ key: "alt", type: "SINGLE_LINE_TEXT_FIELD", source: `Red wool jacket, view ${n}`, digest: DIGEST, translation: "", currentDigest: "none", outdated: false, machine: true }],
    });
    const html = await render(product({ attached: { available: true, imagesWithoutAlt: 0, unsupported: 0, items: Array.from({ length: 27 }, (_, i) => image(i + 1)) } }));
    // The description, the Google description and 25 of the 27 image descriptions.
    expect(html).toContain('aria-label="Translate with AI: 27 open texts"');
    expect(html).toContain("In German · 29 of 31 texts to translate");
    expect(html).toContain(
      "29 texts are missing or outdated: only these get drafts. Texts you&#x27;ve already translated stay as they are. AI translates up to 25 image descriptions and extra details at a time: publish these drafts, then translate the 2 remaining ones with AI.",
    );
  });

  it("shows HTML rendered beside its rendered original, with the code one click away", async () => {
    const html = await render(product());
    expect(tags(html, "iframe").map((tag) => attr(tag, "title"))).toEqual(["Description, English original", "Description, German preview"]);
    // The text goes with the form as shown; no raw text area until "Edit HTML".
    expect(html).toContain('<input type="hidden" name="value:body_html" value="&lt;p&gt;Warme &lt;b&gt;Jacke&lt;/b&gt; Nummer 2.&lt;/p&gt;"/>');
    expect(tags(html, "s-text-area").filter((tag) => attr(tag, "name") === "value:body_html")).toHaveLength(0);
    expect(html).toMatch(/<span class="lv-btn__label">Edit HTML<\/span>/);
  });

  it("says how to fill an empty HTML text, as high as its original, and opens its code from there", async () => {
    const empty = product({ fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "Product 2 jacket", "Produkt 2 Jacke"), field("body_html", "HTML", "<p>Very warm <b>jacket</b> number 2.</p>")] });
    const html = await render(empty);
    // Not a passive "the preview appears here" box under the language's label: a button that says what to do.
    expect(html).toContain('<button type="button" class="lv-ed-empty" style="min-height:96px">Nothing in German yet – translate it with AI above, or write it here.</button>');
    expect(html).not.toContain("The preview appears here once there is a translation.");
    expect(tags(html, "iframe").map((tag) => attr(tag, "title"))).toEqual(["Description, English original"]);
    // The form still sends the (empty) text; "Edit HTML" stays under it (the box's name doesn't repeat it, so each button has its own).
    expect(html).toContain('<input type="hidden" name="value:body_html" value=""/>');
    expect(html).toMatch(/<span class="lv-btn__label">Edit HTML<\/span>/);
    // Without AI (not allowed yet, or no key): only what the merchant can do.
    const manual = await render(product({ ...empty, ai: { ...product().ai, consent: false } }));
    expect(manual).toContain(">Nothing in German yet – write it here.</button>");
    expect(await render(empty, "de")).toContain(">Noch nichts auf Deutsch – übersetze es oben mit KI oder schreib es hier.</button>");
  });

  it("labels the translation as its original: the language above both, the field's own label for screen readers only", async () => {
    const html = await render(product());
    expect(html).toContain('<s-text color="subdued">English (original)</s-text><s-box padding="small-300 small" background="subdued" borderRadius="base"><s-paragraph>Product 2 jacket</s-paragraph></s-box>');
    expect(html).toContain('<s-text color="subdued">German</s-text><div lang="de"><s-text-field name="value:title" label="German" labelAccessibilityVisibility="exclusive" value="Produkt 2 Jacke"></s-text-field></div>');
    // The web address too, with what it does under the field.
    expect(html).toMatch(/<s-text-field name="value:handle" label="German" labelAccessibilityVisibility="exclusive" value="produkt-2" details="Optional\. A new web address/);
    // A long text keeps the box's own padding beside its text area.
    const long = await render(product({ fields: [field("title", "SINGLE_LINE_TEXT_FIELD", "A".repeat(130), "B".repeat(130))] }));
    expect(long).toContain('<s-box padding="base" background="subdued" borderRadius="base"><s-paragraph>');
    expect(long).toMatch(/<s-text-area name="value:title" label="German" labelAccessibilityVisibility="exclusive"/);
  });

  it("calls a web address nobody wrote yet optional, never “Not translated” beside the texts the count includes", async () => {
    const written = [field("title", "SINGLE_LINE_TEXT_FIELD", "Product 2 jacket", "Produkt 2 Jacke"), field("body_html", "HTML", "<p>Warm.</p>", "<p>Warm.</p>")];
    const none = { available: true, imagesWithoutAlt: 0, unsupported: 0, items: [] };
    const html = await render(product({ fields: [...written, field("handle", "URI", "product-2")], attached: none }));
    expect(html).toContain("In German · all 2 texts are translated");
    expect(html).toContain("Nothing is missing or outdated: every text is translated.");
    expect(html).toContain('<s-badge icon="minus-circle">Optional</s-badge><s-badge icon="edit">Manual only</s-badge>');
    expect(html).not.toContain("Not translated");
    const tiles = [...html.matchAll(/class="lv-tile lv-ed-tile" data-state="([^"]+)"/g)].map((m) => m[1]);
    expect(tiles).toEqual(["translated", "translated", "optional"]);
    expect(html).toContain('<span class="lv-sr">Web address: Optional</span>');
    expect(await render(product({ fields: [...written, field("handle", "URI", "product-2")], attached: none }), "de")).toContain('<s-badge icon="minus-circle">Freiwillig</s-badge>');
    // Written, it has a text's own state.
    const translated = await render(product({ fields: [...written, field("handle", "URI", "product-2", "produkt-2")], attached: none }));
    expect([...translated.matchAll(/class="lv-tile lv-ed-tile" data-state="([^"]+)"/g)].map((m) => m[1])).toEqual(["translated", "translated", "translated"]);
    expect(translated).not.toContain("Optional</s-badge>");
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

describe("the image descriptions' section", () => {
  const IMAGE = "gid://shopify/MediaImage/1:alt";
  const panel = (ai: AttachedDrafts | null, aiError: { code: string } | null = null) =>
    renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>,
        createElement(AttachedResourcesPanel, {
          id: "editor-attached",
          data: product() as never,
          errorMessage: (code: string) => `Error ${code}.`,
          ai,
          aiError,
          saved: null,
          // A plain form: the editor's fetcher posts it.
          save: { Form: "form" } as never,
          formRef: { current: null },
          resetCount: 0,
          value: (ref: string) => ai?.drafts[ref] ?? "",
          onValue: () => {},
        }),
      ),
    );
  const stopped: AttachedDrafts = { drafts: {}, rejected: {}, warnings: {}, provider: "mock", stopped: "QUOTA_EXCEEDED" };

  it("says a stop beside the drafts it left; one before any draft is said at the top, by the button that started it", () => {
    expect(panel(stopped)).not.toContain("<s-banner");
    const partial = panel({ ...stopped, drafts: { [IMAGE]: "[de] Rote Wolljacke" } });
    expect(partial).toContain('<s-banner tone="critical" heading="AI translation failed"><s-paragraph>Error QUOTA_EXCEEDED. The drafts created before the problem are filled in below.</s-paragraph></s-banner>');
  });

  it("says the request's own error the top doesn't say", () => {
    expect(panel(null, { code: "PROVIDER_RETRYABLE" })).toContain('<s-paragraph>Error PROVIDER_RETRYABLE.</s-paragraph>');
  });
});

describe("attachedForAi", () => {
  const item = (...texts: Array<{ translation?: string; machine?: boolean }>) => ({
    fields: texts.map((text, i) => ({ key: `k${i}`, translation: text.translation ?? "", outdated: false, machine: text.machine ?? true })),
  });
  const done = item({ translation: "Rote Wolljacke" });

  it("takes the open texts of the first 25 items with any, as one AI request does; the others wait for the next", () => {
    expect(attachedForAi([done, ...Array.from({ length: 26 }, () => item({})), done])).toEqual({ now: 25, later: 1 });
    // An item with nothing AI can write takes no place.
    expect(attachedForAi([item({ machine: false }), item({}, {}), done])).toEqual({ now: 2, later: 0 });
    expect(attachedForAi([])).toEqual({ now: 0, later: 0 });
  });
});

describe("the area list's rows", () => {
  const list = {
    category: { id: "products", searchable: false, review: null },
    language: { locale: "de" },
    filter: { state: "all", q: "" },
    counts: { all: 1, failed: 0, outdated: 0, missing: 1, waiting: 0, complete: 0 },
    rows: [
      {
        id: "item-8",
        type: "PRODUCT",
        reference: "8",
        state: "missing",
        texts: [{ group: "title", state: "missing" }],
        failureCode: null,
        href: "/app/products/8?lang=de",
        smart: null,
        title: "Product 8 jacket",
        translated: null,
        label: null,
        image: null,
      },
    ],
    page: { from: 1, to: 1, total: 1, number: 1, nextCursor: null },
    titlesUnavailable: false,
    smart: null,
  };
  const rowLink = (origin: "content" | null) => {
    const markup = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: "/app/languages/de/products" },
        createElement(CategoryList, { data: list as never, i18n: translator("en"), names: { language: "German", locale: "de", primary: "English" }, origin }),
      ),
    );
    return attr(tags(markup, "a").find((tag) => tag.includes('class="lv-row__link"'))!, "href");
  };

  it("open the editor saying where the list was opened from, so its way back keeps it", () => {
    expect(rowLink("content")).toBe("/app/products/8?lang=de&amp;from=content");
    expect(rowLink(null)).toBe("/app/products/8?lang=de");
  });
});
