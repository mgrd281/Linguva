/**
 * The fictional catalog file for the dev store (docs/dev-store/) stays in
 * step with the catalog the live rehearsal and the screenshots use.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../app/.server/glossary/csv";
import { DEMO_CATALOG_FILE, DEMO_TAG, demoCatalogCsv } from "../live/demo-catalog";
import { DEMO_PRODUCTS } from "../ui/fixtures/demo-store";

describe("demo catalog for the dev store", () => {
  it("matches the generated file", () => {
    if (process.env.UPDATE_DEMO_CATALOG === "1") writeFileSync(DEMO_CATALOG_FILE, demoCatalogCsv());
    expect(readFileSync(DEMO_CATALOG_FILE, "utf8"), "regenerate with UPDATE_DEMO_CATALOG=1").toBe(demoCatalogCsv());
  });

  it("has one fictional, tagged product per row with SEO fields", () => {
    const [header, ...rows] = parseCsv(demoCatalogCsv());
    expect(header).toContain("Title");
    expect(rows).toHaveLength(DEMO_PRODUCTS.length);
    const col = (name: string) => header!.indexOf(name);
    for (const row of rows) {
      expect(row[col("Tags")]).toBe(DEMO_TAG);
      expect(row[col("SEO title")]).toBeTruthy();
      expect(row[col("SEO description")]).toBeTruthy();
      // Nothing a spreadsheet would run as a formula.
      expect(row.every((cell) => !/^[=+\-@]/.test(cell))).toBe(true);
    }
  });
});
