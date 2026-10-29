/**
 * The coverage calculation rules (app/lib/coverage-rules.ts, docs/COVERAGE_RULES.md):
 * empty originals, outdated translations, unpublished drafts, failed
 * attempts, excluded types and groups, rounding, and the reliable ETA.
 */
import { describe, expect, it } from "vitest";
import {
  coveragePercent,
  countsInHeadline,
  fieldGroupOf,
  fieldState,
  percentText,
} from "../../app/lib/coverage-rules";
import { byFieldGroup, byType, headlineByLocale, storeWide, type CountInput } from "../../app/lib/coverage-view";
import { baseFromShopify, deriveStates, seoTitleHash } from "../../app/.server/coverage/items";
import { reliableEta } from "../../app/lib/eta";

const field = (key: string, value: string | null) => ({ key, value, digest: value ? "d" : null, locale: "en", type: "SINGLE_LINE_TEXT_FIELD" });
const tr = (key: string, value: string | null, outdated = false) => ({ key, value, outdated, updatedAt: null });
const noOverlay = { draftKeys: [], reviewKeys: [], failed: false, failureCode: null };

describe("field state", () => {
  const none = { current: false, outdated: false, draft: false, review: false, failed: false };

  it("follows the priority complete → needs review → draft → failed → outdated → missing", () => {
    expect(fieldState({ ...none, current: true, draft: true, review: true, failed: true })).toBe("complete");
    expect(fieldState({ ...none, review: true, draft: true, failed: true, outdated: true })).toBe("review");
    expect(fieldState({ ...none, draft: true, failed: true, outdated: true })).toBe("draft");
    expect(fieldState({ ...none, failed: true, outdated: true })).toBe("failed");
    expect(fieldState({ ...none, outdated: true })).toBe("outdated");
    expect(fieldState(none)).toBe("missing");
  });

  it("never counts an unpublished draft as complete", () => {
    const base = baseFromShopify({ content: [field("title", "Jacket")], translations: [] });
    const { counts } = deriveStates("PRODUCT", base, { ...noOverlay, draftKeys: ["title"] });
    expect(counts).toMatchObject({ complete: 0, draft: 1 });
  });
});

describe("base state from Shopify", () => {
  it("leaves out empty originals, separates current and outdated, and ignores blank translations", () => {
    const base = baseFromShopify({
      content: [field("title", "Jacket"), field("body_html", "  "), field("meta_title", "Warm jacket"), field("handle", "jacket"), field("meta_description", null)],
      translations: [tr("title", "Jacke"), tr("meta_title", "Warme Jacke", true), tr("handle", "   "), tr("body_html", "<p>Text</p>")],
    });
    expect(base.sourceKeys).toEqual(["title", "meta_title", "handle"]);
    expect(base.currentKeys).toEqual(["title"]);
    expect(base.outdatedKeys).toEqual(["meta_title"]);
    // A translation of an empty original isn't counted anywhere.
    expect(base.currentKeys).not.toContain("body_html");
  });

  it("hashes the translated SEO title (normalised), never keeping its text", () => {
    const a = baseFromShopify({ content: [field("meta_title", "Hat")], translations: [tr("meta_title", "  Warme   MÜTZE ")] });
    expect(a.seoTitleHash).toBe(seoTitleHash("warme mütze"));
    expect(a.seoTitleHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("counts translated SEO fields with findings", () => {
    const base = baseFromShopify({
      content: [field("meta_title", "Warm winter jacket for cold days"), field("title", "Jacket")],
      translations: [tr("meta_title", "W".repeat(90)), tr("title", "Jacke")],
    });
    expect(base.seoIssues).toBe(1);
  });
});

describe("derived states", () => {
  it("marks every not-complete field failed when the last attempt failed, and groups fields", () => {
    const base = baseFromShopify({
      content: [field("title", "Jacket"), field("body_html", "<p>Warm</p>"), field("meta_title", "Jacket"), field("handle", "jacket")],
      translations: [tr("title", "Jacke"), tr("body_html", "<p>Alt</p>", true)],
    });
    const { counts, fieldStates } = deriveStates("PRODUCT", base, { ...noOverlay, failed: true });
    expect(counts).toEqual({ complete: 1, review: 0, draft: 0, failed: 3, outdated: 0, missing: 0 });
    expect(fieldStates).toEqual(["title:complete", "description:failed", "seo_title:failed", "url:failed"]);
  });

  it("separates drafts that need review (quality notes) from plain drafts", () => {
    const base = baseFromShopify({ content: [field("title", "Jacket"), field("body_html", "<p>Warm</p>")], translations: [] });
    const { counts } = deriveStates("PRODUCT", base, { ...noOverlay, draftKeys: ["title", "body_html"], reviewKeys: ["body_html"] });
    expect(counts).toMatchObject({ draft: 1, review: 1, missing: 0 });
  });

  it("groups keys by meaning and custom fields as values", () => {
    expect(fieldGroupOf("title", "PRODUCT")).toBe("title");
    expect(fieldGroupOf("name", "PRODUCT_OPTION")).toBe("title");
    expect(fieldGroupOf("summary_html", "ARTICLE")).toBe("description");
    expect(fieldGroupOf("meta_description", "PAGE")).toBe("seo_description");
    expect(fieldGroupOf("alt", "MEDIA_IMAGE")).toBe("alt");
    expect(fieldGroupOf("value", "PRODUCT_METAFIELD")).toBe("value");
    expect(fieldGroupOf("section.header.title", "ONLINE_STORE_THEME")).toBe("other");
  });
});

describe("percentages", () => {
  it("is null with nothing to translate (0 of 0 is not 100 %)", () => {
    expect(coveragePercent(0, 0)).toBeNull();
    expect(percentText(0, 0)).toBe("—");
  });

  it("rounds down, so 100 % only when every field is complete", () => {
    expect(coveragePercent(999, 1000)).toBe(99);
    expect(coveragePercent(1000, 1000)).toBe(100);
    expect(coveragePercent(1, 3)).toBe(33);
    expect(percentText(1, 1000)).toBe("<1");
    expect(percentText(0, 1000)).toBe("0");
  });
});

describe("aggregations", () => {
  const row = (locale: string, resourceType: string, fieldGroup: string, state: CountInput["state"], count: number): CountInput => ({ locale, resourceType, fieldGroup, state, count });
  const rows: CountInput[] = [
    row("de", "PRODUCT", "title", "complete", 8),
    row("de", "PRODUCT", "title", "missing", 2),
    row("de", "PRODUCT", "description", "draft", 10),
    // URLs are optional: shown, not in the headline.
    row("de", "PRODUCT", "url", "missing", 10),
    // Theme texts: shown on their own row, not in the headline.
    row("de", "ONLINE_STORE_THEME_LOCALE_CONTENT", "other", "missing", 5000),
    row("fr", "PRODUCT", "title", "complete", 10),
  ];

  it("leaves excluded types and groups out of the headline only", () => {
    expect(countsInHeadline("ONLINE_STORE_THEME", "title")).toBe(false);
    expect(countsInHeadline("EMAIL_TEMPLATE", "other")).toBe(false);
    expect(countsInHeadline("PRODUCT", "url")).toBe(false);
    expect(countsInHeadline("PRODUCT", "title")).toBe(true);
    const de = headlineByLocale(rows).get("de")!;
    expect(de).toMatchObject({ total: 20, complete: 8, percent: 40 });
    expect(byType(rows, "de").get("ONLINE_STORE_THEME_LOCALE_CONTENT")).toMatchObject({ total: 5000, percent: 0 });
    expect(byType(rows, "de").get("PRODUCT")).toMatchObject({ total: 30, complete: 8 });
  });

  it("groups fields across types, without theme content", () => {
    const groups = byFieldGroup(rows, "de");
    expect(groups.get("title")).toMatchObject({ total: 10, complete: 8, percent: 80 });
    expect(groups.get("description")?.counts.draft).toBe(10);
    expect(groups.has("other")).toBe(false);
  });

  it("computes the store-wide figure over the given (published) languages", () => {
    expect(storeWide(rows, ["de", "fr"])).toMatchObject({ total: 30, complete: 18, percent: 60 });
    expect(storeWide(rows, ["fr"])).toMatchObject({ percent: 100 });
    expect(storeWide(rows, []).percent).toBeNull();
  });
});

describe("reliable ETA", () => {
  const start = new Date("2026-10-28T10:00:00Z");
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

  it("shows nothing until enough work is observed", () => {
    expect(reliableEta({ done: 0, total: 100, startedAt: start, now: at(120) })).toBeNull();
    expect(reliableEta({ done: 9, total: 100, startedAt: start, now: at(120) })).toBeNull();
    // 10 of 1000 is below 5 %.
    expect(reliableEta({ done: 10, total: 1000, startedAt: start, now: at(120) })).toBeNull();
    // Too early.
    expect(reliableEta({ done: 50, total: 100, startedAt: start, now: at(20) })).toBeNull();
    expect(reliableEta({ done: 100, total: 100, startedAt: start, now: at(120) })).toBeNull();
    expect(reliableEta({ done: 50, total: 100, startedAt: null, now: at(120) })).toBeNull();
  });

  it("estimates from the observed pace, capped at a day", () => {
    expect(reliableEta({ done: 50, total: 100, startedAt: start, now: at(60) })).toBe(60_000);
    expect(reliableEta({ done: 10, total: 100_000, startedAt: start, now: at(3600) })).toBeNull();
    expect(reliableEta({ done: 5000, total: 100_000, startedAt: start, now: at(36_000) })).toBe(24 * 3600 * 1000);
  });
});

describe("language flags (decorative)", () => {
  it("uses the locale's region, a clear country for the language, or nothing", async () => {
    const { localeFlag } = await import("../../app/lib/flags");
    expect(localeFlag("pt-BR")).toBe("🇧🇷");
    expect(localeFlag("de")).toBe("🇩🇪");
    expect(localeFlag("en")).toBe("");
    expect(localeFlag("ar")).toBe("");
    expect(localeFlag("zh-CN")).toBe("🇨🇳");
  });
});
