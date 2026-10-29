import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { lookupExact } from "../../app/.server/memory/translation-memory";
import { upsertTerms } from "../../app/.server/glossary/glossary";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import {
  approveDrafts,
  countPendingDrafts,
  listPendingDrafts,
  rejectDrafts,
} from "../../app/.server/review/drafts";
import {
  ConfirmationRequiredError,
  setAiConsent,
  setBulkPublishMode,
} from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { restoreRevision } from "../../app/.server/translation/history";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DOMAIN = "review.myshopify.com";
const P1 = "gid://shopify/Product/1";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(products = 2, mode: "DRAFT" | "AUTO_PUBLISH" = "DRAFT") {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (mode === "AUTO_PUBLISH") {
    await setBulkPublishMode({ shopId: shop.id, mode, confirmed: true, actorId: "1" }, app);
  }
  const store = new FakeShopifyStore(products);
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider,
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test",
  };
  return { shop, store, provider, deps };
}

let jobCounter = 0;
async function runJob(deps: JobDependencies, shopId: string, options: { overwriteProtected?: boolean } = {}) {
  const { job } = await createBulkJob(
    {
      shopId,
      resourceType: "PRODUCT",
      targetLocale: "de",
      requestedBy: null,
      idempotencyKey: `job-${++jobCounter}`,
      overwriteProtected: options.overwriteProtected,
    },
    app,
  );
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
    ids.push(...page.itemIds);
    if (!page.hasMore) break;
  }
  for (const id of ids) await processItem(deps, { shopId, itemId: id }, 1);
  return withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
}

describe("publish mode", () => {
  it("defaults to review and requires explicit confirmation for automatic publishing", async () => {
    const { shop } = await setup();
    await expect(
      setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: false, actorId: "1" }, app),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "77" }, app);
    const settings = await withTenant(shop.id, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    expect(settings).toMatchObject({ bulkPublishMode: "AUTO_PUBLISH", autoPublishEnabledBy: "77" });
    expect(settings.autoPublishEnabledAt).toBeInstanceOf(Date);
    expect(await ownerDb.auditLog.count({ where: { action: "bulk_publish.auto_enabled" } })).toBe(1);
  });
});

describe("bulk review (draft mode)", () => {
  it("creates drafts and publishes nothing until approved", async () => {
    const { shop, store, deps } = await setup(2);
    const job = await runJob(deps, shop.id);
    expect(job).toMatchObject({ status: "COMPLETED", publishMode: "DRAFT", succeededItems: 2 });
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect(await countPendingDrafts(shop.id, app)).toBe(4); // title + body_html per product
    const drafts = await listPendingDrafts(shop.id, { jobId: job.id }, app);
    expect(drafts[0]).toMatchObject({ resourceGid: P1, locale: "de", resourceTitle: "Product 1 jacket" });
  });

  it("doesn't translate the same fields again while drafts wait for review", async () => {
    const { shop, provider, deps } = await setup(1);
    await runJob(deps, shop.id);
    const calls = provider.requests.length;
    const second = await runJob(deps, shop.id);
    expect(second.totalItems).toBe(0);
    expect(provider.requests.length).toBe(calls);
  });

  it("publishes approved drafts as approved translations and remembers them", async () => {
    const { shop, store, deps } = await setup(1);
    await runJob(deps, shop.id);
    const drafts = await listPendingDrafts(shop.id, {}, app);
    const title = drafts.find((d) => d.key === "title")!;
    const body = drafts.find((d) => d.key === "body_html")!;

    const result = await approveDrafts(
      {
        admin: store.asAdmin(),
        shopId: shop.id,
        actorId: "42",
        draftIds: [title.id, body.id],
        edits: new Map([[title.id, "Jacke Nummer 1 (geprüft)"]]),
      },
      app,
    );
    expect(result).toEqual({ published: 2, stale: 0, failed: 0, changed: 0 });
    expect(store.translationOf(P1, "de", "title")).toBe("Jacke Nummer 1 (geprüft)");
    expect(store.translationOf(P1, "de", "body_html")).toBe("<p>[de] Warm <b>jacket</b> number 1.</p>");

    const revisions = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ orderBy: { key: "asc" } }), app);
    expect(revisions.map((r) => [r.key, r.origin, r.approved, r.actorId])).toEqual([
      ["body_html", "AI", true, "42"],
      ["title", "MANUAL", true, "42"],
    ]);
    expect(await countPendingDrafts(shop.id, app)).toBe(0);

    // Approved segments are now in memory as APPROVED.
    const hits = await lookupExact(
      { shopId: shop.id, sourceLocale: "en", targetLocale: "de" },
      ['Warm <g id="1">jacket</g> number 1.', "Product 1 jacket"],
      { allowMachine: false },
      app,
    );
    expect([...hits.values()].map((h) => h.target).sort()).toEqual([
      "Jacke Nummer 1 (geprüft)",
      '[de] Warm <g id="1">jacket</g> number 1.',
    ]);
  });

  it("marks drafts stale instead of publishing when the source changed", async () => {
    const { shop, store, deps } = await setup(1);
    await runJob(deps, shop.id);
    store.updateSource(P1, "title", "Renamed jacket");
    const drafts = await listPendingDrafts(shop.id, {}, app);
    const result = await approveDrafts(
      { admin: store.asAdmin(), shopId: shop.id, actorId: null, draftIds: drafts.map((d) => d.id) },
      app,
    );
    expect(result).toEqual({ published: 1, stale: 1, failed: 0, changed: 0 });
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
  });

  it("marks drafts stale when their product was deleted in Shopify, and still publishes the others", async () => {
    const { shop, store, deps } = await setup(2);
    await runJob(deps, shop.id);
    store.products.delete(P1);
    const drafts = await listPendingDrafts(shop.id, {}, app);
    const result = await approveDrafts(
      { admin: store.asAdmin(), shopId: shop.id, actorId: null, draftIds: drafts.map((d) => d.id) },
      app,
    );
    const p1 = drafts.filter((d) => d.resourceGid === P1).length;
    expect(p1).toBeGreaterThan(0);
    expect(result).toEqual({ published: drafts.length - p1, stale: p1, failed: 0, changed: 0 });
  });

  it("rejects drafts without publishing", async () => {
    const { shop, store, deps } = await setup(1);
    await runJob(deps, shop.id);
    const drafts = await listPendingDrafts(shop.id, {}, app);
    expect(await rejectDrafts(shop.id, drafts.map((d) => d.id), "42", app)).toBe(2);
    expect(await countPendingDrafts(shop.id, app)).toBe(0);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
  });
});

describe("protection of manual and approved translations", () => {
  async function digestOf(store: FakeShopifyStore, key: string) {
    const response = await store.graphql("query LinguvaTranslatableResource", { variables: { resourceId: P1, locale: "de" } });
    const body = (await response.json()) as { data: { translatableResource: { translatableContent: Array<{ key: string; digest: string }> } } };
    return body.data.translatableResource.translatableContent.find((c) => c.key === key)!.digest;
  }

  it("keeps an outdated manual translation unless overwriting is explicitly allowed", async () => {
    const { shop, store, deps } = await setup(1, "AUTO_PUBLISH");
    await saveResourceTranslations(
      {
        admin: store.asAdmin(),
        shopId: shop.id,
        actorId: "42",
        resourceId: P1,
        locale: "de",
        edits: [{ key: "title", value: "Meine Jacke", digest: await digestOf(store, "title"), origin: "MANUAL", approved: true }],
      },
      app,
    );
    store.updateSource(P1, "title", "Product 1 winter jacket"); // now outdated

    const job = await runJob(deps, shop.id);
    expect(job.protectedSkipped).toBe(1);
    expect(store.translationOf(P1, "de", "title")).toBe("Meine Jacke");

    await runJob(deps, shop.id, { overwriteProtected: true });
    expect(store.translationOf(P1, "de", "title")).toBe("[de] Product 1 winter jacket");
  });

  it("protects translations made outside Linguva and keeps them as a revision when replaced", async () => {
    const { shop, store, deps } = await setup(1, "AUTO_PUBLISH");
    store.translate(P1, "de", "title", "Von Hand in Shopify");
    store.updateSource(P1, "title", "Product 1 parka");

    await runJob(deps, shop.id);
    expect(store.translationOf(P1, "de", "title")).toBe("Von Hand in Shopify");

    await runJob(deps, shop.id, { overwriteProtected: true });
    const revisions = await withTenant(
      shop.id,
      (tx) => tx.translationRevision.findMany({ where: { key: "title" }, orderBy: { createdAt: "asc" } }),
      app,
    );
    expect(revisions.map((r) => [r.origin, r.value])).toEqual([
      ["EXTERNAL", "Von Hand in Shopify"],
      ["AI", "[de] Product 1 parka"],
    ]);
  });

  it("refreshes Linguva's own unreviewed machine translations", async () => {
    const { shop, store, deps } = await setup(1, "AUTO_PUBLISH");
    await runJob(deps, shop.id);
    store.updateSource(P1, "title", "Product 1 coat");
    const job = await runJob(deps, shop.id);
    expect(job.protectedSkipped).toBe(0);
    expect(store.translationOf(P1, "de", "title")).toBe("[de] Product 1 coat");
  });
});

describe("history and restore", () => {
  it("restores an earlier version while the source is unchanged", async () => {
    const { shop, store, deps } = await setup(1, "AUTO_PUBLISH");
    store.translate(P1, "de", "title", "Original von Hand");
    const response = await store.graphql("query LinguvaTranslatableResource", { variables: { resourceId: P1, locale: "de" } });
    const digest = ((await response.json()) as { data: { translatableResource: { translatableContent: Array<{ key: string; digest: string }> } } })
      .data.translatableResource.translatableContent.find((c) => c.key === "title")!.digest;
    await saveResourceTranslations(
      {
        admin: store.asAdmin(),
        shopId: shop.id,
        actorId: "42",
        resourceId: P1,
        locale: "de",
        edits: [{ key: "title", value: "Neue Version", digest, origin: "MANUAL", approved: true }],
      },
      app,
    );
    const external = await withTenant(shop.id, (tx) => tx.translationRevision.findFirstOrThrow({ where: { origin: "EXTERNAL" } }), app);

    await expect(
      restoreRevision({ admin: store.asAdmin(), shopId: shop.id, actorId: "42", revisionId: external.id }, app),
    ).resolves.toEqual({ status: "restored" });
    expect(store.translationOf(P1, "de", "title")).toBe("Original von Hand");
    const latest = await withTenant(shop.id, (tx) => tx.translationRevision.findFirstOrThrow({ orderBy: { createdAt: "desc" } }), app);
    expect(latest).toMatchObject({ restoredFromId: external.id, approved: true, origin: "MANUAL" });
    void deps;
  });

  it("refuses to restore a version written for a different source text", async () => {
    const { shop, store, deps } = await setup(1, "AUTO_PUBLISH");
    await runJob(deps, shop.id);
    const revision = await withTenant(shop.id, (tx) => tx.translationRevision.findFirstOrThrow({ where: { key: "title" } }), app);
    store.updateSource(P1, "title", "Completely new title");
    await expect(
      restoreRevision({ admin: store.asAdmin(), shopId: shop.id, actorId: null, revisionId: revision.id }, app),
    ).resolves.toEqual({ status: "source_changed" });
  });
});

describe("glossary and memory inside bulk jobs", () => {
  it("keeps protected terms, enforces preferred wording and reuses memory", async () => {
    const { shop, store, provider, deps } = await setup(2, "AUTO_PUBLISH");
    await upsertTerms(shop.id, [
      { rule: "DO_NOT_TRANSLATE", term: "Product", caseSensitive: true },
      { rule: "PREFERRED", term: "jacket", translation: "Jacke", targetLocale: "de" },
    ], {}, app);

    const first = await runJob(deps, shop.id);
    // Nothing left to translate in the title: rendered from glossary rules alone.
    expect(store.translationOf(P1, "de", "title")).toBe("Product 1 Jacke");
    expect(store.translationOf(P1, "de", "body_html")).toBe("<p>[de] Warm <b>Jacke</b> number 1.</p>");
    // Provider never saw the protected words.
    expect(provider.requests.flatMap((r) => r.segments).join(" ")).not.toMatch(/Product|jacket/);
    expect(first.charsBilled).toBeGreaterThan(0);

    // A new product with the same description as product 1 reuses memory.
    store.products.set("gid://shopify/Product/9", [
      { key: "body_html", value: "<p>Warm <b>jacket</b> number 1.</p>", type: "HTML" },
    ]);
    const before = provider.requests.length;
    const second = await runJob(deps, shop.id);
    expect(second.memoryHits).toBe(1);
    expect(second.charsSaved).toBeGreaterThan(0);
    expect(second.charsBilled).toBe(0);
    expect(provider.requests.length).toBe(before);
    expect(store.translationOf("gid://shopify/Product/9", "de", "body_html")).toBe("<p>[de] Warm <b>Jacke</b> number 1.</p>");
  });
});
