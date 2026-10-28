import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestableScopes } from "../../app/.server/translation/content-hub";
import {
  CONTENT_TYPES,
  contentGid,
  contentRef,
  contentTypeBySlug,
  editorPathFor,
  isContentType,
  kindMeta,
  providerContext,
  resourceTitle,
} from "../../app/lib/resource-kinds";
import { SUPPORTED_BULK_RESOURCE_TYPES } from "../../app/.server/jobs/bulk-jobs";

/** The enum values from the generated Admin API types (2026-10). */
function shopifyResourceTypes(): string[] {
  const types = readFileSync(join(__dirname, "..", "..", "app", "types", "admin.types.d.ts"), "utf8");
  const body = /enum TranslatableResourceType \{([\s\S]*?)\n\}/.exec(types)![1]!;
  return [...body.matchAll(/= '([A-Z_]+)'/g)].map((m) => m[1]!);
}

describe("content types", () => {
  it("cover every non-deprecated Shopify translatable resource type", () => {
    const covered = new Set<string>([
      "PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG",
      // Edited with their owner (product, collection, blog post).
      "MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE",
      ...Object.keys(CONTENT_TYPES),
    ]);
    const all = shopifyResourceTypes().filter((t) => t !== "METAFIELD"); // deprecated; metafields via owners
    expect(all.length).toBeGreaterThan(25);
    expect(all.filter((t) => !covered.has(t))).toEqual([]);
  });

  it("have unique slugs and resolve by slug", () => {
    const slugs = Object.values(CONTENT_TYPES).map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(contentTypeBySlug("menus")).toBe("MENU");
    expect(contentTypeBySlug("theme")).toBe("ONLINE_STORE_THEME");
    expect(contentTypeBySlug("products")).toBeNull();
    expect(contentTypeBySlug("__proto__")).toBeNull();
    expect(isContentType("constructor")).toBe(false);
  });

  it("only offer bulk translation where it is safe", () => {
    for (const [type, meta] of Object.entries(CONTENT_TYPES)) {
      expect((SUPPORTED_BULK_RESOURCE_TYPES as readonly string[]).includes(type), type).toBe(meta.bulk);
    }
    // Legal texts, Liquid templates and theme content: one by one, with review.
    expect(CONTENT_TYPES.SHOP_POLICY.bulk).toBe(false);
    expect(CONTENT_TYPES.EMAIL_TEMPLATE.bulk).toBe(false);
    expect(CONTENT_TYPES.ONLINE_STORE_THEME.bulk).toBe(false);
  });

  it("request only optional scopes that shopify.app.toml declares", () => {
    const toml = readFileSync(join(__dirname, "..", "..", "shopify.app.toml"), "utf8");
    const optional = JSON.parse(/^optional_scopes = (.*)$/m.exec(toml)![1]!) as string[];
    for (const scope of requestableScopes()) expect(optional).toContain(scope);
  });
});

describe("content references", () => {
  it("round-trip numeric and theme GIDs", () => {
    for (const gid of [
      "gid://shopify/Menu/123",
      "gid://shopify/OnlineStoreThemeJsonTemplate/product?theme_id=42",
      "gid://shopify/OnlineStoreThemeLocaleContent/en.default.json?theme_id=42",
    ]) {
      const ref = contentRef(gid);
      expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(contentGid(ref)).toBe(gid);
    }
  });

  it("reject anything that isn't a well-formed Shopify GID", () => {
    const enc = (text: string) => contentRef(text);
    expect(contentGid(enc("https://evil.example/x"))).toBeNull();
    expect(contentGid(enc("gid://shopify/Menu/../../Shop/1"))).toBeNull();
    expect(contentGid(enc("gid://shopify/Menu/1 OR 1=1"))).toBeNull();
    expect(contentGid(enc("gid://shopify/Menu/1\nX"))).toBeNull();
    expect(contentGid(enc("gid://other/Menu/1"))).toBeNull();
    expect(contentGid("not base64 !")).toBeNull();
    expect(contentGid("")).toBeNull();
    expect(contentGid("a".repeat(500))).toBeNull();
  });

  it("build editor links per type", () => {
    expect(editorPathFor("gid://shopify/Menu/7", "de", "MENU")).toBe(`/app/content/menus/${contentRef("gid://shopify/Menu/7")}?lang=de`);
    expect(editorPathFor("gid://shopify/Product/7", "de", "PRODUCT")).toBe("/app/products/7?lang=de");
    expect(editorPathFor("gid://shopify/Product/7", "de")).toBe("/app/products/7?lang=de");
    expect(kindMeta("SHOP_POLICY").path).toBe("/app/content/policies");
  });
});

describe("titles and AI context", () => {
  it("find a readable title for resources without a title field", () => {
    expect(resourceTitle("MENU", [{ key: "title", value: "Main menu" }])).toBe("Main menu");
    expect(resourceTitle("PAYMENT_GATEWAY", [{ key: "name", value: "Bank transfer" }])).toBe("Bank transfer");
    expect(resourceTitle("FILTER", [{ key: "label", value: "Colour" }])).toBe("Colour");
    expect(resourceTitle("SHOP", [{ key: "meta_title", value: "Wool & Co" }])).toBe("Wool & Co");
    expect(resourceTitle("ONLINE_STORE_THEME", [{ key: "section.x.html", value: "<p>Hi</p>" }, { key: "y", value: "Free shipping" }])).toBe("Free shipping");
    expect(resourceTitle("SHOP_POLICY", [{ key: "body", value: "<p>Long legal text</p>" }])).toBe("Policy (1 text)");
  });

  it("tell the translation provider what the text is", () => {
    expect(providerContext("gid://shopify/Menu/1", "Main menu", "MENU")).toBe("Menu: Main menu");
    expect(providerContext("gid://shopify/Product/1", "Jacket")).toBe("Product: Jacket");
    expect(providerContext("gid://shopify/Menu/1", null, "MENU")).toBeUndefined();
  });
});
