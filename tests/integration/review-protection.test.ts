/**
 * What a person decided stays decided: Review approves or rejects only the
 * draft version it showed, a person's draft (CSV import) is never replaced
 * by machine output, a translation removed on purpose isn't re-created,
 * and a field the checks refused isn't sent to the provider again by every
 * automatic check while its original is unchanged.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { createAutoItems, type AutoTranslatePayload } from "../../app/.server/jobs/auto-translate";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import type { TranslationProvider, TranslationRequest } from "../../app/.server/providers/types";
import {
  approveDrafts,
  draftToken,
  pendingDraftDigests,
  rejectDrafts,
  saveDrafts,
  type DraftInput,
} from "../../app/.server/review/drafts";
import { setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { removeTranslation } from "../../app/.server/translation/history";
import { ANY_SOURCE } from "../../app/.server/jobs/needs-work";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const P = { resourceGid: P1, resourceType: "PRODUCT" as const };

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

/** Counts provider calls; optionally drops the digits of every translation (the checks refuse that). */
class CountingProvider implements TranslationProvider {
  readonly id = "mock";
  calls = 0;
  dropDigits = false;
  private readonly inner = new MockTranslationProvider();
  async translate(request: TranslationRequest) {
    this.calls++;
    const result = await this.inner.translate(request);
    if (!this.dropDigits) return result;
    // Digits outside the inline codes: the markup stays intact, the numbers don't.
    return { ...result, translations: result.translations.map((t) => t.replace(/(<[^>]*>)|\d/g, (m, tag: string | undefined) => tag ?? "")) };
  }
}

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "protect.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
  const store = new FakeShopifyStore(1);
  const provider = new CountingProvider();
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:protect" };
  return { shop, store, provider, deps };
}

/** An automatic check of the product, run to the end. */
async function check(deps: JobDependencies, shopId: string, changedAt?: string) {
  const payload: AutoTranslatePayload = { shopId, ...P, ...(changedAt ? { changedAt } : {}) };
  const result = await createAutoItems(app, payload, deps.billingFor);
  for (const itemId of [...result.itemIds, ...result.reused]) await processItem(deps, { shopId, itemId }, 1);
  return result;
}

const drafts = (shopId: string) =>
  withTenant(shopId, (tx) => tx.translationDraft.findMany({ where: { shopId }, orderBy: { key: "asc" } }), app);

function draftFor(store: FakeShopifyStore, key: string, value: string, provider: string): DraftInput {
  const field = store.products.get(P1)!.find((f) => f.key === key)!;
  return {
    jobId: null,
    resourceGid: P1,
    resourceTitle: "Product 1 jacket",
    locale: "de",
    key,
    sourceDigest: createHash("sha256").update(field.value).digest("hex"),
    sourceValue: field.value,
    value,
    segmentPairs: [],
    issues: [],
    provider,
  };
}

describe("Review acts only on the version it showed", () => {
  it("doesn't approve or reject a draft a newer translation replaced meanwhile", async () => {
    const { shop, store } = await setup();
    await saveDrafts(shop.id, [draftFor(store, "title", "Produkt 1 Jacke", "mock")], app);
    const [shown] = await drafts(shop.id);
    const tokens = new Map([[shown!.id, draftToken(shown!)]]);
    // The original changes and the next check replaces the draft in place.
    store.updateSource(P1, "title", "Product 1 jacket, waterproof");
    await new Promise((r) => setTimeout(r, 5));
    await saveDrafts(shop.id, [draftFor(store, "title", "Produkt 1 Jacke, wasserdicht", "mock")], app);

    const approved = await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [shown!.id], tokens }, app);
    expect(approved).toEqual({ published: 0, stale: 0, failed: 0, changed: 1 });
    expect(await rejectDrafts(shop.id, [shown!.id], "1", app, tokens)).toBe(0);
    const [after] = await drafts(shop.id);
    // The new draft, which nobody has seen yet, still waits: neither published nor rejected.
    expect(after).toMatchObject({ status: "PENDING", value: "Produkt 1 Jacke, wasserdicht" });
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();

    // With the version shown now, it is approved.
    const fresh = await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [after!.id], tokens: new Map([[after!.id, draftToken(after!)]]) }, app);
    expect(fresh).toMatchObject({ published: 1, changed: 0 });
    expect(store.translationOf(P1, "de", "title")).toBe("Produkt 1 Jacke, wasserdicht");
  });

  it("refuses ids without the version they were shown in", async () => {
    const { shop, store } = await setup();
    await saveDrafts(shop.id, [draftFor(store, "title", "Produkt 1 Jacke", "mock")], app);
    const [shown] = await drafts(shop.id);
    expect(await rejectDrafts(shop.id, [shown!.id], "1", app, new Map())).toBe(0);
    expect(await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [shown!.id], tokens: new Map([[shown!.id, "forged"]]) }, app)).toMatchObject({ published: 0, changed: 1 });
    expect((await drafts(shop.id))[0]).toMatchObject({ status: "PENDING" });
  });
});

describe("a person's draft (CSV import)", () => {
  it("is never replaced by machine output, holds its field, and is recorded as a manual translation", async () => {
    const { shop, store, provider, deps } = await setup();
    await saveDrafts(shop.id, [draftFor(store, "title", "Unsere Jacke Nr. 1", "csv")], app);
    // Machine output for the same field is dropped, whatever its source.
    store.updateSource(P1, "title", "Product 1 jacket, waterproof");
    expect(await saveDrafts(shop.id, [draftFor(store, "title", "[de] Product 1 jacket, waterproof", "mock")], app)).toBe(0);
    expect((await pendingDraftDigests(shop.id, [P1], "de", app)).get(`${P1}|title`)).toBe(ANY_SOURCE);

    // An automatic check translates the other fields only.
    await check(deps, shop.id);
    expect(provider.calls).toBe(1);
    const all = await drafts(shop.id);
    expect(all.find((d) => d.key === "title")).toMatchObject({ provider: "csv", value: "Unsere Jacke Nr. 1", status: "PENDING" });
    expect(all.find((d) => d.key === "body_html")).toMatchObject({ provider: "mock", status: "PENDING" });
  });

  it("is approved as a manual, approved translation", async () => {
    const { shop, store } = await setup();
    await saveDrafts(shop.id, [draftFor(store, "title", "Unsere Jacke Nr. 1", "csv")], app);
    const [draft] = await drafts(shop.id);
    expect(await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "5", draftIds: [draft!.id] }, app)).toMatchObject({ published: 1 });
    const revisions = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ where: { shopId: shop.id, key: "title" } }), app);
    expect(revisions.map((r) => [r.origin, r.approved, r.value])).toEqual([["MANUAL", true, "Unsere Jacke Nr. 1"]]);
  });
});

describe("a translation removed on purpose", () => {
  it("isn't re-created by automatic translation until its original changes", async () => {
    const { shop, store, deps } = await setup();
    store.translate(P1, "de", "title", "Produkt 1 Jacke");
    expect(await removeTranslation({ admin: store.asAdmin(), shopId: shop.id, actorId: "3", resourceGid: P1, locale: "de", key: "title" }, app)).toEqual({ status: "removed" });

    await check(deps, shop.id);
    expect((await drafts(shop.id)).map((d) => d.key)).toEqual(["body_html"]);
    const [item] = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
    expect(item!.status).toBe("SUCCEEDED");

    // A new original is translated again.
    store.updateSource(P1, "title", "Product 1 jacket, waterproof");
    await check(deps, shop.id, new Date(Date.now() + 60_000).toISOString());
    expect((await drafts(shop.id)).map((d) => d.key)).toEqual(["body_html", "title"]);
  });
});

describe("fields the checks refused", () => {
  it("aren't sent again by automatic checks while the original is unchanged; a translation the merchant starts tries again", async () => {
    const { shop, provider, deps } = await setup();
    provider.dropDigits = true;
    // Both fields contain a number, so both are refused.
    await check(deps, shop.id);
    expect(provider.calls).toBe(1);
    expect(await drafts(shop.id)).toEqual([
      expect.objectContaining({ key: "body_html", status: "REJECTED", reviewedBy: "system:check", value: "" }),
      expect.objectContaining({ key: "title", status: "REJECTED", reviewedBy: "system:check", value: "" }),
    ]);
    // Every later save or order of the product queues a check: nothing is sent again.
    await check(deps, shop.id, new Date(Date.now() + 60_000).toISOString());
    await check(deps, shop.id, new Date(Date.now() + 120_000).toISOString());
    expect(provider.calls).toBe(1);

    // The merchant starts a translation (they may have fixed the glossary): it tries again.
    provider.dropDigits = false;
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "retry-refused" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    for (const itemId of page.itemIds) await processItem(deps, { shopId: shop.id, itemId }, 1);
    expect(provider.calls).toBe(2);
    expect((await drafts(shop.id)).map((d) => [d.key, d.status])).toEqual([
      ["body_html", "PENDING"],
      ["title", "PENDING"],
    ]);
  });

  it("are translated again once the original changes", async () => {
    const { shop, store, provider, deps } = await setup();
    provider.dropDigits = true;
    await check(deps, shop.id);
    provider.dropDigits = false;
    store.updateSource(P1, "title", "Product one jacket");
    await check(deps, shop.id, new Date(Date.now() + 60_000).toISOString());
    expect(provider.calls).toBe(2);
    expect((await drafts(shop.id)).map((d) => [d.key, d.status])).toEqual([
      ["body_html", "REJECTED"],
      ["title", "PENDING"],
    ]);
  });
});
