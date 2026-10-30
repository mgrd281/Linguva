/**
 * Review's cards against PostgreSQL (app/.server/review/page.ts): one card
 * per item and language in reading order, never split up to 100 texts,
 * images and custom fields in their owner's card (also when the owner is
 * only known to the coverage scan), every pending draft exactly once across
 * the pages while texts are decided between loads, counts that add up and
 * match the language page, the filters, and the SQL agreeing with its pure
 * mirrors (review-order.ts, review-areas.ts).
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { loadLanguagePage } from "../../app/.server/languages/language-page";
import { saveDrafts, type DraftInput } from "../../app/.server/review/drafts";
import { loadReviewPage, searchReviewPage, type ReviewFilter } from "../../app/.server/review/page";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { CATEGORY_IDS } from "../../app/lib/language-categories";
import { ownType } from "../../app/lib/review-areas";
import { cardGidOf, fieldRank, idLength, typeRank } from "../../app/lib/review-order";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let n = 0;

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const filter = (f: Partial<ReviewFilter> = {}): ReviewFilter => ({ locale: null, area: null, flagged: false, search: null, jobId: null, group: null, after: null, ...f });
const page = (shopId: string, f: Partial<ReviewFilter> = {}, budget?: number) => searchReviewPage(shopId, filter(f), { targets: null, ...(budget ? { budget } : {}) }, app);
const ids = (result: Awaited<ReturnType<typeof page>>) => result.cards.flatMap((c) => c.rows.map((r) => r.id));

interface Spec {
  key?: string;
  locale?: string;
  source?: string;
  value?: string;
  parentGid?: string | null;
  title?: string | null;
  jobId?: string | null;
  provider?: string;
  issues?: unknown[];
}

function draft(resourceGid: string, spec: Spec = {}): DraftInput {
  const source = spec.source ?? `${spec.key ?? "title"} of ${resourceGid}`;
  return {
    jobId: spec.jobId ?? null,
    resourceGid,
    parentGid: spec.parentGid ?? null,
    resourceTitle: spec.title === undefined ? null : spec.title,
    locale: spec.locale ?? "de",
    key: spec.key ?? "title",
    sourceDigest: sha(source),
    sourceValue: source,
    value: spec.value ?? `[de] ${source}`,
    segmentPairs: [],
    issues: spec.issues ?? [],
    provider: spec.provider ?? "mock",
  };
}

async function newShop() {
  return (await upsertInstalledShop({ shopDomain: `cards-${++n}.myshopify.com` }, app)).shop;
}

async function job(shopId: string, resourceType: string, locale = "de") {
  return withTenant(shopId, (tx) => tx.translationJob.create({ data: { shopId, resourceType, targetLocale: locale, idempotencyKey: `job-${++n}`, status: "COMPLETED" } }), app);
}

/** A coverage scan's record of an image or custom field and its owner. */
async function coverageItem(shopId: string, resourceGid: string, resourceType: string, parentGid: string | null, locale = "de") {
  const now = new Date();
  await withTenant(
    shopId,
    (tx) =>
      tx.coverageItem.create({
        data: { shopId, locale, resourceType, resourceGid, parentGid, sourceKeys: [], currentKeys: [], outdatedKeys: [], draftKeys: [], reviewKeys: [], fieldStates: [], syncedAt: now, seenAt: now },
      }),
    app,
  );
}

/** Many drafts at once (owner connection, as the tenant). */
async function insertDrafts(shopId: string, sql: string, ...params: unknown[]) {
  await ownerDb.$transaction([ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`, ownerDb.$executeRawUnsafe(sql, ...params)]);
}

describe("cards and their order", () => {
  it("reads a card's texts as a merchant does, and cards by kind and natural number", async () => {
    const shop = await newShop();
    const product = await job(shop.id, "PRODUCT");
    await saveDrafts(
      shop.id,
      [
        draft(C(1)),
        draft("gid://shopify/Page/1"),
        draft(P(10)),
        draft(P(2), { key: "handle", provider: "csv" }),
        draft(P(2), { key: "meta_description", jobId: product.id }),
        draft("gid://shopify/Metafield/7", { key: "value", parentGid: P(2), jobId: product.id, title: "Jacket · Care (custom field)" }),
        draft("gid://shopify/MediaImage/9", { key: "alt", parentGid: P(2), jobId: product.id, title: "Jacket · Image" }),
        draft(P(2), { key: "body_html", jobId: product.id }),
        draft(P(2), { key: "meta_title", jobId: product.id }),
        draft(P(2), { key: "title", jobId: product.id, title: "Jacket" }),
        draft(P(2), { key: "title", locale: "fr" }),
        draft("gid://shopify/Menu/1"),
      ],
      app,
    );
    const result = await page(shop.id);
    expect(result.cards.map((c) => c.key)).toEqual([
      `${P(2)}|de`,
      `${P(2)}|fr`,
      `${P(10)}|de`,
      `${C(1)}|de`,
      "gid://shopify/Page/1|de",
      "gid://shopify/Menu/1|de",
    ]);
    expect(result.cards[0]!.rows.map((r) => r.key)).toEqual(["title", "body_html", "meta_title", "meta_description", "alt", "value", "handle"]);
    expect(result.matching).toBe(12);
    expect(result.nextCursor).toBeNull();
  });

  it("never splits a card of up to 100 texts, and splits a bigger one with a note on both pages", async () => {
    const shop = await newShop();
    // Product 1: a name and 59 custom fields (60 texts); product 2: 5 texts; product 3: 130 texts.
    await insertDrafts(
      shop.id,
      `INSERT INTO "TranslationDraft" ("shopId","resourceGid","parentGid","locale","key","sourceDigest","sourceValue","value","status","updatedAt")
       SELECT $1::uuid, 'gid://shopify/Metafield/' || (p * 1000 + g), 'gid://shopify/Product/' || p, 'de', 'value', md5(g::text), 'Field ' || g, 'Feld ' || g, 'PENDING', now()
       FROM (VALUES (1, 59), (2, 5), (3, 130)) AS s(p, c), generate_series(1, c) g`,
      shop.id,
    );
    await saveDrafts(shop.id, [draft(P(1))], app);

    const first = await page(shop.id);
    expect(first.cards.map((c) => [c.key, c.rows.length])).toEqual([[`${P(1)}|de`, 60]]);
    const second = await page(shop.id, { after: first.nextCursor });
    expect(second.cards.map((c) => [c.key, c.rows.length])).toEqual([[`${P(2)}|de`, 5]]);
    expect(second.from).toBe(61);
    const third = await page(shop.id, { after: second.nextCursor });
    expect(third.cards.map((c) => [c.key, c.rows.length, c.continued, c.continues])).toEqual([[`${P(3)}|de`, 100, false, true]]);
    const fourth = await page(shop.id, { after: third.nextCursor });
    expect(fourth.cards.map((c) => [c.key, c.rows.length, c.continued, c.continues])).toEqual([[`${P(3)}|de`, 30, true, false]]);
    expect(fourth.nextCursor).toBeNull();
    expect(fourth.from).toBe(166);
  });

  it("puts an image or custom field without a stored owner in its owner's card through the coverage scan", async () => {
    const shop = await newShop();
    const smart = await job(shop.id, "MEDIA_IMAGE");
    const productJob = await job(shop.id, "PRODUCT");
    await coverageItem(shop.id, "gid://shopify/MediaImage/9", "MEDIA_IMAGE", P(1));
    await coverageItem(shop.id, "gid://shopify/CollectionImage/5", "COLLECTION_IMAGE", C(1));
    await coverageItem(shop.id, "gid://shopify/Metafield/7", "PRODUCT_METAFIELD", P(1));
    await coverageItem(shop.id, "gid://shopify/MediaImage/11", "MEDIA_IMAGE", P(2));
    await saveDrafts(
      shop.id,
      [
        draft(P(1)),
        // A smart check of the image itself, and an import: neither stored its owner.
        draft("gid://shopify/MediaImage/9", { key: "alt", jobId: smart.id }),
        draft("gid://shopify/CollectionImage/5", { key: "alt", provider: "csv" }),
        draft("gid://shopify/Metafield/7", { key: "value", provider: "csv" }),
        // A product job's own text is never looked up (its GID is its card).
        draft("gid://shopify/MediaImage/11", { key: "alt", jobId: productJob.id }),
      ],
      app,
    );
    const result = await page(shop.id);
    const cards = Object.fromEntries(result.cards.map((c) => [c.key, c.rows.map((r) => [r.resourceGid, r.ownType])]));
    expect(cards).toEqual({
      [`${P(1)}|de`]: [
        [P(1), "PRODUCT"],
        ["gid://shopify/MediaImage/9", "MEDIA_IMAGE"],
        ["gid://shopify/Metafield/7", "PRODUCT_METAFIELD"],
      ],
      [`${C(1)}|de`]: [["gid://shopify/CollectionImage/5", "COLLECTION_IMAGE"]],
      ["gid://shopify/MediaImage/11|de"]: [["gid://shopify/MediaImage/11", "MEDIA_IMAGE"]],
    });
  });
});

describe("paging", () => {
  it("shows every pending draft exactly once while texts are decided between page loads", async () => {
    const shop = await newShop();
    // 80 products in two languages with 1 to 9 texts each (custom fields after the name).
    await insertDrafts(
      shop.id,
      `INSERT INTO "TranslationDraft" ("shopId","resourceGid","parentGid","locale","key","sourceDigest","sourceValue","value","status","updatedAt")
       SELECT $1::uuid,
              CASE WHEN g = 1 THEN 'gid://shopify/Product/' || p ELSE 'gid://shopify/Metafield/' || (p * 100 + g) END,
              CASE WHEN g = 1 THEN NULL ELSE 'gid://shopify/Product/' || p END,
              l, CASE WHEN g = 1 THEN 'title' ELSE 'value' END, md5(p || '-' || g), 'Text ' || g, 'Text ' || g, 'PENDING', now()
       FROM generate_series(1, 80) p, generate_series(1, 1 + p % 9) g, unnest(ARRAY['de', 'fr']) l`,
      shop.id,
    );
    const all = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id }, select: { id: true } }), app);
    const everything = new Set(all.map((d) => d.id));
    const seen: string[] = [];
    const decidedUnseen = new Set<string>();
    let after: string | null = null;
    let pages = 0;
    let rotate = 0;
    do {
      const result = await page(shop.id, { after });
      const shown = ids(result);
      seen.push(...shown);
      after = result.nextCursor;
      pages++;
      // The merchant decides texts on this page (the last one too: the next page starts after it all the same)…
      const onPage = [...shown.slice(0, 2), shown[shown.length - 1]!];
      // …and, in another tab, texts of later pages.
      const pending = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id, status: "PENDING" }, select: { id: true }, orderBy: { id: "asc" } }), app);
      const unseen = pending.map((d) => d.id).filter((id) => !seen.includes(id));
      const later = unseen.filter((_, i) => (i + rotate) % 37 === 0).slice(0, 4);
      rotate++;
      for (const id of later) decidedUnseen.add(id);
      await withTenant(
        shop.id,
        async (tx) => {
          await tx.translationDraft.updateMany({ where: { shopId: shop.id, id: { in: [...onPage, ...later].slice(0, 3) } }, data: { status: "PUBLISHED" } });
          await tx.translationDraft.updateMany({ where: { shopId: shop.id, id: { in: [...onPage, ...later].slice(3) } }, data: { status: "REJECTED" } });
        },
        app,
      );
    } while (after && pages < 200);

    expect(pages).toBeGreaterThan(10);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of seen) expect(decidedUnseen.has(id)).toBe(false);
    expect(new Set([...seen, ...decidedUnseen])).toEqual(everything);
  });

  it("opens a page quickly with 20,000 waiting texts", async () => {
    const shop = await newShop();
    await insertDrafts(
      shop.id,
      `INSERT INTO "TranslationDraft" ("shopId","resourceGid","resourceTitle","locale","key","sourceDigest","sourceValue","value","status","updatedAt")
       SELECT $1::uuid, 'gid://shopify/Product/' || (g / 4), 'Product ' || (g / 4), (ARRAY['de','fr'])[1 + (g / 2) % 2], (ARRAY['title','body_html'])[1 + g % 2],
              md5(g::text), 'Warm jacket ' || g, 'Warme Jacke ' || g, 'PENDING', now()
       FROM generate_series(0, 19999) g`,
      shop.id,
    );
    const timed = async <T>(fn: () => Promise<T>) => {
      const started = performance.now();
      const value = await fn();
      return { value, ms: performance.now() - started };
    };
    const first = await timed(() => page(shop.id));
    expect(first.value.matching).toBe(20_000);
    expect(first.ms).toBeLessThan(3_000);
    const middle = await withTenant(shop.id, (tx) => tx.translationDraft.findFirst({ where: { shopId: shop.id, resourceGid: P(2500), locale: "fr", key: "body_html" } }), app);
    const later = await timed(() => page(shop.id, { after: middle!.id }));
    expect(later.value.from).toBeGreaterThan(9_000);
    expect(later.ms).toBeLessThan(3_000);
    const filtered = await timed(() => page(shop.id, { locale: "fr", area: "products", search: "Jacke 19998" }));
    expect(ids(filtered.value)).toHaveLength(1);
    expect(filtered.ms).toBeLessThan(3_000);
  });
});

/** A measured store with texts of many areas waiting in German. */
async function measuredShop() {
  const store = new FakeShopifyStore(3).addCollections(2).addContent(1);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "de", name: "German", primary: false, published: true },
    { locale: "fr", name: "French", primary: false, published: true },
  ];
  const image = store.addImage(P(1), "Red wool jacket, front view", "jacket");
  const banner = store.addImage(C(1), "Winter collection banner", "mountains");
  const care = store.addMetafield(P(1), { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold.", name: "Care" });
  const menu = store.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
  const link = store.addResource("MENU", "2", [{ key: "title", value: "Footer", type: "SINGLE_LINE_TEXT_FIELD" }]);
  const shop = await newShop();
  const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:cards", pageSize: 50 };
  const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: null, idempotencyKey: `measure-${++n}` }, app);
  let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
  while (next) next = await runCoveragePage(deps, next);

  const field = (gid: string, key: string) => store.products.get(gid)!.find((f) => f.key === key)!.value;
  const productJob = await job(shop.id, "PRODUCT");
  const menuJob = await job(shop.id, "MENU");
  const texts = [
    draft(P(1), { source: field(P(1), "title"), jobId: productJob.id, title: "Product 1 jacket" }),
    draft(P(1), { key: "body_html", source: field(P(1), "body_html"), jobId: productJob.id, issues: [{ code: "NUMBERS_CHANGED", severity: "warning", detail: "source [1] target [2]" }] }),
    draft(image, { key: "alt", source: field(image, "alt"), parentGid: P(1), jobId: productJob.id, title: "Product 1 jacket · Image" }),
    draft(care, { key: "value", source: field(care, "value"), parentGid: P(1), jobId: productJob.id, title: "Product 1 jacket · Care (custom field)" }),
    // Imports know no owner and no type: the coverage scan does.
    draft(banner, { key: "alt", source: field(banner, "alt"), provider: "csv" }),
    draft(menu, { source: field(menu, "title"), provider: "csv", value: "Hauptmenü" }),
    draft(C(1), { source: field(C(1), "title"), provider: "csv", title: "Collection 1 winter" }),
    draft(C(2), { source: field(C(2), "title"), jobId: null }),
    draft("gid://shopify/Page/1", { source: field("gid://shopify/Page/1", "title") }),
    draft("gid://shopify/Article/1", { source: field("gid://shopify/Article/1", "title") }),
    draft(P(2), { key: "handle", source: field(P(2), "handle"), provider: "csv", value: "produkt-2" }),
    draft(P(3), { source: field(P(3), "title"), locale: "fr" }),
  ];
  await saveDrafts(shop.id, texts, app);
  // A menu text from a content-type job: its type comes from the job.
  await saveDrafts(shop.id, [draft(link, { source: field(link, "title"), jobId: menuJob.id })], app);
  return { store, shop, image, banner, care, menu, link, productJob, menuJob };
}

describe("counts and filters", () => {
  it("adds the area chips up to the total and matches the language page's waiting texts per category", async () => {
    const { store, shop } = await measuredShop();
    const { facets } = await page(shop.id, { locale: "de" });
    expect(facets.languages.sort((a, b) => a.locale.localeCompare(b.locale))).toEqual([
      { locale: "de", count: 12 },
      { locale: "fr", count: 1 },
    ]);
    expect(facets.total).toBe(13);
    expect(facets.areas.reduce((sum, a) => sum + a.count, 0)).toBe(12);
    expect(facets.areas).toEqual([
      { area: "products", count: 2 },
      { area: "collections", count: 2 },
      { area: "navigation", count: 2 },
      { area: "customFields", count: 1 },
      { area: "pages", count: 1 },
      { area: "blog", count: 1 },
      { area: "images", count: 2 },
      { area: "urls", count: 1 },
    ]);
    expect(facets.flagged).toBe(1);

    const language = await loadLanguagePage(store.asAdmin(), shop, "de", app, { jobsAvailable: true, aiAvailable: true });
    for (const id of CATEGORY_IDS) {
      const waiting = language.categories.find((c) => c.id === id)!.review?.count ?? 0;
      expect(facets.areas.find((a) => a.area === id)?.count ?? 0, id).toBe(waiting);
    }
  });

  it("filters by area (content types by their job or the coverage scan), notes, text and job", async () => {
    const { shop, image, banner, care, menu, link, productJob, menuJob } = await measuredShop();
    const rowsOf = (result: Awaited<ReturnType<typeof page>>) => result.cards.flatMap((c) => c.rows.map((r) => `${c.key} ${r.resourceGid} ${r.key}`));

    // A collection's image: coverage scans store no owner for images, so an imported one is a card of its own.
    expect(rowsOf(await page(shop.id, { locale: "de", area: "images" }))).toEqual([`${P(1)}|de ${image} alt`, `${banner}|de ${banner} alt`]);
    expect(rowsOf(await page(shop.id, { locale: "de", area: "navigation" }))).toEqual([`${menu}|de ${menu} title`, `${link}|de ${link} title`]);
    expect(rowsOf(await page(shop.id, { area: "urls" }))).toEqual([`${P(2)}|de ${P(2)} handle`]);
    expect(rowsOf(await page(shop.id, { area: "products" }))).toEqual([`${P(1)}|de ${P(1)} title`, `${P(1)}|de ${P(1)} body_html`, `${P(3)}|fr ${P(3)} title`]);
    expect(rowsOf(await page(shop.id, { area: "theme" }))).toEqual([]);

    const flagged = await page(shop.id, { flagged: true });
    expect(rowsOf(flagged)).toEqual([`${P(1)}|de ${P(1)} body_html`]);

    // Two characters: scanned; three or more: the indexed search. Title, original and translation.
    expect(rowsOf(await page(shop.id, { search: "Ha" }))).toEqual(expect.arrayContaining([`${menu}|de ${menu} title`]));
    for (const text of ["Haupt", "main MENU", "Product 1 jacket"]) {
      const found = await page(shop.id, { search: text });
      expect(found.matching, text).toBeGreaterThan(0);
      for (const card of found.cards) {
        for (const row of card.rows) {
          const d = row.draft;
          expect(`${d.resourceTitle ?? ""}\u0001${d.sourceValue}\u0001${d.value}`.toLowerCase(), text).toContain(text.toLowerCase());
        }
      }
    }
    expect((await page(shop.id, { search: "zzz-nothing" })).matching).toBe(0);

    const byJob = await page(shop.id, { jobId: productJob.id });
    expect(byJob.facets.total).toBe(4);
    expect(rowsOf(byJob)).toEqual([`${P(1)}|de ${P(1)} title`, `${P(1)}|de ${P(1)} body_html`, `${P(1)}|de ${image} alt`, `${P(1)}|de ${care} value`]);
    expect((await page(shop.id, { jobId: menuJob.id })).facets.total).toBe(1);
  });

  it("drops an unknown or another shop's job, keeps the old type parameter, and loads the page's data", async () => {
    const { shop, productJob } = await measuredShop();
    const other = await newShop();
    const foreign = await job(other.id, "PRODUCT");
    const data = await loadReviewPage(shop.id, new URLSearchParams({ job: foreign.id, type: "COLLECTION" }), app);
    expect(data.filter).toMatchObject({ jobId: null, area: "collections" });
    expect(data.job).toBeNull();
    expect(data.page.cards.map((c) => c.title)).toEqual(["Collection 1 winter", null]);
    const own = await loadReviewPage(shop.id, new URLSearchParams({ job: productJob.id }), app);
    expect(own.job).toMatchObject({ resourceType: "PRODUCT", targetLocale: "de" });
    expect(own.page).toMatchObject({ size: 4, matching: 4, from: 1, to: 4, nextCursor: null, isFirstPage: true });
    expect(own.page.cards[0]).toMatchObject({ title: "Product 1 jacket", area: "products", href: "/app/products/1?lang=de" });
    expect(own.page.cards[0]!.drafts.map((d) => [d.key, d.kind, d.area])).toEqual([
      ["title", "plain", "products"],
      ["body_html", "html", "products"],
      ["alt", "plain", "images"],
      ["value", "plain", "customFields"],
    ]);
  });

  it("computes in SQL what review-order.ts and review-areas.ts compute", async () => {
    const { shop } = await measuredShop();
    const [drafts, jobs, coverage] = await withTenant(
      shop.id,
      (tx) =>
        Promise.all([
          tx.translationDraft.findMany({ where: { shopId: shop.id } }),
          tx.translationJob.findMany({ where: { shopId: shop.id } }),
          tx.coverageItem.findMany({ where: { shopId: shop.id }, select: { resourceGid: true, locale: true, resourceType: true, parentGid: true } }),
        ]),
      app,
    );
    const jobType = new Map(jobs.map((j) => [j.id, j.resourceType]));
    const covered = new Map(coverage.map((c) => [`${c.resourceGid}|${c.locale}`, c]));
    const result = await page(shop.id);
    const rows = result.cards.flatMap((c) => c.rows);
    expect(rows).toHaveLength(drafts.length);
    for (const row of rows) {
      const d = drafts.find((x) => x.id === row.id)!;
      const cov = covered.get(`${d.resourceGid}|${d.locale}`) ?? null;
      const type = ownType({ resourceGid: d.resourceGid, parentGid: d.parentGid }, d.jobId ? (jobType.get(d.jobId) ?? null) : null, cov?.resourceType ?? null);
      expect(row.ownType, d.resourceGid).toBe(type);
      expect(row.cardGid).toBe(cardGidOf(d.resourceGid, row.owner));
      expect(row.typeRank).toBe(typeRank(row.cardGid));
      expect(row.idLen).toBe(idLength(row.cardGid));
      expect(row.fieldRank).toBe(fieldRank(d.key, row.owner !== null));
    }
  });
});
