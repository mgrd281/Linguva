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
  approveDraftsDetailed,
  draftToken,
  pendingDraftDigests,
  rejectDrafts,
  rejectDraftsDetailed,
  saveDrafts,
  type DraftInput,
} from "../../app/.server/review/drafts";
import { createCoverageReport, runCoveragePage, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
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

/** Two products and a list custom field on the first, with German drafts the page shows (tokens). */
async function reviewSetup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "outcomes.myshopify.com" }, app);
  const store = new FakeShopifyStore(2);
  const list = store.addMetafield(P1, { namespace: "custom", key: "features", type: "list.single_line_text_field", value: '["Warm","Waterproof"]' });
  const digest = (gid: string, key: string) => createHash("sha256").update(store.products.get(gid)!.find((f) => f.key === key)!.value).digest("hex");
  const input = (gid: string, key: string, value: string, extra: Partial<DraftInput> = {}): DraftInput => ({
    jobId: null,
    resourceGid: gid,
    resourceTitle: "Product jacket",
    locale: "de",
    key,
    sourceDigest: digest(gid, key),
    sourceValue: store.products.get(gid)!.find((f) => f.key === key)!.value,
    value,
    segmentPairs: [],
    issues: [],
    provider: "mock",
    currentDigest: "none",
    ...extra,
  });
  const shown = async () => {
    const all = await drafts(shop.id);
    return { all, tokens: new Map(all.map((d) => [d.id, draftToken(d)])), byKey: (gid: string, key: string) => all.find((d) => d.resourceGid === gid && d.key === key)! };
  };
  return { shop, store, list, input, shown };
}

const P2 = "gid://shopify/Product/2";

describe("approving says what happened to each text", () => {
  it("refuses an emptied text (EMPTY_TRANSLATION): nothing is published and the draft keeps waiting", async () => {
    const { shop, store, input, shown } = await reviewSetup();
    await saveDrafts(shop.id, [input(P1, "title", "Produkt 1 Jacke")], app);
    const { all, tokens } = await shown();
    const result = await approveDraftsDetailed({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [all[0]!.id], tokens, edits: new Map([[all[0]!.id, "   "]]) }, app);
    expect(result).toMatchObject({ published: 0, stale: 0, failed: 1, changed: 0, outcomes: [{ id: all[0]!.id, status: "failed", reason: "EMPTY_TRANSLATION" }] });
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
    expect((await drafts(shop.id))[0]).toMatchObject({ status: "PENDING", value: "Produkt 1 Jacke" });
  });

  it("names the reason per text: original changed, another translation saved, item gone, structure changed, another version", async () => {
    const { shop, store, list, input, shown } = await reviewSetup();
    await saveDrafts(
      shop.id,
      [
        input(P1, "title", "Produkt 1 Jacke"),
        input(P1, "body_html", "<p>Warme <b>Jacke</b> Nummer 1.</p>"),
        input(list, "value", '["Warm"]', { parentGid: P1, valueType: "LIST_SINGLE_LINE_TEXT_FIELD" }),
        input(P2, "title", "Produkt 2 Jacke"),
        input(P2, "body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>"),
      ],
      app,
    );
    await saveDrafts(
      shop.id,
      [{ ...input(P1, "title", "Weg"), resourceGid: "gid://shopify/Product/99", sourceDigest: "x".repeat(64), sourceValue: "Gone jacket" }],
      app,
    );
    const { all, tokens, byKey } = await shown();
    // Meanwhile: the original of one title changes, someone saves a description, product 99 never existed.
    store.updateSource(P1, "title", "Product 1 jacket, waterproof");
    store.translate(P1, "de", "body_html", "<p>Von Hand.</p>");
    const forged = byKey(P2, "body_html").id;
    tokens.set(forged, "forged");

    const result = await approveDraftsDetailed({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: all.map((d) => d.id), tokens }, app);
    const outcome = (id: string) => result.outcomes.find((o) => o.id === id);
    expect(outcome(byKey(P1, "title").id)).toEqual({ id: byKey(P1, "title").id, status: "stale", reason: "SOURCE_CHANGED" });
    expect(outcome(byKey(P1, "body_html").id)).toEqual({ id: byKey(P1, "body_html").id, status: "stale", reason: "TRANSLATION_CHANGED" });
    expect(outcome(byKey(list, "value").id)).toEqual({ id: byKey(list, "value").id, status: "failed", reason: "STRUCTURE_CHANGED" });
    expect(outcome(byKey("gid://shopify/Product/99", "title").id)).toMatchObject({ status: "stale", reason: "RESOURCE_GONE" });
    expect(outcome(byKey(P2, "title").id)).toEqual({ id: byKey(P2, "title").id, status: "published" });
    expect(outcome(forged)).toEqual({ id: forged, status: "changed" });
    expect(result).toMatchObject({ published: 1, stale: 3, failed: 1, changed: 1 });
    expect(result.outcomes).toHaveLength(all.length);
    // Stale texts are retired, failed and changed ones keep waiting.
    const after = await shown();
    expect(after.byKey(P1, "title").status).toBe("STALE");
    expect(after.byKey(list, "value").status).toBe("PENDING");
    expect(after.byKey(P2, "body_html").status).toBe("PENDING");
    expect(store.translationOf(P1, "de", "body_html")).toBe("<p>Von Hand.</p>");
  });

  it("keeps what Shopify published before it stopped answering, and leaves the rest waiting (504)", async () => {
    const { shop, store, input, shown } = await reviewSetup();
    store.locales = [
      { locale: "en", name: "English", primary: true, published: true },
      { locale: "de", name: "German", primary: false, published: true },
    ];
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "outcomes-measure" }, app);
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage({ prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:outcomes" }, next);
    await saveDrafts(shop.id, [input(P1, "title", "Produkt 1 Jacke"), input(P2, "title", "Produkt 2 Jacke")], app);
    const { all, tokens } = await shown();
    const draftKeys = async () =>
      Object.fromEntries(
        (await withTenant(shop.id, (tx) => tx.coverageItem.findMany({ where: { shopId: shop.id, resourceGid: { in: [P1, P2] } }, select: { resourceGid: true, draftKeys: true } }), app)).map((i) => [i.resourceGid, i.draftKeys]),
      );
    expect(await draftKeys()).toEqual({ [P1]: ["title"], [P2]: ["title"] });

    // The first product's read and write go through; the next read times out.
    let calls = 0;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (++calls === 3) throw new Response("Shopify took too long to respond.", { status: 504 });
        return store.graphql(query, options);
      },
    } as unknown as ReturnType<FakeShopifyStore["asAdmin"]>;
    const result = await approveDraftsDetailed({ admin, shopId: shop.id, actorId: "1", draftIds: all.map((d) => d.id), tokens }, app);
    expect(result).toMatchObject({ published: 1, stale: 0, failed: 1, changed: 0 });
    const published = result.outcomes.find((o) => o.status === "published")!;
    const unsent = result.outcomes.find((o) => o.status === "failed")!;
    expect(unsent).toMatchObject({ status: "failed", reason: "SHOPIFY_UNAVAILABLE" });
    const sentGid = all.find((d) => d.id === published.id)!.resourceGid;
    const unsentGid = all.find((d) => d.id === unsent.id)!.resourceGid;
    expect(store.translationOf(sentGid, "de", "title")).toBeDefined();
    expect(store.translationOf(unsentGid, "de", "title")).toBeUndefined();
    const after = await shown();
    // Saving the field retired its draft (STALE, as every save does); either way it no longer waits.
    expect(after.all.find((d) => d.id === published.id)!.status).not.toBe("PENDING");
    expect(after.all.find((d) => d.id === unsent.id)!.status).toBe("PENDING");
    // The language figures follow what was published; the unsent text still counts as waiting.
    expect(await draftKeys()).toEqual({ [sentGid]: [], [unsentGid]: ["title"] });
  });
});

describe("rejecting", () => {
  it("returns the texts it rejected and keeps one audit entry without any text", async () => {
    const { shop, input, shown } = await reviewSetup();
    await saveDrafts(shop.id, [input(P1, "title", "Produkt 1 Jacke"), input(P2, "title", "Produkt 2 Jacke"), { ...input(P2, "body_html", "<p>Jaqueta</p>"), locale: "pt-BR" }], app);
    const { all, tokens } = await shown();
    // The Portuguese text changed since the page showed it: left alone.
    const changed = all.find((d) => d.locale === "pt-BR")!;
    tokens.set(changed.id, "forged");
    const { rejected } = await rejectDraftsDetailed(shop.id, all.map((d) => d.id), "7", app, tokens);
    expect(rejected.sort()).toEqual(all.filter((d) => d.locale === "de").map((d) => d.id).sort());
    const [, audit] = await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.auditLog.findMany({ where: { shopId: shop.id, action: "drafts.rejected" } }),
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "MERCHANT_USER", actorId: "7", metadata: { count: 2, locales: ["de"] } });
    expect(JSON.stringify(audit[0]!.metadata)).not.toMatch(/Jacke|Product/);
    // Nothing left to reject: no entry.
    expect((await rejectDraftsDetailed(shop.id, [rejected[0]!], "7", app)).rejected).toEqual([]);
  });
});

describe("new web addresses (URL handles)", () => {
  it("are published only after the merchant confirmed, and only valid ones", async () => {
    const { shop, store, input, shown } = await reviewSetup();
    await saveDrafts(shop.id, [input(P1, "handle", "produkt-1-jacke", { provider: "csv" }), input(P1, "title", "Produkt 1 Jacke")], app);
    const { tokens, byKey } = await shown();
    const handle = byKey(P1, "handle").id;
    const title = byKey(P1, "title").id;

    const unconfirmed = await approveDraftsDetailed({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [handle, title], tokens, handles: { confirmed: new Set() } }, app);
    expect(unconfirmed.outcomes).toEqual(
      expect.arrayContaining([
        { id: handle, status: "failed", reason: "HANDLE_NOT_CONFIRMED" },
        { id: title, status: "published" },
      ]),
    );
    expect(store.translationOf(P1, "de", "handle")).toBeUndefined();
    expect((await shown()).byKey(P1, "handle").status).toBe("PENDING");

    const invalid = await approveDraftsDetailed(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [handle], tokens, edits: new Map([[handle, "Neue Jacke"]]), handles: { confirmed: new Set([handle]) } },
      app,
    );
    expect(invalid.outcomes).toEqual([{ id: handle, status: "failed", reason: "HANDLE_INVALID", detail: expect.any(String) }]);
    expect(store.translationOf(P1, "de", "handle")).toBeUndefined();

    const confirmed = await approveDraftsDetailed({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [handle], tokens, handles: { confirmed: new Set([handle]) } }, app);
    expect(confirmed.outcomes).toEqual([{ id: handle, status: "published" }]);
    expect(store.translationOf(P1, "de", "handle")).toBe("produkt-1-jacke");
  });

  it("are approved like any text without the option (other callers, as before)", async () => {
    const { shop, store, input, shown } = await reviewSetup();
    await saveDrafts(shop.id, [input(P1, "handle", "produkt-1-jacke", { provider: "csv" })], app);
    const { all, tokens } = await shown();
    expect(await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [all[0]!.id], tokens }, app)).toEqual({ published: 1, stale: 0, failed: 0, changed: 0 });
    expect(store.translationOf(P1, "de", "handle")).toBe("produkt-1-jacke");
  });
});
