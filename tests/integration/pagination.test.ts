import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listJobsPage } from "../../app/.server/jobs/bulk-jobs";
import { escapeLike, listDraftLocales, searchPendingDrafts } from "../../app/.server/review/drafts";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const shop = async (domain: string) => (await upsertInstalledShop({ shopDomain: domain }, app)).shop;
const STATUSES = ["COMPLETED", "FAILED", "RUNNING", "CANCELLED"] as const;

async function seedJobs(shopId: string, count: number) {
  const base = Date.UTC(2026, 9, 1);
  await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          shopId,
          resourceType: i % 3 === 0 ? "COLLECTION" : "PRODUCT",
          targetLocale: i % 2 ? "de" : "fr",
          status: STATUSES[i % 4],
          idempotencyKey: `seed-${i}`,
          // Some jobs share a timestamp: the id breaks ties.
          createdAt: new Date(base + Math.floor(i / 2) * 60_000),
        })),
      }),
    app,
  );
}

async function allPages<T extends { id: string }>(load: (cursor: string | null) => Promise<{ items: T[]; next: string | null }>) {
  const seen: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const page = await load(cursor);
    seen.push(...page.items);
    if (!page.next) break;
    cursor = page.next;
  }
  return seen;
}

describe("jobs pagination and filters", () => {
  it("returns every job exactly once, newest first, across pages", async () => {
    const s = await shop("jobs-pages.myshopify.com");
    await seedJobs(s.id, 61);
    const seen = await allPages(async (cursor) => {
      const page = await listJobsPage(s.id, { cursor, take: 25 }, app);
      return { items: page.jobs, next: page.nextCursor };
    });
    expect(seen).toHaveLength(61);
    expect(new Set(seen.map((j) => j.id)).size).toBe(61);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(seen[i]!.createdAt.getTime());
    }
  });

  it("filters by status group, language and content type", async () => {
    const s = await shop("jobs-filter.myshopify.com");
    await seedJobs(s.id, 40);
    const failed = await listJobsPage(s.id, { status: "failed", take: 100 }, app);
    expect(failed.jobs.length).toBe(10);
    expect(failed.jobs.every((j) => j.status === "FAILED")).toBe(true);
    const active = await listJobsPage(s.id, { status: "active", locale: "de", take: 100 }, app);
    expect(active.jobs.every((j) => j.status === "RUNNING" && j.targetLocale === "de")).toBe(true);
    const collections = await listJobsPage(s.id, { resourceType: "COLLECTION", take: 100 }, app);
    expect(collections.jobs.length).toBe(14);
    // Unknown filter values are ignored, not passed to the database.
    expect((await listJobsPage(s.id, { status: "drop table", resourceType: "METAFIELD", take: 100 }, app)).jobs).toHaveLength(40);
    expect((await listJobsPage(s.id, { cursor: "not-a-uuid", take: 5 }, app)).jobs).toHaveLength(5);
  });

  it("never pages into another shop's jobs with a foreign cursor", async () => {
    const a = await shop("jobs-a.myshopify.com");
    const b = await shop("jobs-b.myshopify.com");
    await seedJobs(a.id, 5);
    await seedJobs(b.id, 5);
    const foreign = (await listJobsPage(a.id, { take: 1 }, app)).jobs[0]!.id;
    const page = await listJobsPage(b.id, { cursor: foreign, take: 25 }, app);
    expect(page.jobs.every((j) => j.shopId === b.id)).toBe(true);
  });
});

async function seedDrafts(shopId: string, count: number) {
  const keys = ["title", "body_html", "meta_title", "meta_description", "handle"];
  await withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          shopId,
          resourceGid: `gid://shopify/${i % 4 === 0 ? "Collection" : "Product"}/${Math.floor(i / 5) + 1}`,
          resourceTitle: i % 7 === 0 ? `Wool coat ${i}` : `Item ${i}`,
          locale: ["de", "fr", "ar"][i % 3]!,
          key: keys[i % 5]!,
          sourceDigest: "d",
          sourceValue: i === 3 ? "Contains 100% cotton" : i === 4 ? "snake_case value" : `Source ${i}`,
          value: `Ziel ${i}`,
          issues: i % 6 === 0 ? [{ code: "SEO_TOO_LONG", severity: "warning" }] : [],
        })),
        skipDuplicates: true,
      }),
    app,
  );
}

describe("review pagination, filters and search", () => {
  it("returns every pending draft exactly once across pages", async () => {
    const s = await shop("drafts-pages.myshopify.com");
    await seedDrafts(s.id, 130);
    const total = await withTenant(s.id, (tx) => tx.translationDraft.count(), app);
    const seen = await allPages(async (cursor) => {
      const page = await searchPendingDrafts(s.id, { cursor, take: 50 }, app);
      return { items: page.drafts, next: page.nextCursor };
    });
    expect(seen).toHaveLength(total);
    expect(new Set(seen.map((d) => d.id)).size).toBe(total);
  });

  it("filters by language, field group, type and warnings", async () => {
    const s = await shop("drafts-filter.myshopify.com");
    await seedDrafts(s.id, 120);
    const seo = await searchPendingDrafts(s.id, { group: "seo", take: 100 }, app);
    expect(seo.drafts.every((d) => d.key === "meta_title" || d.key === "meta_description")).toBe(true);
    expect(seo.total).toBeGreaterThan(0);
    const content = await searchPendingDrafts(s.id, { group: "content", take: 100 }, app);
    expect(content.drafts.every((d) => d.key === "title" || d.key === "body_html")).toBe(true);
    const collections = await searchPendingDrafts(s.id, { resourceType: "COLLECTION", locale: "ar", take: 100 }, app);
    expect(collections.drafts.every((d) => d.resourceGid.startsWith("gid://shopify/Collection/") && d.locale === "ar")).toBe(true);
    const flagged = await searchPendingDrafts(s.id, { flagged: true, take: 100 }, app);
    expect(flagged.total).toBe(20);
    expect(await listDraftLocales(s.id, app)).toEqual(["ar", "de", "fr"]);
  });

  it("searches title, source and translation, treating % and _ literally", async () => {
    const s = await shop("drafts-search.myshopify.com");
    await seedDrafts(s.id, 60);
    expect((await searchPendingDrafts(s.id, { search: "WOOL COAT" }, app)).total).toBe(9);
    expect((await searchPendingDrafts(s.id, { search: "ziel 42" }, app)).drafts.map((d) => d.value)).toEqual(["Ziel 42"]);
    expect((await searchPendingDrafts(s.id, { search: "100%" }, app)).total).toBe(1);
    expect((await searchPendingDrafts(s.id, { search: "%" }, app)).total).toBe(1);
    expect((await searchPendingDrafts(s.id, { search: "_" }, app)).total).toBe(1);
    expect((await searchPendingDrafts(s.id, { search: "\\" }, app)).total).toBe(0);
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("stays fast with 20,000 pending drafts", async () => {
    const s = await shop("drafts-perf.myshopify.com");
    for (let batch = 0; batch < 4; batch++) {
      await withTenant(
        s.id,
        (tx) =>
          tx.translationDraft.createMany({
            data: Array.from({ length: 5000 }, (_, i) => {
              const n = batch * 5000 + i;
              return {
                shopId: s.id,
                resourceGid: `gid://shopify/Product/${n}`,
                resourceTitle: `Product ${n}`,
                locale: "de",
                key: "title",
                sourceDigest: "d",
                sourceValue: `Source text ${n}`,
                value: `Zieltext ${n}`,
              };
            }),
          }),
        app,
      );
    }
    await ownerDb.$executeRawUnsafe(`ANALYZE "TranslationDraft"`);
    const started = performance.now();
    const page1 = await searchPendingDrafts(s.id, { take: 50 }, app);
    const page2 = await searchPendingDrafts(s.id, { cursor: page1.nextCursor, take: 50 }, app);
    const searched = await searchPendingDrafts(s.id, { search: "zieltext 1999", take: 50 }, app);
    const elapsed = performance.now() - started;
    expect(page1.total).toBe(20_000);
    expect(page2.drafts[0]!.id).not.toBe(page1.drafts[0]!.id);
    expect(searched.total).toBe(11); // 1999 and 19990–19999
    expect(elapsed).toBeLessThan(3000);
  }, 60_000);
});
