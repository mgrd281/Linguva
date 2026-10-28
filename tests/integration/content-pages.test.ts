import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { searchPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { loadEditorData, runEditorAction } from "../../app/.server/translation/resource-editor";
import { editorPath, resourceGid } from "../../app/lib/resource-kinds";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
let n = 0;
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(mode: "DRAFT" | "AUTO_PUBLISH") {
  const { shop } = await upsertInstalledShop({ shopDomain: "content.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (mode === "AUTO_PUBLISH") await setBulkPublishMode({ shopId: shop.id, mode, confirmed: true, actorId: "1" }, app);
  const store = new FakeShopifyStore(2).addContent(3);
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:content" };
  return { shop, store, provider, deps };
}

async function runJob(deps: JobDependencies, shopId: string, resourceType: "PAGE" | "ARTICLE" | "BLOG") {
  const { job } = await createBulkJob({ shopId, resourceType, targetLocale: "de", requestedBy: null, idempotencyKey: `c-${++n}` }, app);
  const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
  for (const id of page.itemIds) await processItem(deps, { shopId, itemId: id }, 1);
  return page.itemIds.length;
}

describe("pages, blog posts and blogs", () => {
  it("bulk-translates each content type separately, keeping markup and never handles", async () => {
    const { shop, store, provider, deps } = await setup("AUTO_PUBLISH");
    expect(await runJob(deps, shop.id, "PAGE")).toBe(3);
    expect(store.translationOf("gid://shopify/Page/1", "de", "body_html")).toBe("<p>[de] We make <strong>warm</strong> clothes since 1991.</p>");
    expect(store.translationOf("gid://shopify/Page/1", "de", "handle")).toBeUndefined();
    expect(store.translationOf("gid://shopify/Article/1", "de", "title")).toBeUndefined();

    expect(await runJob(deps, shop.id, "ARTICLE")).toBe(3);
    expect(store.translationOf("gid://shopify/Article/2", "de", "summary_html")).toBe("<p>[de] Wool care tips 2.</p>");
    expect(await runJob(deps, shop.id, "BLOG")).toBe(3);
    expect(store.translationOf("gid://shopify/Blog/3", "de", "title")).toBe("[de] Journal 3");
    expect(store.translationOf("gid://shopify/Product/1", "de", "title")).toBeUndefined();
    expect(provider.requests.some((r) => r.context === "Article: How to wash wool 1")).toBe(true);
  });

  it("opens a blog post in the editor and links drafts to the right editor", async () => {
    const { shop, store, deps } = await setup("DRAFT");
    await runJob(deps, shop.id, "ARTICLE");
    const { drafts } = await searchPendingDrafts(shop.id, { resourceType: "ARTICLE" }, app);
    expect(drafts.length).toBe(9); // title, body, summary × 3
    expect(editorPath(drafts[0]!.resourceGid, "de")).toMatch(/^\/app\/articles\/\d+\?lang=de$/);
    expect((await searchPendingDrafts(shop.id, { resourceType: "PAGE" }, app)).total).toBe(0);

    const ctx = {
      admin: store.asAdmin(),
      shopId: shop.id,
      actorId: "9",
      kind: "ARTICLE" as const,
      resourceId: resourceGid("ARTICLE", "1")!,
      target: { locale: "de", name: "German", rtl: false },
      sourceName: "English",
    };
    const data = await loadEditorData(ctx);
    expect(data.kind).toMatchObject({ label: "Blog posts", singular: "blog post" });
    const summary = data.fields.find((f) => f.key === "summary_html")!;
    expect(summary.label).toBe("Summary");
    const form = new FormData();
    form.set("intent", "save");
    form.set("value:title", "Wolle richtig waschen");
    form.set("digest:title", data.fields.find((f) => f.key === "title")!.digest);
    await runEditorAction(ctx, form);
    expect(store.translationOf("gid://shopify/Article/1", "de", "title")).toBe("Wolle richtig waschen");
  });
});
