import { describe, expect, it } from "vitest";
import { aggregatePage } from "../../app/.server/coverage/coverage";
import type { TranslatableResourceData } from "../../app/.server/shopify/translations-api";

const field = (key: string, value: string | null) => ({ key, value, digest: value ? "d" : null, locale: "en", type: "SINGLE_LINE_TEXT_FIELD" });
const tr = (key: string, value: string | null, outdated = false) => ({ key, value, outdated, updatedAt: null });

describe("aggregatePage", () => {
  it("counts translated, outdated and missing fields, SEO findings and gaps", () => {
    const resources: TranslatableResourceData[] = [
      {
        resourceId: "gid://shopify/Product/1",
        content: [field("title", "Jacket"), field("meta_title", "Warm winter jacket for cold days"), field("body_html", "")],
        translations: [tr("title", "Jacke"), tr("meta_title", "W".repeat(70))],
      },
      {
        resourceId: "gid://shopify/Product/2",
        content: [field("title", "Hat"), field("meta_title", "Winter hat")],
        translations: [tr("title", "Mütze", true), tr("meta_title", "  www  ")],
      },
      {
        resourceId: "gid://shopify/Product/3",
        content: [field("title", "Scarf"), field("meta_title", "Scarf")],
        translations: [tr("meta_title", "WWW")],
      },
    ];
    const page = aggregatePage(resources);
    expect(page.resources).toBe(3);
    expect(page.keys.get("title")).toEqual({ withSource: 3, translated: 1, outdated: 1, seoIssues: 0 });
    // Empty source fields don't count.
    expect(page.keys.has("body_html")).toBe(false);
    // Product 1's SEO title is too long, the others are too short.
    expect(page.keys.get("meta_title")).toEqual({ withSource: 3, translated: 3, outdated: 0, seoIssues: 3 });
    // "  www  " and "WWW" are the same title once normalised.
    expect([...page.titleHashes.values()].sort()).toEqual([1, 2]);
    expect(page.gaps).toEqual([
      { resourceGid: "gid://shopify/Product/2", missing: 0, outdated: 1 },
      { resourceGid: "gid://shopify/Product/3", missing: 1, outdated: 0 },
    ]);
    // Hashes, not text.
    for (const hash of page.titleHashes.keys()) expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
