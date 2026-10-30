/**
 * Review's areas and order (app/lib/review-areas.ts, app/lib/review-order.ts):
 * each text in the area of its own content (as the language pages count
 * it) for every kind of draft, the old `type` parameter, card titles from
 * stored titles, and the reading order inside a card.
 */
import { describe, expect, it } from "vitest";
import { AREA_KEYS, areaOf, areaTypes, cardTypeOf, customFieldName, isAreaKey, LEGACY_TYPE_AREA, ownType, ownerTitle } from "../../app/lib/review-areas";
import { cardGidOf, fieldRank, gidPart, idLength, typeRank } from "../../app/lib/review-order";
import { CATEGORY_IDS, categoryOf } from "../../app/lib/language-categories";

const draft = (resourceGid: string, parentGid: string | null = null) => ({ resourceGid, parentGid });

describe("ownType", () => {
  it("names products, collections, pages, posts and blogs by their GID", () => {
    expect(ownType(draft("gid://shopify/Product/1"), "PRODUCT", null)).toBe("PRODUCT");
    expect(ownType(draft("gid://shopify/Collection/1"), null, null)).toBe("COLLECTION");
    expect(ownType(draft("gid://shopify/Page/1"), null, null)).toBe("PAGE");
    expect(ownType(draft("gid://shopify/Article/1"), "ARTICLE", null)).toBe("ARTICLE");
    expect(ownType(draft("gid://shopify/Blog/1"), "BLOG", null)).toBe("BLOG");
  });

  it("names a bulk job's images and custom fields by their owner's kind", () => {
    expect(ownType(draft("gid://shopify/MediaImage/9", "gid://shopify/Product/1"), "PRODUCT", null)).toBe("MEDIA_IMAGE");
    expect(ownType(draft("gid://shopify/CollectionImage/9", "gid://shopify/Collection/1"), "COLLECTION", null)).toBe("COLLECTION_IMAGE");
    expect(ownType(draft("gid://shopify/ArticleImage/9", "gid://shopify/Article/1"), "ARTICLE", null)).toBe("ARTICLE_IMAGE");
    for (const [owner, type] of [
      ["Product", "PRODUCT_METAFIELD"],
      ["Collection", "COLLECTION_METAFIELD"],
      ["Page", "PAGE_METAFIELD"],
      ["Article", "ARTICLE_METAFIELD"],
    ] as const) {
      expect(ownType(draft("gid://shopify/Metafield/7", `gid://shopify/${owner}/1`), owner.toUpperCase(), null)).toBe(type);
    }
    // A page has no images of its own kind: nothing to name.
    expect(ownType(draft("gid://shopify/PageImage/9", "gid://shopify/Page/1"), "PAGE", null)).toBeNull();
    expect(ownType(draft("gid://shopify/Metafield/7", "gid://shopify/Menu/1"), null, null)).toBeNull();
  });

  it("names a product image without its owner by its GID", () => {
    expect(ownType(draft("gid://shopify/MediaImage/9"), null, null)).toBe("MEDIA_IMAGE");
  });

  it("names a smart check of an image or custom field by its job's type, an import by what coverage stored", () => {
    expect(ownType(draft("gid://shopify/CollectionImage/9"), "COLLECTION_IMAGE", "COLLECTION_IMAGE")).toBe("COLLECTION_IMAGE");
    expect(ownType(draft("gid://shopify/Metafield/7"), "PRODUCT_METAFIELD", null)).toBe("PRODUCT_METAFIELD");
    expect(ownType(draft("gid://shopify/Metafield/7"), null, "COLLECTION_METAFIELD")).toBe("COLLECTION_METAFIELD");
    expect(ownType(draft("gid://shopify/Menu/1"), "MENU", null)).toBe("MENU");
    expect(ownType(draft("gid://shopify/Menu/1"), null, null)).toBeNull();
  });
});

describe("areaOf", () => {
  it("puts web addresses of every type together", () => {
    expect(areaOf("handle", "PRODUCT")).toBe("urls");
    expect(areaOf("handle", "PAGE")).toBe("urls");
    expect(areaOf("handle", null)).toBe("urls");
  });

  it("gives every coverage type the language page's category", () => {
    for (const id of CATEGORY_IDS) {
      for (const type of areaTypes(id)) expect(areaOf("title", type), type).toBe(id);
    }
    expect(areaOf("value", "PRODUCT_METAFIELD")).toBe("customFields");
    expect(areaOf("alt", "MEDIA_IMAGE")).toBe("images");
    expect(areaOf("title", "ARTICLE")).toBe("blog");
    expect(areaOf("body", "SHOP_POLICY")).toBe("checkout");
  });

  it("keeps theme and notification texts apart and anything unknown as other", () => {
    expect(areaOf("section.hero.heading", "ONLINE_STORE_THEME")).toBe("theme");
    expect(areaOf("body", "EMAIL_TEMPLATE")).toBe("notifications");
    expect(areaOf("title", "SOMETHING_NEW")).toBe("other");
    expect(areaOf("title", null)).toBe("other");
  });

  it("agrees with categoryOf for every type an area counts", () => {
    for (const area of AREA_KEYS) {
      for (const type of areaTypes(area)) expect(categoryOf(type)).toBe(area);
    }
    expect(areaTypes("urls")).toEqual([]);
    expect(areaTypes("other")).toEqual([]);
  });

  it("knows its keys and maps the old type parameter", () => {
    expect(isAreaKey("images")).toBe(true);
    expect(isAreaKey("PRODUCT")).toBe(false);
    expect(LEGACY_TYPE_AREA).toEqual({ PRODUCT: "products", COLLECTION: "collections", PAGE: "pages", ARTICLE: "blog", BLOG: "blog" });
  });
});

describe("cards", () => {
  it("shows an image or custom field in its owner's card", () => {
    expect(cardGidOf("gid://shopify/MediaImage/9", "gid://shopify/Product/1")).toBe("gid://shopify/Product/1");
    expect(cardGidOf("gid://shopify/Menu/1", null)).toBe("gid://shopify/Menu/1");
  });

  it("types a card by its owner, else by its own texts", () => {
    expect(cardTypeOf("gid://shopify/Product/1", [{ resourceGid: "gid://shopify/MediaImage/9", ownType: "MEDIA_IMAGE" }])).toBe("PRODUCT");
    expect(cardTypeOf("gid://shopify/Menu/1", [{ resourceGid: "gid://shopify/Menu/1", ownType: "MENU" }])).toBe("MENU");
    expect(cardTypeOf("gid://shopify/MediaImage/9", [{ resourceGid: "gid://shopify/MediaImage/9", ownType: null }])).toBeNull();
  });

  it("titles a card from its own text, else from an image's or custom field's stored owner title", () => {
    const P = "gid://shopify/Product/1";
    expect(ownerTitle(P, [{ resourceGid: P, parentGid: null, title: " Rain jacket " }])).toBe("Rain jacket");
    expect(ownerTitle(P, [{ resourceGid: "gid://shopify/MediaImage/9", parentGid: P, title: "Rain jacket · Image" }])).toBe("Rain jacket");
    expect(ownerTitle(P, [{ resourceGid: "gid://shopify/Metafield/7", parentGid: P, title: "Rain jacket · Care · Wash (custom field)" }])).toBe("Rain jacket · Care");
    expect(ownerTitle(P, [{ resourceGid: "gid://shopify/Metafield/7", parentGid: P, title: "Material (custom field)" }])).toBeNull();
    expect(ownerTitle(P, [{ resourceGid: "gid://shopify/MediaImage/9", parentGid: null, title: "Rain jacket · Image" }])).toBeNull();
    expect(ownerTitle(P, [])).toBeNull();
  });

  it("reads a custom field's name from its stored title", () => {
    expect(customFieldName("Rain jacket · Material (custom field)")).toBe("Material");
    expect(customFieldName("Material (custom field)")).toBe("Material");
    expect(customFieldName("Rain jacket · Image")).toBeNull();
    expect(customFieldName(null)).toBeNull();
  });
});

describe("order", () => {
  it("reads GID parts as SQL split_part does", () => {
    expect(gidPart("gid://shopify/Product/12", 4)).toBe("Product");
    expect(gidPart("gid://shopify/Product/12", 5)).toBe("12");
    expect(gidPart("gid://shopify/Product", 5)).toBe("");
  });

  it("puts products before collections, pages, posts, blogs and anything else", () => {
    const kinds = ["Blog", "Menu", "Product", "Article", "Page", "Collection"].map((k) => `gid://shopify/${k}/1`);
    expect([...kinds].sort((a, b) => typeRank(a) - typeRank(b)).map((g) => gidPart(g, 4))).toEqual(["Product", "Collection", "Page", "Article", "Blog", "Menu"]);
  });

  it("orders numbers naturally through their length (2 before 10)", () => {
    expect(idLength("gid://shopify/Product/2")).toBeLessThan(idLength("gid://shopify/Product/10"));
    expect(idLength("gid://shopify/OnlineStoreTheme/ä1")).toBe(2);
  });

  it("reads a card's texts in the merchant's order", () => {
    const keys = ["handle", "meta_description", "title", "custom", "body_html", "meta_title"];
    expect([...keys].sort((a, b) => fieldRank(a, false) - fieldRank(b, false))).toEqual(["title", "body_html", "meta_title", "meta_description", "custom", "handle"]);
    expect(fieldRank("name", false)).toBe(10);
    expect(fieldRank("summary_html", false)).toBe(20);
    expect(fieldRank("alt", true)).toBe(50);
    expect(fieldRank("value", true)).toBe(60);
    // An owner's texts come before its images' and custom fields'.
    expect(fieldRank("meta_description", false)).toBeLessThan(fieldRank("alt", true));
    expect(fieldRank("alt", true)).toBeLessThan(fieldRank("value", true));
    expect(fieldRank("value", true)).toBeLessThan(fieldRank("handle", false));
  });
});
