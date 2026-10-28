/**
 * Image alt text and custom fields in bulk jobs (when the merchant includes
 * them): drafts linked to their product, the same protection and review
 * rules as the product's own fields, publishing after approval, and nothing
 * included unless asked for.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { approveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "attached-bulk.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(2);
  const image = store.addImage(P1, "Red wool jacket, front view");
  const care = store.addMetafield(P1, { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
  const rich = store.addMetafield(P1, {
    namespace: "custom",
    key: "details",
    type: "rich_text_field",
    value: JSON.stringify({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Soft " }, { type: "text", value: "merino", bold: true }, { type: "text", value: "." }] }] }),
  });
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:attached" };
  return { shop, store, image, care, rich, provider, deps };
}

async function runJob(deps: JobDependencies, shopId: string, options: { includeAttached?: boolean; fieldScope?: "ALL" | "SEO" }, key: string) {
  const { job } = await createBulkJob({ shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: key, ...options }, app);
  const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
  const outcomes = [];
  for (const itemId of page.itemIds) outcomes.push(await processItem(deps, { shopId, itemId }, 1));
  return { job, itemIds: page.itemIds, outcomes };
}

describe("image alt text and custom fields in bulk jobs", () => {
  it("are left out unless the merchant includes them", async () => {
    const { shop, store, image, care, deps } = await setup();
    const { job } = await runJob(deps, shop.id, {}, "a-1");
    expect(job.includeAttached).toBe(false);
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.map((d) => d.resourceGid)).not.toContain(image);
    expect(drafts.map((d) => d.resourceGid)).not.toContain(care);
    expect(store.translationOf(image, "de", "alt")).toBeUndefined();
  });

  it("become drafts linked to their product, with a context for the AI, and publish after approval", async () => {
    const { shop, store, image, care, rich, provider, deps } = await setup();
    const { job } = await runJob(deps, shop.id, { includeAttached: true }, "a-2");
    expect(job.includeAttached).toBe(true);

    const { drafts } = await searchPendingDrafts(shop.id, { resourceType: "PRODUCT" }, app);
    const alt = drafts.find((d) => d.resourceGid === image)!;
    const mf = drafts.find((d) => d.resourceGid === care)!;
    expect(alt).toMatchObject({ parentGid: P1, key: "alt", value: "[de] Red wool jacket, front view", resourceTitle: "Product 1 jacket · Image" });
    expect(mf).toMatchObject({ parentGid: P1, key: "value", value: "[de] Hand wash cold.", resourceTitle: "Product 1 jacket · Care (custom field)" });
    // Rich text keeps its structure: only the words are translated.
    const richDraft = drafts.find((d) => d.resourceGid === rich)!;
    expect(JSON.parse(richDraft.value)).toEqual({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "[de] Soft " }, { type: "text", value: "merino", bold: true }, { type: "text", value: "." }] }],
    });
    expect(provider.requests.some((r) => r.context === "Image description (alt text) of: Product 1 jacket")).toBe(true);
    // Nothing is published without review.
    expect(store.translationOf(image, "de", "alt")).toBeUndefined();

    const result = await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "7", draftIds: [alt.id, mf.id] }, app);
    expect(result).toMatchObject({ published: 2, failed: 0, stale: 0 });
    expect(store.translationOf(image, "de", "alt")).toBe("[de] Red wool jacket, front view");
    expect(store.translationOf(care, "de", "value")).toBe("[de] Hand wash cold.");
  });

  it("lists of links become drafts that keep their addresses; an edit on approval can't change them", async () => {
    const { shop, store, deps } = await setup();
    const links = store.addMetafield(P1, {
      namespace: "custom",
      key: "guides",
      type: "list.link",
      value: '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]',
    });
    await runJob(deps, shop.id, { includeAttached: true }, "a-links");
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    const draft = drafts.find((d) => d.resourceGid === links)!;
    // The type is kept for Review's display; publishing checks Shopify's own type.
    expect(draft).toMatchObject({ valueType: "LIST_LINK", parentGid: P1 });
    expect(JSON.parse(draft.value)).toEqual([
      { text: "[de] Care guide", url: "https://example.com/care" },
      { text: "[de] Size chart", url: "/pages/sizes" },
    ]);

    // An edit posted with approval that points a link elsewhere is refused; nothing is published.
    const tampered = draft.value.replace("https://example.com/care", "https://evil.example/");
    const refused = await approveDrafts(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "7", draftIds: [draft.id], edits: new Map([[draft.id, tampered]]) },
      app,
    );
    expect(refused).toMatchObject({ published: 0, failed: 1 });
    expect(store.translationOf(links, "de", "value")).toBeUndefined();

    // As translated, it publishes.
    expect(await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "7", draftIds: [draft.id] }, app)).toMatchObject({ published: 1 });
    expect(store.translationOf(links, "de", "value")).toBe(draft.value);
  });

  it("checks every product, also those whose own fields are done", async () => {
    const { shop, store, deps } = await setup();
    // Product 2's own fields are translated; only its new image needs work.
    for (const field of store.products.get(P2)!) store.translate(P2, "de", field.key, `DE ${field.value}`);
    const img2 = store.addImage(P2, "Blue jacket, back view");
    const withoutAttached = await runJob(deps, shop.id, {}, "a-3");
    expect(withoutAttached.itemIds).toHaveLength(1); // only product 1
    const withAttached = await runJob(deps, shop.id, { includeAttached: true }, "a-4");
    expect(withAttached.itemIds).toHaveLength(2);
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.find((d) => d.resourceGid === img2)).toMatchObject({ parentGid: P2, value: "[de] Blue jacket, back view" });
  });

  it("keep a person's outdated alt text unless replacing it was allowed", async () => {
    const { shop, store, image, deps } = await setup();
    const digest = createHash("sha256").update("Red wool jacket, front view").digest("hex");
    await saveResourceTranslations(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "1", resourceId: image, locale: "de", edits: [{ key: "alt", value: "Rote Wolljacke", digest, origin: "MANUAL", approved: true }] },
      app,
    );
    store.updateSource(image, "alt", "Red wool jacket, front view, new photo");
    await runJob(deps, shop.id, { includeAttached: true }, "a-5");
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.some((d) => d.resourceGid === image)).toBe(false);
    expect(store.translationOf(image, "de", "alt")).toBe("Rote Wolljacke");
  });

  it("with automatic publishing, publish clean results and keep flagged ones for review", async () => {
    const { shop, store, image, care, deps } = await setup();
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    await runJob(deps, shop.id, { includeAttached: true }, "a-6");
    expect(store.translationOf(image, "de", "alt")).toBe("[de] Red wool jacket, front view");
    expect(store.translationOf(care, "de", "value")).toBe("[de] Hand wash cold.");
  });

  it("are never included in search-listing-only jobs", async () => {
    const { shop, deps } = await setup();
    const { job } = await runJob(deps, shop.id, { includeAttached: true, fieldScope: "SEO" }, "a-7");
    expect(job.includeAttached).toBe(false);
  });

  it("stay within their store: another store can't see or approve them", async () => {
    const { shop, store, image, deps } = await setup();
    await runJob(deps, shop.id, { includeAttached: true }, "a-8");
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    const ids = drafts.filter((d) => d.parentGid).map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);

    const { shop: other } = await upsertInstalledShop({ shopDomain: "other-attached.myshopify.com" }, app);
    expect((await searchPendingDrafts(other.id, { resourceType: "PRODUCT" }, app)).total).toBe(0);
    const result = await approveDrafts({ admin: store.asAdmin(), shopId: other.id, actorId: "9", draftIds: ids }, app);
    expect(result.published).toBe(0);
    expect(store.translationOf(image, "de", "alt")).toBeUndefined();
  });
});
