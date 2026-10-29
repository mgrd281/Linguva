import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { exportTranslations, importTranslations, MAX_IMPORT_ROWS } from "../../app/.server/translation/csv-transfer";
import { parseCsv, toCsv } from "../../app/.server/glossary/csv";
import { approveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "csv.myshopify.com" }, app);
  const store = new FakeShopifyStore(3);
  store.translate("gid://shopify/Product/1", "de", "title", "Jacke 1");
  return { shop, store, admin: store.asAdmin() };
}

/** Sets the translation cell of the row for a resource and field. */
function fill(table: string[][], gid: string, key: string, value: string) {
  const row = table.find((r) => r[0] === gid && r[2] === key);
  if (!row) throw new Error(`no row ${gid} ${key}`);
  row[6] = value;
}

describe("translation CSV", () => {
  it("exports the fields with an original, with their status, and only gaps when asked", async () => {
    const { admin } = await setup();
    const all = await exportTranslations(admin, { resourceType: "PRODUCT", locale: "de", onlyGaps: false });
    const table = parseCsv(all.csv);
    expect(table[0]).toEqual(["resource_id", "content_type", "field", "language", "source_digest", "original", "translation", "status"]);
    // 3 products × title, body_html, handle.
    expect(all.rows).toBe(9);
    expect(table.find((r) => r[0] === "gid://shopify/Product/1" && r[2] === "title")?.slice(6)).toEqual(["Jacke 1", "complete"]);
    const gaps = await exportTranslations(admin, { resourceType: "PRODUCT", locale: "de", onlyGaps: true });
    expect(gaps.rows).toBe(8);
    expect(all.nextCursor).toBeNull();
  });

  it("imports filled rows as drafts waiting on Review, never publishing them", async () => {
    const { shop, store, admin } = await setup();
    const table = parseCsv((await exportTranslations(admin, { resourceType: "PRODUCT", locale: "de", onlyGaps: true })).csv);
    fill(table, "gid://shopify/Product/2", "title", "Jacke 2");
    fill(table, "gid://shopify/Product/2", "body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>");
    // Numbers differ from the original ("number 3"): a quality note, so it needs review.
    fill(table, "gid://shopify/Product/3", "body_html", "<p>Warme <b>Jacke</b> Nummer 4.</p>");
    const result = await importTranslations({ admin, shopId: shop.id, csv: toCsv(table), targetLocales: ["de"] }, app);

    expect(result.drafts).toBe(3);
    // The other rows were left empty.
    expect(result.skipped).toEqual({ EMPTY: 5 });
    expect(store.translationOf("gid://shopify/Product/2", "de", "title")).toBeUndefined();
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.map((d) => `${d.resourceGid}|${d.key}|${d.provider}`).sort()).toEqual([
      "gid://shopify/Product/2|body_html|csv",
      "gid://shopify/Product/2|title|csv",
      "gid://shopify/Product/3|body_html|csv",
    ]);
    const flagged = drafts.find((d) => d.resourceGid === "gid://shopify/Product/3")!;
    expect((flagged.issues as Array<{ code: string }>).map((i) => i.code)).toContain("NUMBERS_CHANGED");

    // Approving publishes through the normal checks.
    const title = drafts.find((d) => d.key === "title")!;
    expect(await approveDrafts({ admin, shopId: shop.id, actorId: "1", draftIds: [title.id] }, app)).toMatchObject({ published: 1 });
    expect(store.translationOf("gid://shopify/Product/2", "de", "title")).toBe("Jacke 2");
  });

  it("reports and skips rows it can't trust", async () => {
    const { shop, store, admin } = await setup();
    const table = parseCsv((await exportTranslations(admin, { resourceType: "PRODUCT", locale: "de", onlyGaps: false })).csv);
    fill(table, "gid://shopify/Product/1", "title", "Jacke 1"); // unchanged
    fill(table, "gid://shopify/Product/2", "title", "Jacke 2");
    store.updateSource("gid://shopify/Product/2", "title", "Product 2 jacket, renamed"); // changed since the export
    fill(table, "gid://shopify/Product/3", "title", "Jacke 3");
    const extra = [
      ["gid://shopify/Product/999", "PRODUCT", "title", "de", "a".repeat(64), "x", "Fremd", "missing"], // not in this shop
      ["gid://shopify/Product/3", "PRODUCT", "nope", "de", "a".repeat(64), "x", "Nein", "missing"], // unknown field
      ["gid://shopify/Product/3", "PRODUCT", "title", "fr", table[1]![4]!, "x", "Veste", "missing"], // language not enabled
      ["javascript:alert(1)", "PRODUCT", "title", "de", "a".repeat(64), "x", "x", "missing"], // not a Shopify id
      [...table.find((r) => r[0] === "gid://shopify/Product/3" && r[2] === "title")!], // duplicate
    ];
    const result = await importTranslations({ admin, shopId: shop.id, csv: toCsv([...table, ...extra]), targetLocales: ["de"] }, app);
    expect(result.drafts).toBe(1);
    expect(result.skipped).toMatchObject({ UNCHANGED: 1, SOURCE_CHANGED: 1, NOT_FOUND: 1, UNKNOWN_FIELD: 1, UNKNOWN_LANGUAGE: 1, INVALID_ROW: 1, DUPLICATE: 1 });
    expect(result.problems.find((p) => p.code === "NOT_FOUND")?.line).toBe(table.length + 1);
  });

  it("keeps formula-like texts intact across export and import", async () => {
    const { shop, store, admin } = await setup();
    store.updateSource("gid://shopify/Product/1", "title", "=SUM(A1) jacket");
    const csv = (await exportTranslations(admin, { resourceType: "PRODUCT", locale: "de", onlyGaps: true })).csv;
    // A spreadsheet never sees a formula.
    expect(csv).toContain(`"'=SUM(A1) jacket"`);
    const table = parseCsv(csv);
    fill(table, "gid://shopify/Product/1", "title", "'=SUMME(A1) Jacke");
    await importTranslations({ admin, shopId: shop.id, csv: toCsv(table), targetLocales: ["de"] }, app);
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.find((d) => d.key === "title")?.value).toBe("=SUMME(A1) Jacke");
  });

  it("refuses files without the expected columns or with too many rows", async () => {
    const { shop, admin } = await setup();
    expect(await importTranslations({ admin, shopId: shop.id, csv: "a,b\n1,2\n", targetLocales: ["de"] }, app)).toMatchObject({ drafts: 0, skipped: { INVALID_HEADER: 1 } });
    const header = "resource_id,field,language,source_digest,translation\n";
    const big = header + "x,title,de,a,b\n".repeat(MAX_IMPORT_ROWS + 1);
    expect(await importTranslations({ admin, shopId: shop.id, csv: big, targetLocales: ["de"] }, app)).toMatchObject({ drafts: 0, tooMany: true });
  });
});
