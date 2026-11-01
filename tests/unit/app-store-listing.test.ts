/**
 * The App Store listing draft (docs/APP_STORE_LISTING.md) keeps Shopify's
 * limits and rules: introduction ≤ 100 characters, details ≤ 500, each
 * feature ≤ 80, at most 5 search terms, no statistics or "the best / the
 * first / the only", and every screenshot is 1600 × 900.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS = join(__dirname, "..", "..", "docs");
const listing = readFileSync(join(DOCS, "APP_STORE_LISTING.md"), "utf8");

function section(heading: string) {
  const start = listing.indexOf(`## ${heading}`);
  expect(start, heading).toBeGreaterThan(-1);
  const end = listing.indexOf("\n## ", start + 3);
  return listing.slice(start, end === -1 ? undefined : end);
}

const byLanguage = (text: string, marker: RegExp) =>
  [...text.matchAll(marker)].map((m) => m[1]!.trim());

/** Texts merchants read in the listing (statistics and superlatives are not allowed there). */
const NO_CLAIMS = /\bthe (best|first|only)\b|\d+\s?%|\d+x\b/i;

describe("App Store listing draft", () => {
  it("keeps the introduction within 100 and the details within 500 characters", () => {
    const intro = byLanguage(section("App introduction"), /- \*\*(?:EN|DE):\*\* (.+)/g);
    const details = byLanguage(section("App details"), /> (.+)/g);
    expect(intro).toHaveLength(2);
    expect(details).toHaveLength(2);
    for (const text of intro) expect([...text].length, text).toBeLessThanOrEqual(100);
    for (const text of details) expect([...text].length, text.slice(0, 40)).toBeLessThanOrEqual(500);
    for (const text of [...intro, ...details]) expect(text).not.toMatch(NO_CLAIMS);
  });

  it("keeps every feature within 80 characters, without claims or numbers", () => {
    const rows = section("Feature list")
      .split("\n")
      .filter((line) => /^\| \d+ \|/.test(line))
      .map((line) => line.split("|").map((c) => c.trim()).slice(2, 4));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const feature of rows.flat()) {
      expect([...feature].length, feature).toBeLessThanOrEqual(80);
      expect(feature).not.toMatch(NO_CLAIMS);
      expect(feature).not.toMatch(/\d/);
    }
  });

  it("has at most five search terms per language", () => {
    for (const terms of byLanguage(section("Search terms"), /- \*\*(?:EN|DE):\*\* (.+)/g)) {
      expect(terms.split(",").length, terms).toBeLessThanOrEqual(5);
    }
  });

  it("lists screenshots that exist and are 1600 × 900", () => {
    const files = [...section("Screenshots").matchAll(/^\| (\d+-[\w-]+\.png) \|/gm)].map((m) => m[1]!);
    expect(files).toContain("10-content.png");
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const png = readFileSync(join(DOCS, "app-store", "screenshots", file));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([1600, 900]);
    }
  });

  it("has a 1600 × 900 PNG feature image in English and German, with alt text", () => {
    const media = section("Feature media");
    for (const locale of ["en", "de"]) {
      const file = `feature-image-${locale}.png`;
      expect(media).toMatch(new RegExp(`\\| \\[${file}\\]\\(app-store/${file}\\) \\| [^|]+ \\| [^|]{40,} \\|`));
      const png = readFileSync(join(DOCS, "app-store", file));
      expect(png.subarray(1, 4).toString(), file).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([1600, 900]);
    }
  });

  it("never photographs the Plan page (no prices in images, requirements 4.2.2 and 4.2.3)", () => {
    const spec = readFileSync(join(__dirname, "..", "ui", "app-store-screenshots.spec.ts"), "utf8");
    expect(spec).not.toMatch(/path: "\/app\/plan/);
    expect(spec).not.toMatch(/openApp\([^)]*"\/app\/plan/);
  });
});
