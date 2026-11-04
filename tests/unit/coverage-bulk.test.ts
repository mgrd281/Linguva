/**
 * What a Coverage row's "Translate" asks about before its job starts: the types its job reads and how many
 * of their texts are open in the language (as the language pages count them: never URL handles or the
 * theme's texts), only the texts for Google where the job is for them alone.
 */
import { describe, expect, it } from "vitest";
import { bulkTypes, openTexts, openTotal } from "../../app/lib/coverage-bulk";
import type { CountInput } from "../../app/lib/coverage-view";

const row = (resourceType: string, fieldGroup: string, state: CountInput["state"], count: number, locale = "de"): CountInput => ({ locale, resourceType, fieldGroup, state, count });

describe("bulkTypes", () => {
  it("is the owner type alone without image descriptions and extra details", () => {
    expect(bulkTypes({ resourceType: "PRODUCT", includeAttached: false })).toEqual(["PRODUCT"]);
    expect(bulkTypes({ resourceType: "MENU", includeAttached: false })).toEqual(["MENU"]);
  });

  it("adds the owner's image descriptions and extra details when the job includes them", () => {
    expect(bulkTypes({ resourceType: "PRODUCT", includeAttached: true })).toEqual(["PRODUCT", "MEDIA_IMAGE", "PRODUCT_METAFIELD"]);
    expect(bulkTypes({ resourceType: "PAGE", includeAttached: true })).toEqual(["PAGE", "PAGE_METAFIELD"]);
    expect(bulkTypes({ resourceType: "ARTICLE", includeAttached: true })).toEqual(["ARTICLE", "ARTICLE_IMAGE", "ARTICLE_METAFIELD"]);
    // A type without attached parts stays alone.
    expect(bulkTypes({ resourceType: "MENU", includeAttached: true })).toEqual(["MENU"]);
  });
});

describe("openTexts", () => {
  const rows: CountInput[] = [
    row("PRODUCT", "title", "missing", 10),
    row("PRODUCT", "description", "outdated", 2),
    row("PRODUCT", "description", "failed", 1),
    row("PRODUCT", "seo_title", "missing", 4),
    // Never counted: URL handles, done or waiting texts, another language, another type.
    row("PRODUCT", "url", "missing", 30),
    row("PRODUCT", "title", "complete", 7),
    row("PRODUCT", "title", "draft", 3),
    row("PRODUCT", "title", "missing", 99, "fr"),
    row("COLLECTION", "title", "missing", 5),
    row("MEDIA_IMAGE", "alt", "missing", 6),
    row("PRODUCT_METAFIELD", "value", "outdated", 2),
  ];

  it("counts missing, outdated and failed texts of the job's types in the language", () => {
    const open = openTexts(rows, "de", ["PRODUCT"]);
    expect(open).toEqual({ missing: 14, outdated: 2, failed: 1 });
    expect(openTotal(open)).toBe(17);
  });

  it("counts the image descriptions and extra details the job takes with it", () => {
    expect(openTexts(rows, "de", bulkTypes({ resourceType: "PRODUCT", includeAttached: true }))).toEqual({ missing: 20, outdated: 4, failed: 1 });
  });

  it("counts only the texts for Google for a job that translates them alone", () => {
    expect(openTexts(rows, "de", ["PRODUCT"], ["seo_title", "seo_description"])).toEqual({ missing: 4, outdated: 0, failed: 0 });
  });

  it("leaves the theme's texts out, as the language's figure does", () => {
    expect(openTotal(openTexts([row("ONLINE_STORE_THEME", "other", "missing", 500)], "de", ["ONLINE_STORE_THEME"]))).toBe(0);
  });
});
