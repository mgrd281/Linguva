import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { listPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import {
  loadEditorData,
  runEditorAction,
  type EditorContext,
} from "../../app/.server/translation/resource-editor";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DOMAIN = "collections.myshopify.com";
const C1 = "gid://shopify/Collection/1";
const P1 = "gid://shopify/Product/1";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(mode: "DRAFT" | "AUTO_PUBLISH" = "AUTO_PUBLISH") {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (mode === "AUTO_PUBLISH") {
    await setBulkPublishMode({ shopId: shop.id, mode, confirmed: true, actorId: "1" }, app);
  }
  const store = new FakeShopifyStore(3).addCollections(5);
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider,
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test",
    discoveryPageSize: 2,
  };
  return { shop, store, provider, deps };
}

let n = 0;
async function runJob(
  deps: JobDependencies,
  shopId: string,
  resourceType: "PRODUCT" | "COLLECTION",
  options: { overwriteProtected?: boolean } = {},
) {
  const { job } = await createBulkJob(
    {
      shopId,
      resourceType,
      targetLocale: "de",
      requestedBy: null,
      idempotencyKey: `col-${++n}`,
      overwriteProtected: options.overwriteProtected,
    },
    app,
  );
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
    ids.push(...page.itemIds);
    if (!page.hasMore) break;
  }
  for (const id of ids) await processItem(deps, { shopId, itemId: id }, 1);
  return withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
}

const editor = (store: FakeShopifyStore, shopId: string, resourceId = C1): EditorContext => ({
  admin: store.asAdmin(),
  shopId,
  actorId: "501",
  kind: "COLLECTION",
  resourceId,
  target: { locale: "de", name: "German", rtl: false },
  sourceName: "English",
});

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("collection bulk translation", () => {
  it("translates only collections, across discovery pages, and leaves products alone", async () => {
    const { shop, store, provider, deps } = await setup();
    const job = await runJob(deps, shop.id, "COLLECTION");
    expect(job).toMatchObject({ status: "COMPLETED", resourceType: "COLLECTION", totalItems: 5, succeededItems: 5 });
    for (let i = 1; i <= 5; i++) {
      const gid = `gid://shopify/Collection/${i}`;
      expect(store.translationOf(gid, "de", "title")).toBe(`[de] Collection ${i} winter`);
      expect(store.translationOf(gid, "de", "meta_title")).toBe(`[de] Winter collection ${i}`);
      expect(store.translationOf(gid, "de", "body_html")).toBe(`<p>[de] Our <em>winter</em> picks, part ${i}.</p>`);
      // URL handles are never machine-translated.
      expect(store.translationOf(gid, "de", "handle")).toBeUndefined();
    }
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
    // The provider is told what kind of text it translates.
    expect(provider.requests.some((r) => r.context === "Collection: Collection 1 winter")).toBe(true);
  });

  it("keeps a translation made outside Linguva unless replacing it is allowed", async () => {
    const { shop, store, deps } = await setup();
    store.translate(C1, "de", "title", "Winterkollektion (von Hand)");
    store.updateSource(C1, "title", "Collection 1 winter sale");

    const kept = await runJob(deps, shop.id, "COLLECTION");
    expect(kept.protectedSkipped).toBeGreaterThan(0);
    expect(store.translationOf(C1, "de", "title")).toBe("Winterkollektion (von Hand)");

    await runJob(deps, shop.id, "COLLECTION", { overwriteProtected: true });
    expect(store.translationOf(C1, "de", "title")).toBe("[de] Collection 1 winter sale");
    // The value it replaced is kept as history.
    const revisions = await withTenant(
      shop.id,
      (tx) => tx.translationRevision.findMany({ where: { resourceGid: C1, key: "title" }, orderBy: { createdAt: "asc" } }),
      app,
    );
    expect(revisions[0]).toMatchObject({ origin: "EXTERNAL", value: "Winterkollektion (von Hand)" });
  });

  it("creates collection drafts in review mode with the collection title", async () => {
    const { shop, store, deps } = await setup("DRAFT");
    await runJob(deps, shop.id, "COLLECTION");
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    const drafts = await listPendingDrafts(shop.id, {}, app);
    expect(drafts.find((d) => d.resourceGid === C1)).toMatchObject({ resourceTitle: "Collection 1 winter" });
  });

  it("runs a product job and a collection job for the same language side by side", async () => {
    const { shop } = await setup();
    const a = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "pp-1" },
      app,
    );
    const b = await createBulkJob(
      { shopId: shop.id, resourceType: "COLLECTION", targetLocale: "de", requestedBy: null, idempotencyKey: "cc-1" },
      app,
    );
    expect(a.created && b.created).toBe(true);
    expect(a.job.id).not.toBe(b.job.id);
  });

  it("refuses resource types it doesn't support", async () => {
    const { shop } = await setup();
    await expect(
      createBulkJob(
        // @ts-expect-error: not a supported bulk type
        { shopId: shop.id, resourceType: "METAFIELD", targetLocale: "de", requestedBy: null, idempotencyKey: "m-1" },
        app,
      ),
    ).rejects.toThrow(/Unsupported/);
  });
});

describe("collection editor", () => {
  it("loads collection fields and publishes a manual edit with history", async () => {
    const { shop, store } = await setup();
    const ctx = editor(store, shop.id);
    const data = await loadEditorData(ctx);
    expect(data.kind).toMatchObject({ label: "Collections", path: "/app/collections" });
    expect(data.title).toBe("Collection 1 winter");
    const title = data.fields.find((f) => f.key === "title")!;

    const result = await runEditorAction(
      ctx,
      form({ intent: "save", "value:title": "Winterauswahl 1", [`digest:title`]: title.digest }),
    );
    expect(result).toMatchObject({ data: { kind: "saved", outcomes: [{ key: "title", status: "saved" }] } });
    expect(store.translationOf(C1, "de", "title")).toBe("Winterauswahl 1");

    const reloaded = await loadEditorData(ctx);
    const history = reloaded.fields.find((f) => f.key === "title")!.history;
    expect(history[0]).toMatchObject({ value: "Winterauswahl 1", origin: "MANUAL", approved: true });
  });

  it("won't restore a revision of another resource from this page", async () => {
    const { shop, store } = await setup();
    const productEditor = { ...editor(store, shop.id, P1), kind: "PRODUCT" as const };
    const product = await loadEditorData(productEditor);
    const digest = product.fields.find((f) => f.key === "title")!.digest;
    await runEditorAction(productEditor, form({ intent: "save", "value:title": "Jacke", "digest:title": digest }));
    const [revision] = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ where: { resourceGid: P1 } }), app);

    const result = await runEditorAction(editor(store, shop.id), form({ intent: "restore", revisionId: revision!.id }));
    expect(result).toEqual({ kind: "restored", status: "not_found" });
  });

  it("returns 404 for a collection that doesn't exist", async () => {
    const { shop, store } = await setup();
    await expect(loadEditorData(editor(store, shop.id, "gid://shopify/Collection/999"))).rejects.toMatchObject({
      status: 404,
    });
  });
});
