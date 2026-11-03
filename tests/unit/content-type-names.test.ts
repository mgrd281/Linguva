/**
 * A content type in the merchant's words on the tools pages (Coverage's rows and choices, the export's
 * choice): the Content page's names, image descriptions and extra details with their owners, the type's
 * label only where neither exists; types grouped by the language page's areas.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { COVERAGE_TYPES } from "../../app/.server/coverage/coverage";
import { areaName, contentTypeName, typesByArea } from "../../app/lib/content-type-names";
import { CONTENT_TYPES, IMAGE_COVERAGE_TYPES, RESOURCE_KINDS } from "../../app/lib/resource-kinds";

const en = translator("en");
const de = translator("de");

describe("contentTypeName", () => {
  it("uses the Content page's names, not Shopify's", () => {
    expect(contentTypeName(en, "PRODUCT")).toBe("Products");
    expect(contentTypeName(en, "SHOP_POLICY")).toBe("Legal texts");
    expect(contentTypeName(en, "ONLINE_STORE_THEME_JSON_TEMPLATE")).toBe("Texts in templates");
    expect(contentTypeName(de, "METAOBJECT")).toBe("Größentabellen & Co.");
    expect(contentTypeName(de, "ONLINE_STORE_THEME_LOCALE_CONTENT")).toBe("Buttons & feste Texte");
  });

  it("names image descriptions and extra details with the things they belong to", () => {
    expect(contentTypeName(en, "MEDIA_IMAGE")).toBe("Products: image descriptions");
    expect(contentTypeName(en, "ARTICLE_IMAGE")).toBe("Blog posts: image descriptions");
    expect(contentTypeName(en, "PAGE_METAFIELD")).toBe("Pages: extra details");
    expect(contentTypeName(de, "COLLECTION_IMAGE")).toBe("Kollektionen: Bildbeschreibungen");
    expect(contentTypeName(de, "PRODUCT_METAFIELD")).toBe("Produkte: Zusatzinfos");
  });

  it("never shows Shopify's alt text and metafield words, and falls back to the type's label", () => {
    for (const type of COVERAGE_TYPES) {
      for (const i18n of [en, de]) expect(contentTypeName(i18n, type), type).not.toMatch(/alt text|Alt-Text|custom field|benutzerdefiniert|Metafeld/i);
    }
    expect(contentTypeName(en, "SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("typesByArea", () => {
  const exportTypes = [...Object.keys(RESOURCE_KINDS), ...Object.keys(IMAGE_COVERAGE_TYPES), ...Object.keys(CONTENT_TYPES)];

  it("groups the export's types by the language page's areas, in their order, the theme and notifications last", () => {
    const groups = typesByArea(exportTypes);
    expect(groups.map((g) => g.area)).toEqual(["products", "collections", "navigation", "options", "checkout", "metaobjects", "pages", "blog", "images", "theme", "notifications"]);
    expect(groups.find((g) => g.area === "images")?.types).toEqual(["MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE"]);
    expect(groups.find((g) => g.area === "blog")?.types).toEqual(["ARTICLE", "BLOG"]);
    // Every type once.
    expect(groups.flatMap((g) => g.types).sort()).toEqual([...exportTypes].sort());
  });

  it("puts types no area claims last, without a name", () => {
    expect(typesByArea(["PRODUCT", "SOMETHING_NEW"])).toEqual([
      { area: "products", types: ["PRODUCT"] },
      { area: null, types: ["SOMETHING_NEW"] },
    ]);
  });

  it("names the areas as the language page does", () => {
    expect(areaName(en, "navigation")).toBe("Menus & filters");
    expect(areaName(de, "theme")).toBe("Texte deines Themes");
    expect(areaName(de, "notifications")).toBe("E-Mails & Lieferschein");
  });
});
