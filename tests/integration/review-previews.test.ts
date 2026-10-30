/**
 * Review's pictures (app/.server/review/previews.ts), read after the page:
 * only the shop's own drafts, one page of ids at most, one Shopify call per
 * 100 items, kept a minute, nothing kept when Shopify fails, owners found
 * through the coverage scan, and live titles only where none was stored.
 * (The route authenticates like every route: tests/security/structure.test.ts.)
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveDrafts, type DraftInput } from "../../app/.server/review/drafts";
import { clearReviewPreviewsCache, loadReviewPreviews, previewIds, REVIEW_PREVIEWS_CACHE_MS, REVIEW_PREVIEWS_MAX_IDS } from "../../app/.server/review/previews";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let n = 0;

beforeEach(async () => {
  await resetDatabase();
  clearReviewPreviewsCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

function draft(resourceGid: string, key: string, extra: Partial<DraftInput> = {}): DraftInput {
  return {
    jobId: null,
    resourceGid,
    resourceTitle: null,
    locale: "de",
    key,
    sourceDigest: sha(`${resourceGid} ${key}`),
    sourceValue: `${resourceGid} ${key}`,
    value: "Wert",
    segmentPairs: [],
    issues: [],
    provider: "mock",
    ...extra,
  };
}

async function setup() {
  const store = new FakeShopifyStore(3).addCollections(1);
  const image = store.addImage(P(1), "Red wool jacket", "jacket");
  store.addImage(P(2), "Blue sweater", "sweater");
  const care = store.addMetafield(P(1), { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold.", name: "Care" });
  const { shop } = await upsertInstalledShop({ shopDomain: `previews-${++n}.myshopify.com` }, app);
  await saveDrafts(
    shop.id,
    [
      draft(P(1), "title", { resourceTitle: "Stored title" }),
      draft(image, "alt", { parentGid: P(1), resourceTitle: "Stored title · Image" }),
      draft(care, "value", { parentGid: P(1) }),
      draft(P(2), "title"),
      draft("gid://shopify/Collection/1", "title"),
    ],
    app,
  );
  const all = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id } }), app);
  const id = (gid: string, key: string) => all.find((d) => d.resourceGid === gid && d.key === key)!.id;
  return { store, shop, image, care, all, id };
}

const previewCalls = (store: FakeShopifyStore) => store.calls.filter((c) => c === "LinguvaPreviewNodes").length;

describe("Review's pictures", () => {
  it("gives each text its card's picture, an image text its own, a custom field its name, and a live title only where none was stored", async () => {
    const { store, shop, image, care, all, id } = await setup();
    const result = await loadReviewPreviews(store.asAdmin(), shop.id, all.map((d) => d.id), app);
    expect(result.error).toBe(false);
    const jacket = { url: "https://cdn.example/__fixtures/img/jacket.svg?width=112", alt: "Red wool jacket" };
    expect(result.byDraft[id(P(1), "title")]).toEqual({ card: jacket, own: null, fieldName: null, title: null });
    expect(result.byDraft[id(image, "alt")]).toEqual({ card: jacket, own: { url: "https://cdn.example/__fixtures/img/jacket.svg?width=80", alt: "Red wool jacket" }, fieldName: null, title: null });
    expect(result.byDraft[id(care, "value")]).toMatchObject({ card: jacket, fieldName: "Care", title: null });
    // No stored title: the store's own.
    expect(result.byDraft[id(P(2), "title")]).toMatchObject({ card: { url: expect.stringContaining("sweater.svg?width=112") }, title: "Product 2 jacket" });
    expect(result.byDraft[id("gid://shopify/Collection/1", "title")]).toMatchObject({ card: null, title: "Collection 1 winter" });
    // Products, the collection and the image (nodes), the custom field: one call.
    expect(previewCalls(store)).toBe(1);
  });

  it("finds nothing for another shop's ids and takes UUIDs only, each once, one page at most", async () => {
    const { store, all } = await setup();
    const other = await upsertInstalledShop({ shopDomain: `previews-other-${++n}.myshopify.com` }, app);
    const result = await loadReviewPreviews(store.asAdmin(), other.shop.id, all.map((d) => d.id), app);
    expect(result).toEqual({ byDraft: {}, error: false });
    expect(previewCalls(store)).toBe(0);

    const many = Array.from({ length: 130 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(previewIds([all[0]!.id, all[0]!.id, "not-a-uuid", "1; DROP TABLE", ...many].join(","))).toHaveLength(REVIEW_PREVIEWS_MAX_IDS);
    expect(previewIds(`${all[0]!.id}, not-a-uuid ,${all[0]!.id}`)).toEqual([all[0]!.id]);
    expect(previewIds(null)).toEqual([]);
  });

  it("reads 100 items per Shopify call", async () => {
    const store = new FakeShopifyStore(150);
    const { shop } = await upsertInstalledShop({ shopDomain: `previews-${++n}.myshopify.com` }, app);
    await saveDrafts(shop.id, Array.from({ length: 100 }, (_, i) => draft(P(i + 1), "title")), app);
    const ids = (await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id }, select: { id: true } }), app)).map((d) => d.id);
    await loadReviewPreviews(store.asAdmin(), shop.id, ids, app);
    expect(previewCalls(store)).toBe(1);
    await saveDrafts(shop.id, Array.from({ length: 50 }, (_, i) => draft(P(i + 101), "title")), app);
    const more = (await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id }, select: { id: true }, orderBy: { resourceGid: "desc" } }), app)).map((d) => d.id);
    clearReviewPreviewsCache();
    await loadReviewPreviews(store.asAdmin(), shop.id, more.slice(0, 100), app);
    expect(previewCalls(store)).toBe(2);
  });

  it("keeps what it read for a minute, and nothing when Shopify fails", async () => {
    const { store, shop, all } = await setup();
    const ids = all.map((d) => d.id);
    const now = Date.now();
    await loadReviewPreviews(store.asAdmin(), shop.id, ids, app, now);
    await loadReviewPreviews(store.asAdmin(), shop.id, ids, app, now + REVIEW_PREVIEWS_CACHE_MS - 1);
    expect(previewCalls(store)).toBe(1);
    await loadReviewPreviews(store.asAdmin(), shop.id, ids, app, now + REVIEW_PREVIEWS_CACHE_MS + 1);
    expect(previewCalls(store)).toBe(2);

    clearReviewPreviewsCache();
    store.failNext = { count: 1, error: () => new Error("Shopify is down") };
    const failed = await loadReviewPreviews(store.asAdmin(), shop.id, ids, app, now);
    expect(failed.error).toBe(true);
    expect(Object.values(failed.byDraft).every((p) => p.card === null && p.own === null)).toBe(true);
    const again = await loadReviewPreviews(store.asAdmin(), shop.id, ids, app, now + 1);
    expect(again.error).toBe(false);
    expect(Object.values(again.byDraft).some((p) => p.card !== null)).toBe(true);
  });

  it("finds an image's owner through the coverage scan when its draft didn't store one", async () => {
    const store = new FakeShopifyStore(2);
    const image = store.addImage(P(2), "Blue sweater", "sweater");
    const { shop } = await upsertInstalledShop({ shopDomain: `previews-${++n}.myshopify.com` }, app);
    await saveDrafts(shop.id, [draft(image, "alt", { provider: "csv" })], app);
    const now = new Date();
    await withTenant(
      shop.id,
      (tx) =>
        tx.coverageItem.create({
          data: { shopId: shop.id, locale: "de", resourceType: "MEDIA_IMAGE", resourceGid: image, parentGid: P(2), sourceKeys: [], currentKeys: [], outdatedKeys: [], draftKeys: [], reviewKeys: [], fieldStates: [], syncedAt: now, seenAt: now },
        }),
      app,
    );
    const [only] = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ where: { shopId: shop.id } }), app);
    const result = await loadReviewPreviews(store.asAdmin(), shop.id, [only!.id], app);
    expect(result.byDraft[only!.id]).toMatchObject({
      card: { url: expect.stringContaining("sweater.svg?width=112") },
      own: { url: expect.stringContaining("sweater.svg?width=80") },
      title: "Product 2 jacket",
    });
  });
});
