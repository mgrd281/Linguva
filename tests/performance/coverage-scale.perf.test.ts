/**
 * Coverage at scale: a store with 50,000 products in 3 languages (150,000
 * items, 450,000 fields) plus a second shop. The dashboard reads only the
 * kept counts; the items behind a number are keyset-paged; a translation
 * saved by a merchant updates one item and a handful of counts. A
 * language's page counts what translating would start, its previews pick a
 * few items per category, and a category's list counts its items per state
 * and pages them in state order, each with indexed queries.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCoverageItems, loadCoverageSummary } from "../../app/.server/coverage/summary";
import { rebuildCountsTx, syncCoverage } from "../../app/.server/coverage/items";
import { COVERAGE_TYPES } from "../../app/.server/coverage/coverage";
import { clearLanguagePreviewsCache, loadCategoryItems, loadLanguagePage, loadLanguagePreviews } from "../../app/.server/languages/language-page";
import { headlineByLocale } from "../../app/lib/coverage-view";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const PRODUCTS = 50_000;
const LOCALES = ["de", "fr", "es"];
let shop: string;
let other: string;

/** Items as a scan would write them: every 3rd title translated, descriptions missing, every 7th outdated. */
async function seed(shopId: string, count: number) {
  await ownerDb.$transaction([
    ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
    ownerDb.$executeRawUnsafe(
      `INSERT INTO "CoverageItem" ("shopId","locale","resourceType","resourceGid","sourceKeys","currentKeys","outdatedKeys","draftKeys","reviewKeys",
         "fieldStates","stateComplete","stateOutdated","stateMissing","syncedAt","seenAt","updatedAt")
       SELECT $1::uuid, l, 'PRODUCT', 'gid://shopify/Product/' || g, ARRAY['title','body_html','handle'],
         CASE WHEN g % 3 = 0 THEN ARRAY['title'] ELSE ARRAY[]::text[] END,
         CASE WHEN g % 7 = 0 AND g % 3 <> 0 THEN ARRAY['title'] ELSE ARRAY[]::text[] END,
         ARRAY[]::text[], ARRAY[]::text[],
         ARRAY[CASE WHEN g % 3 = 0 THEN 'title:complete' WHEN g % 7 = 0 THEN 'title:outdated' ELSE 'title:missing' END, 'description:missing', 'url:missing'],
         CASE WHEN g % 3 = 0 THEN 1 ELSE 0 END,
         CASE WHEN g % 7 = 0 AND g % 3 <> 0 THEN 1 ELSE 0 END,
         CASE WHEN g % 3 = 0 OR g % 7 = 0 THEN 2 ELSE 3 END,
         now() - interval '1 hour', now() - interval '1 hour', now()
       FROM generate_series(1, $2::int) g, unnest($3::text[]) l`,
      shopId,
      count,
      LOCALES,
    ),
  ]);
  await withTenant(shopId, async (tx) => {
    for (const l of LOCALES) await rebuildCountsTx(tx, shopId, l, "PRODUCT");
  }, app);
}

/** The completed measurement that read them: every type in every language (figures count only for measured languages). */
async function measured(shopId: string) {
  const segments = COVERAGE_TYPES.flatMap((type) => LOCALES.map((locale) => ({ type, locale })));
  await withTenant(
    shopId,
    async (tx) => {
      const report = await tx.coverageReport.create({
        data: { shopId, idempotencyKey: "scale", status: "COMPLETED", segments: segments.map((s) => `${s.type}|${s.locale}`), segmentIndex: segments.length, finishedAt: new Date() },
      });
      await tx.coverageSegment.createMany({ data: segments.map((s) => ({ shopId, locale: s.locale, resourceType: s.type, status: "SCANNED" as const, reportId: report.id, scannedAt: new Date() })) });
    },
    app,
  );
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

beforeAll(async () => {
  await resetDatabase();
  shop = (await upsertInstalledShop({ shopDomain: "cov-scale.myshopify.com" }, app)).shop.id;
  other = (await upsertInstalledShop({ shopDomain: "cov-other.myshopify.com" }, app)).shop.id;
  await seed(shop, PRODUCTS);
  await seed(other, 5_000);
  await measured(shop);
  await ownerDb.$executeRawUnsafe(`ANALYZE "CoverageItem"`);
}, 300_000);

afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe(`coverage with ${PRODUCTS.toLocaleString("en")} products in ${LOCALES.length} languages`, () => {
  it("loads the dashboard summary quickly", async () => {
    await loadCoverageSummary(shop, app);
    const { ms, value } = await timed(() => loadCoverageSummary(shop, app));
    const de = headlineByLocale(value.counts).get("de")!;
    // Titles and descriptions count; URLs don't.
    expect(de.total).toBe(PRODUCTS * 2);
    expect(de.complete).toBe(Math.floor(PRODUCTS / 3));
    console.info(`coverage summary: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });

  it("pages through items behind a number, also deep in the list", async () => {
    let after: string | null = null;
    let worst = 0;
    for (let page = 0; page < 20; page++) {
      const { ms, value } = await timed(() => listCoverageItems(shop, { locale: "de", resourceType: "PRODUCT", fieldGroup: "title", state: "outdated", after, limit: 50 }, app));
      worst = Math.max(worst, ms);
      expect(value.items.length).toBe(50);
      after = value.nextCursor;
    }
    console.info(`coverage items page (worst of 20): ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(300);
  });

  it("updates one item and its counts after a save in milliseconds", async () => {
    const { ms } = await timed(() =>
      syncCoverage(
        shop,
        "de",
        [{
          resourceGid: "gid://shopify/Product/1",
          observed: {
            data: {
              content: ["title", "body_html", "handle"].map((key) => ({ key, value: `x ${key}`, digest: "d", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" })),
              translations: [{ key: "title", value: "Jacke", outdated: false, updatedAt: null }],
            },
            at: new Date(),
          },
        }],
        { create: false, seen: false },
        app,
      ),
    );
    console.info(`coverage item update: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(200);
    const de = headlineByLocale((await loadCoverageSummary(shop, app)).counts).get("de")!;
    expect(de.complete).toBe(Math.floor(PRODUCTS / 3) + 1);
  });

  it("keeps the other shop's figures separate", async () => {
    const de = headlineByLocale((await loadCoverageSummary(other, app)).counts).get("de")!;
    expect(de.total).toBe(10_000);
  });
});

describe(`a language's page with ${PRODUCTS.toLocaleString("en")} products`, () => {
  // Shopify answers at once here: the times are the database's.
  const store = new FakeShopifyStore(PRODUCTS);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    ...LOCALES.map((locale) => ({ locale, name: locale, primary: false, published: true })),
  ];
  const options = { jobsAvailable: true, aiAvailable: true };
  // Every 7th product's title is outdated (not every 21st, translated), every description missing.
  const outdated = Math.floor(PRODUCTS / 7) - Math.floor(PRODUCTS / 21);

  it("shows the categories and what translating would start quickly", async () => {
    await loadLanguagePage(store.asAdmin(), { id: shop, shopifyShopGid: null }, "de", app, options);
    const { ms, value } = await timed(() => loadLanguagePage(store.asAdmin(), { id: shop, shopifyShopGid: null }, "de", app, options));
    const products = value.categories.find((c) => c.id === "products")!;
    expect(products.tally.total).toBe(PRODUCTS * 2);
    expect(products.items).toBe(PRODUCTS);
    expect(products.bulk).toMatchObject({ types: ["PRODUCT"], items: PRODUCTS });
    console.info(`language page: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });

  it("picks each category's preview items, open work first, quickly", async () => {
    clearLanguagePreviewsCache();
    const { ms, value } = await timed(() => loadLanguagePreviews(store.asAdmin(), { id: shop }, "de", app));
    expect(value.products.items.map((i) => i.state)).toEqual(Array(6).fill("outdated"));
    console.info(`language previews: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(300);
  });

  it("counts a category's items per state and pages its list quickly, also deep in the list", async () => {
    let after: string | null = null;
    let worst = 0;
    for (let page = 0; page < 20; page++) {
      const { ms, value } = await timed(() => loadCategoryItems(store.asAdmin(), { id: shop, shopifyShopGid: null }, "de", "products", { after }, app, options));
      worst = Math.max(worst, ms);
      expect(value.counts).toMatchObject({ all: PRODUCTS, outdated, missing: PRODUCTS - outdated, complete: 0 });
      expect(value.rows).toHaveLength(50);
      expect(value.page).toMatchObject({ from: page * 50 + 1, total: PRODUCTS });
      after = value.page.nextCursor;
    }
    console.info(`category list page (worst of 20): ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(300);
    // One state, deep in it.
    const { ms, value } = await timed(() => loadCategoryItems(store.asAdmin(), { id: shop, shopifyShopGid: null }, "de", "products", { state: "missing", after: `2.ffffffff-0000-4000-8000-000000000000` }, app, options));
    expect(value.rows.every((r) => r.state === "missing")).toBe(true);
    console.info(`category list page, one state: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(300);
  });
});
