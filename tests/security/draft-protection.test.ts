/**
 * Nothing reaches the storefront unless the merchant intended it: review
 * mode, editor drafts, AI cost limits and the switch back from automatic
 * publishing.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Before any import reads the configuration.
vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
  process.env.AI_USER_REQUESTS_PER_MINUTE = "2";
  process.env.AI_SHOP_REQUESTS_PER_MINUTE = "100";
  process.env.AI_MAX_CHARS_PER_REQUEST = "200";
});

import { PrismaClient } from "@prisma/client";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import type { TranslationRequest, TranslationResult } from "../../app/.server/providers/types";
import { approveDrafts, listPendingDrafts, rejectDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import { getMonthlyUsage } from "../../app/.server/usage/usage-ledger";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
let n = 0;

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

/** Returns the source unchanged: long text then fails the "untranslated" check. */
class EchoProvider extends MockTranslationProvider {
  override async translate(request: TranslationRequest): Promise<TranslationResult> {
    await super.translate(request);
    return {
      translations: [...request.segments],
      billedCharacters: request.segments.reduce((sum, s) => sum + s.length, 0),
      provider: "echo",
    };
  }
}

async function setup(domain: string, products = 2) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(products);
  return { shop, store };
}

const editor = (store: FakeShopifyStore, shopId: string, actorId: string): EditorContext => ({
  admin: store.asAdmin(),
  shopId,
  actorId,
  kind: "PRODUCT",
  resourceId: P1,
  target: { locale: "de", name: "German", rtl: false },
  sourceName: "English",
});

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const aiForm = () => form([["intent", "ai-translate"], ["key", "title"], ["key", "body_html"]]);

async function runJob(deps: JobDependencies, shopId: string, before?: () => Promise<void>) {
  const { job } = await createBulkJob(
    { shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `dp-${++n}` },
    app,
  );
  await before?.();
  const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
  for (const id of page.itemIds) await processItem(deps, { shopId, itemId: id }, 1);
  return job;
}

const deps = (store: FakeShopifyStore, provider = new MockTranslationProvider()): JobDependencies => ({
  prisma: app,
  adminFor: async () => store.asAdmin(),
  provider,
  monthlyLimit: 1_000_000,
  keyPrefix: "lv:test:dp",
});

describe("editor AI never publishes", () => {
  it("returns AI drafts and memory suggestions without writing to Shopify", async () => {
    const { shop, store } = await setup("dp-editor.myshopify.com");
    const result = await runEditorAction(editor(store, shop.id, "u-editor"), aiForm());
    expect(result).toMatchObject({ kind: "ai", drafts: { title: "[de] Product 1 jacket" } });
    await runEditorAction(editor(store, shop.id, "u-editor"), form([["intent", "memory-suggest"]]));
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
  });
});

describe("AI cost limits in the editor", () => {
  it("rate-limits one staff member without calling the provider or using quota", async () => {
    const { shop, store } = await setup("dp-rate.myshopify.com");
    await runEditorAction(editor(store, shop.id, "u-rate"), aiForm());
    await runEditorAction(editor(store, shop.id, "u-rate"), aiForm());
    const used = await getMonthlyUsage(shop.id, undefined, app);

    const limited = await runEditorAction(editor(store, shop.id, "u-rate"), aiForm());
    expect(limited).toMatchObject({ kind: "error", code: "RATE_LIMITED_USER" });
    expect((limited as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(used);

    // Another staff member of the same shop isn't blocked by that.
    expect(await runEditorAction(editor(store, shop.id, "u-other"), aiForm())).toMatchObject({ kind: "ai" });
  });

  it("refuses a request over the per-request size before reserving or calling AI", async () => {
    const { shop, store } = await setup("dp-large.myshopify.com");
    store.updateSource(P1, "body_html", `<p>${"Very long description. ".repeat(20)}</p>`);
    const result = await runEditorAction(editor(store, shop.id, "u-large"), aiForm());
    expect(result).toEqual({ kind: "error", code: "REQUEST_TOO_LARGE" });
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
  });
});

describe("bulk publishing needs the merchant's current intent", () => {
  it("publishes nothing in review mode", async () => {
    const { shop, store } = await setup("dp-review.myshopify.com");
    await runJob(deps(store), shop.id);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect((await listPendingDrafts(shop.id, {}, app)).length).toBe(4);
  });

  it("stops publishing when the merchant switches back to review during a job", async () => {
    const { shop, store } = await setup("dp-switch.myshopify.com");
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const job = await runJob(deps(store), shop.id, () =>
      setBulkPublishMode({ shopId: shop.id, mode: "DRAFT", confirmed: false, actorId: "1" }, app),
    );
    expect(job.publishMode).toBe("AUTO_PUBLISH");
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect((await listPendingDrafts(shop.id, {}, app)).length).toBe(4);
  });

  it("auto-publishes only results without warnings; flagged ones wait in Review", async () => {
    const { shop, store } = await setup("dp-flagged.myshopify.com", 1);
    store.updateSource(P1, "body_html", "<p>This is a long product description with plenty of words in it.</p>");
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    await runJob(deps(store, new EchoProvider()), shop.id);

    // The short title passes and is published; the unchanged long text is flagged.
    expect(store.translationOf(P1, "de", "title")).toBe("Product 1 jacket");
    expect(store.translationOf(P1, "de", "body_html")).toBeUndefined();
    const [draft] = await listPendingDrafts(shop.id, {}, app);
    expect(draft).toMatchObject({ key: "body_html" });
    expect(JSON.stringify(draft!.issues)).toContain("UNTRANSLATED");
  });
});

describe("review approval is explicit", () => {
  it("publishes nothing without selected drafts, and never a rejected or foreign draft", async () => {
    const a = await setup("dp-approve-a.myshopify.com", 1);
    const b = await setup("dp-approve-b.myshopify.com", 1);
    await runJob(deps(a.store), a.shop.id);
    await runJob(deps(b.store), b.shop.id);
    const [first, second] = await listPendingDrafts(a.shop.id, {}, app);
    const foreign = await listPendingDrafts(b.shop.id, {}, app);

    const none = await approveDrafts({ admin: a.store.asAdmin(), shopId: a.shop.id, actorId: "1", draftIds: [] }, app);
    expect(none).toEqual({ published: 0, stale: 0, failed: 0 });

    await rejectDrafts(a.shop.id, [first!.id], "1", app);
    const afterReject = await approveDrafts(
      { admin: a.store.asAdmin(), shopId: a.shop.id, actorId: "1", draftIds: [first!.id, ...foreign.map((d) => d.id)] },
      app,
    );
    expect(afterReject).toEqual({ published: 0, stale: 0, failed: 0 });
    expect(a.store.calls).not.toContain("LinguvaTranslationsRegister");
    expect(b.store.calls).not.toContain("LinguvaTranslationsRegister");

    const ok = await approveDrafts({ admin: a.store.asAdmin(), shopId: a.shop.id, actorId: "1", draftIds: [second!.id] }, app);
    expect(ok.published).toBe(1);
    const statuses = await withTenant(a.shop.id, (tx) => tx.translationDraft.findMany({ select: { id: true, status: true } }), app);
    expect(statuses.find((d) => d.id === first!.id)?.status).toBe("REJECTED");
  });
});
