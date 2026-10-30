/**
 * A large shop: 50,000 drafts waiting for review (5 % of them image
 * descriptions whose owner only the coverage scan knows), 5,000 jobs and a
 * catalog of 5,000 products, next to a second shop. Measures the pages
 * merchants open most (Review, Jobs) and how a bulk job walks a large catalog.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBulkJob, listJobsPage } from "../../app/.server/jobs/bulk-jobs";
import { runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { countPendingDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { searchReviewPage, type ReviewFilter } from "../../app/.server/review/page";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DRAFTS = 50_000;
const JOBS = 5_000;
const PRODUCTS = 5_000;
let shopA: string;
let shopB: string;

async function asTenant(shopId: string, sql: string, ...params: unknown[]) {
  await ownerDb.$transaction([
    ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
    ownerDb.$executeRawUnsafe(sql, ...params),
  ]);
}

async function seedDrafts(shopId: string, count: number, marker: string) {
  // 4 languages x 3 fields per product; every 7th draft has a warning. Every
  // 20th is an image description drafted without its owner (a smart check of
  // the image, an import): the coverage scan knows the product.
  await asTenant(
    shopId,
    `INSERT INTO "TranslationDraft" ("shopId","resourceGid","resourceTitle","locale","key","sourceDigest","sourceValue","value","issues","status","updatedAt")
     SELECT $1::uuid,
            CASE WHEN g % 20 = 0 THEN 'gid://shopify/MediaImage/' || g ELSE 'gid://shopify/Product/' || (g / 12) END,
            '${marker} product ' || (g / 12) || ' jacket',
            (ARRAY['de','fr','it','es'])[1 + (g / 3) % 4],
            CASE WHEN g % 20 = 0 THEN 'alt' ELSE (ARRAY['title','body_html','meta_title'])[1 + g % 3] END,
            md5(g::text),
            'Warm waterproof jacket number ' || g,
            '${marker} Warme wasserdichte Jacke Nummer ' || g,
            CASE WHEN g % 7 = 0 THEN '[{"code":"LENGTH_RATIO","severity":"warning"}]'::jsonb ELSE NULL END,
            'PENDING', now()
     FROM generate_series(0, $2::int - 1) g`,
    shopId,
    count,
  );
  await asTenant(
    shopId,
    `INSERT INTO "CoverageItem" ("shopId","locale","resourceType","resourceGid","parentGid","sourceKeys","currentKeys","outdatedKeys","draftKeys","reviewKeys","fieldStates","syncedAt","seenAt","updatedAt")
     SELECT $1::uuid, (ARRAY['de','fr','it','es'])[1 + (g / 3) % 4], 'MEDIA_IMAGE', 'gid://shopify/MediaImage/' || g, 'gid://shopify/Product/' || (g / 12),
            ARRAY['alt'], ARRAY[]::text[], ARRAY[]::text[], ARRAY['alt'], ARRAY[]::text[], ARRAY['alt:draft'], now(), now(), now()
     FROM generate_series(0, $2::int - 1) g WHERE g % 20 = 0`,
    shopId,
    count,
  );
}

async function seedJobs(shopId: string, count: number) {
  await asTenant(
    shopId,
    `INSERT INTO "TranslationJob" ("shopId","resourceType","targetLocale","status","idempotencyKey","createdAt","updatedAt")
     SELECT $1::uuid, 'PRODUCT', (ARRAY['de','fr','it','es'])[1 + g % 4],
            (ARRAY['COMPLETED','FAILED','CANCELLED','COMPLETED'])[1 + g % 4]::"TranslationJobStatus",
            'perf-' || g, now() - (g || ' minutes')::interval, now()
     FROM generate_series(1, $2::int) g`,
    shopId,
    count,
  );
}

async function measure(fn: () => Promise<unknown>, runs = 7) {
  await fn(); // warm-up
  const timings: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    await fn();
    timings.push(performance.now() - started);
  }
  timings.sort((x, y) => x - y);
  return { median: timings[Math.floor(runs / 2)]!, max: timings[runs - 1]! };
}

beforeAll(async () => {
  await resetDatabase();
  shopA = (await upsertInstalledShop({ shopDomain: "large-a.myshopify.com" }, app)).shop.id;
  shopB = (await upsertInstalledShop({ shopDomain: "large-b.myshopify.com" }, app)).shop.id;
  await seedDrafts(shopA, DRAFTS, "A");
  await seedDrafts(shopB, 10_000, "B");
  await seedJobs(shopA, JOBS);
  await seedJobs(shopB, 1_000);
  await ownerDb.$executeRawUnsafe(`ANALYZE "TranslationDraft"`);
  await ownerDb.$executeRawUnsafe(`ANALYZE "CoverageItem"`);
  await ownerDb.$executeRawUnsafe(`ANALYZE "TranslationJob"`);
}, 180_000);

afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const report = (label: string, t: { median: number; max: number }) =>
  console.info(`${label}: median ${t.median.toFixed(1)} ms, max ${t.max.toFixed(1)} ms`);

describe(`Review with ${DRAFTS.toLocaleString()} pending drafts`, () => {
  it("opens, pages, filters and searches quickly and only shows the shop's own drafts", async () => {
    const first = await searchPendingDrafts(shopA, {}, app);
    expect(first.total).toBe(DRAFTS);
    expect(first.drafts).toHaveLength(50);
    expect(first.drafts.every((d) => d.value.startsWith("A "))).toBe(true);

    const open = await measure(() => searchPendingDrafts(shopA, {}, app));
    // Page 200 of 1,000 by keyset cursor.
    let cursor = first.nextCursor;
    for (let i = 0; i < 3; i++) cursor = (await searchPendingDrafts(shopA, { cursor }, app)).nextCursor;
    const deep = await measure(() => searchPendingDrafts(shopA, { cursor }, app));
    const byLocale = await measure(() => searchPendingDrafts(shopA, { locale: "fr", flagged: true }, app));
    const search = await measure(() => searchPendingDrafts(shopA, { search: "number 4711" }, app));
    // Two characters can't use the trigram index: the RLS scan, as before.
    const shortSearch = await measure(() => searchPendingDrafts(shopA, { search: "47" }, app));
    const count = await measure(() => countPendingDrafts(shopA, app));

    const found = await searchPendingDrafts(shopA, { search: "number 4711" }, app);
    expect(found.drafts.map((d) => d.sourceValue)).toContain("Warm waterproof jacket number 4711");
    expect(found.drafts.every((d) => d.value.startsWith("A "))).toBe(true);

    report("review: first page", open);
    report("review: later page (cursor)", deep);
    report("review: language + warnings filter", byLocale);
    report("review: text search (indexed)", search);
    report("review: text search, 2 characters (scan)", shortSearch);
    report("review: pending count", count);
    // Generous limits for shared CI runners; the measured values are reported above.
    // Text search of three characters or more goes through the reviewed
    // definer function and its trigram index (SECURITY_MODEL §5l).
    for (const t of [open, deep, byLocale, count, search]) expect(t.median).toBeLessThan(300);
    // Shorter text scans the shop's pending drafts (ILIKE isn't leakproof under RLS).
    expect(shortSearch.median).toBeLessThan(1_000);
  }, 120_000);
});

describe(`Review's cards with ${DRAFTS.toLocaleString()} pending drafts`, () => {
  const filter = (f: Partial<ReviewFilter> = {}): ReviewFilter => ({ locale: null, area: null, flagged: false, search: null, jobId: null, group: null, after: null, ...f });
  const review = (f: Partial<ReviewFilter> = {}) => searchReviewPage(shopA, filter(f), { targets: null }, app);

  it("opens, pages by cards, filters by area and counts quickly, images in their product's card", async () => {
    const first = await review();
    expect(first.matching).toBe(DRAFTS);
    expect(first.facets.total).toBe(DRAFTS);
    expect(first.facets.areas.find((a) => a.area === "images")?.count).toBe(DRAFTS / 20);
    expect(first.cards.flatMap((c) => c.rows).every((r) => r.draft.value.startsWith("A "))).toBe(true);
    // Product 0's German card holds its owner-less image description (draft 0) after its own texts.
    expect(first.cards[0]!.key).toBe("gid://shopify/Product/0|de");
    expect(first.cards[0]!.rows.map((r) => r.key)).toEqual(["body_html", "meta_title", "alt"]);

    const open = await measure(() => review());
    let after = first.nextCursor;
    for (let i = 0; i < 3; i++) after = (await review({ after })).nextCursor;
    const deep = await measure(() => review({ after }));
    expect((await review({ after })).from).toBeGreaterThan(150);
    const images = await measure(() => review({ locale: "fr", area: "images" }));
    expect((await review({ locale: "fr", area: "images" })).cards.every((c) => c.key.startsWith("gid://shopify/Product/"))).toBe(true);
    const flagged = await measure(() => review({ locale: "de", flagged: true }));
    const search = await measure(() => review({ search: "number 4711" }));

    report("review cards: first page (page, counts, position, facets)", open);
    report("review cards: later page (cursor, position)", deep);
    report("review cards: language + area (owner look-up)", images);
    report("review cards: language + notes", flagged);
    report("review cards: text search (indexed)", search);
    // The CI limit for every page of Review; the measured values are reported above.
    for (const t of [open, deep, images, flagged, search]) expect(t.median).toBeLessThan(300);
  }, 120_000);
});

describe(`Jobs with ${JOBS.toLocaleString()} jobs`, () => {
  it("lists and filters jobs quickly", async () => {
    const first = await listJobsPage(shopA, {}, app);
    expect(first.jobs).toHaveLength(25);
    const open = await measure(() => listJobsPage(shopA, {}, app));
    const filtered = await measure(() => listJobsPage(shopA, { status: "failed", locale: "fr" }, app));
    const next = await measure(() => listJobsPage(shopA, { cursor: first.nextCursor }, app));
    report("jobs: first page", open);
    report("jobs: status + language filter", filtered);
    report("jobs: next page", next);
    for (const t of [open, filtered, next]) expect(t.median).toBeLessThan(300);
  }, 60_000);
});

describe(`bulk job over ${PRODUCTS.toLocaleString()} products`, () => {
  it("walks the catalog in bounded pages, one Shopify request per page", async () => {
    await setAiConsent({ shopId: shopA, granted: true, actorId: null }, app);
    const store = new FakeShopifyStore(PRODUCTS);
    const deps: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 100_000_000,
      keyPrefix: "lv:test:large",
    };
    const { job } = await createBulkJob({ shopId: shopA, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "large-1" }, app);
    const started = performance.now();
    let pages = 0;
    let items = 0;
    let largestPage = 0;
    for (let more = true; more; ) {
      const page = await runDiscoveryPage(deps, { shopId: shopA, jobId: job.id });
      pages++;
      items += page.itemIds.length;
      largestPage = Math.max(largestPage, page.itemIds.length);
      more = page.hasMore;
      expect(pages).toBeLessThan(PRODUCTS);
    }
    const total = performance.now() - started;
    console.info(`bulk discovery: ${items} products in ${pages} pages, ${total.toFixed(0)} ms (${(total / pages).toFixed(1)} ms per page)`);
    expect(items).toBe(PRODUCTS);
    expect(largestPage).toBeLessThanOrEqual(50);
    expect(store.calls.filter((c) => c.startsWith("LinguvaTranslatable")).length).toBe(pages);
    expect(total / pages).toBeLessThan(250);
  }, 120_000);
});
