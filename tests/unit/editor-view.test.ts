/**
 * The translation editor's view logic (app/lib/editor-view.ts): its texts in Review's order with the
 * Google preview after the name and description, only open texts (missing or outdated) for AI and
 * the memory, a text's one state, the item's count without its web address, the area list "back"
 * leads to, and a blog post's storefront path.
 */
import { describe, expect, it } from "vitest";
import { editorArea, googlePreviewIndex, isOpen, openForAi, orderTexts, pickDrafts, storefrontSegment, textCounts, textState } from "../../app/lib/editor-view";

const text = (key: string, translation = "", outdated = false, machine = key !== "handle") => ({ key, translation, outdated, machine });

describe("orderTexts", () => {
  it("puts a product's texts in Review's order: name, description, Google texts, other texts, web address last", () => {
    // Shopify's order for a product.
    const shopify = ["title", "body_html", "handle", "product_type", "meta_title", "meta_description"].map((key) => ({ key }));
    expect(orderTexts(shopify).map((f) => f.key)).toEqual(["title", "body_html", "meta_title", "meta_description", "product_type", "handle"]);
  });

  it("keeps Shopify's order among texts of the same rank (a blog post's description and summary, theme texts)", () => {
    expect(orderTexts([{ key: "summary_html" }, { key: "title" }, { key: "body_html" }]).map((f) => f.key)).toEqual(["title", "summary_html", "body_html"]);
    const theme = ["section.b:1", "section.a:0", "section.c:2"].map((key) => ({ key }));
    expect(orderTexts(theme).map((f) => f.key)).toEqual(["section.b:1", "section.a:0", "section.c:2"]);
  });

  it("returns a new array and leaves the loader's as it was", () => {
    const fields = [{ key: "handle" }, { key: "title" }];
    const ordered = orderTexts(fields);
    expect(ordered).not.toBe(fields);
    expect(fields.map((f) => f.key)).toEqual(["handle", "title"]);
  });
});

describe("googlePreviewIndex", () => {
  it("places the Google preview after the name and description, before the Google texts", () => {
    const ordered = orderTexts(["title", "body_html", "meta_title", "meta_description", "handle"].map((key) => ({ key })));
    expect(googlePreviewIndex(ordered)).toBe(2);
  });

  it("without Google texts: before the other texts and the web address, or at the end", () => {
    expect(googlePreviewIndex(orderTexts([{ key: "title" }, { key: "handle" }]))).toBe(1);
    expect(googlePreviewIndex([{ key: "title" }, { key: "body_html" }])).toBe(2);
    expect(googlePreviewIndex([])).toBe(0);
  });
});

describe("open texts", () => {
  it("are missing or outdated", () => {
    expect(isOpen(text("title"))).toBe(true);
    expect(isOpen(text("title", "Jacke", true))).toBe(true);
    expect(isOpen(text("title", "Jacke"))).toBe(false);
  });

  it("are the only ones AI writes: a translation the merchant has stays, a web address is never sent", () => {
    const fields = [text("title", "Produkt 2 Jacke"), text("body_html", "<p>Alt</p>", true), text("meta_description"), text("handle")];
    expect(openForAi(fields).map((f) => f.key)).toEqual(["body_html", "meta_description"]);
    expect(openForAi([text("title", "Jacke")])).toEqual([]);
  });

  it("count the item's texts without its web address, which is optional", () => {
    expect(textCounts([text("title", "Jacke"), text("body_html", "x", true), text("meta_title"), text("handle")])).toEqual({ open: 2, total: 3 });
    expect(textCounts([text("handle")])).toEqual({ open: 0, total: 0 });
  });
});

describe("textState", () => {
  const ai = (value: string) => ({ from: "ai" as const, value });

  it("names a draft in the field by where it came from, while it differs from what is published", () => {
    expect(textState({ current: "[de] Jacke", translation: "Jacke", outdated: true, draft: ai("[de] Jacke"), published: false })).toBe("draft");
    expect(textState({ current: "Jacke", translation: "", outdated: false, draft: { from: "memory", value: "Jacke" }, published: false })).toBe("memory");
    // Published since: the draft is what customers see now.
    expect(textState({ current: "[de] Jacke", translation: "[de] Jacke", outdated: false, draft: ai("[de] Jacke"), published: true })).toBe("published");
  });

  it("names the merchant's own change, also over a draft, until it is published", () => {
    expect(textState({ current: "Warme Jacke", translation: "Jacke", outdated: false, draft: null, published: false })).toBe("edited");
    expect(textState({ current: "Warme Jacke", translation: "", outdated: false, draft: ai("[de] Jacke"), published: false })).toBe("edited");
    // Typed back to what is published: nothing changed.
    expect(textState({ current: "Jacke", translation: "Jacke", outdated: false, draft: null, published: false })).toBe("translated");
  });

  it("then published now, outdated, translated and not translated", () => {
    expect(textState({ current: "x", translation: "x", outdated: false, draft: null, published: true })).toBe("published");
    expect(textState({ current: "x", translation: "x", outdated: true, draft: null, published: false })).toBe("outdated");
    expect(textState({ current: "x", translation: "x", outdated: false, draft: null, published: false })).toBe("translated");
    expect(textState({ current: "", translation: "", outdated: false, draft: null, published: false })).toBe("missing");
    // An outdated flag without a translation (removed since) is simply missing.
    expect(textState({ current: "", translation: "", outdated: true, draft: null, published: false })).toBe("missing");
  });
});

describe("pickDrafts", () => {
  it("keeps the memory's suggestions and scores for the given texts only", () => {
    const result = { kind: "ai", provider: "memory", drafts: { title: "Jacke", body_html: "<p>Warm</p>" }, scores: { title: 92, body_html: 61 } };
    const picked = pickDrafts(result, new Set(["body_html"]));
    expect(picked.drafts).toEqual({ body_html: "<p>Warm</p>" });
    expect(picked.scores).toEqual({ body_html: 61 });
    expect(picked.provider).toBe("memory");
    // The fetcher's answer stays as it came.
    expect(result.drafts).toEqual({ title: "Jacke", body_html: "<p>Warm</p>" });
    expect(pickDrafts({ drafts: { title: "x" } }, new Set()).drafts).toEqual({});
  });
});

describe("editorArea", () => {
  it("leads back to the area list an item is opened from", () => {
    expect(editorArea("PRODUCT")).toBe("products");
    expect(editorArea("COLLECTION")).toBe("collections");
    expect(editorArea("PAGE")).toBe("pages");
    expect(editorArea("ARTICLE")).toBe("blog");
    expect(editorArea("BLOG")).toBe("blog");
    expect(editorArea("MENU")).toBe("navigation");
    expect(editorArea("SHOP_POLICY")).toBe("checkout");
    expect(editorArea("METAOBJECT")).toBe("metaobjects");
  });

  it("has none for the theme's texts and notifications (their lists are under Content)", () => {
    expect(editorArea("ONLINE_STORE_THEME_LOCALE_CONTENT")).toBeNull();
    expect(editorArea("EMAIL_TEMPLATE")).toBeNull();
    expect(editorArea("UNKNOWN")).toBeNull();
  });
});

describe("storefrontSegment", () => {
  it("puts a blog post under its blog, every other kind under its own path", () => {
    expect(storefrontSegment("ARTICLE", "blog posts")).toBe("blogs/…");
    expect(storefrontSegment("PRODUCT", "products")).toBe("products");
    expect(storefrontSegment("BLOG", "blogs")).toBe("blogs");
  });
});
