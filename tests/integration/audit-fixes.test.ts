import { PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { upsertTerms } from "../../app/.server/glossary/glossary";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { storeMemory } from "../../app/.server/memory/translation-memory";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { listPendingDrafts, rejectDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { latestRevisions } from "../../app/.server/translation/revisions";
import { action as shopRedact } from "../../app/routes/webhooks.shop.redact";
import { countAsOwner, ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { signedWebhookRequest } from "../support/webhooks";

const app = new PrismaClient();
const DOMAIN = "audit.myshopify.com";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(1);
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test",
  };
  return { shop, store, deps };
}

let n = 0;
async function runJob(deps: JobDependencies, shopId: string) {
  const { job } = await createBulkJob(
    { shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `a-${++n}` },
    app,
  );
  const { itemIds } = await runDiscoveryPage(deps, { shopId, jobId: job.id });
  for (const id of itemIds) await processItem(deps, { shopId, itemId: id }, 1);
  return withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
}

describe("rejected drafts", () => {
  it("are not drafted again for the same source", async () => {
    const { shop, store, deps } = await setup();
    await runJob(deps, shop.id);
    const drafts = await listPendingDrafts(shop.id, {}, app);
    await rejectDrafts(shop.id, drafts.map((d) => d.id), "1", app);

    const second = await runJob(deps, shop.id);
    expect(second.totalItems).toBe(0);
    expect(await listPendingDrafts(shop.id, {}, app)).toEqual([]);

    // A changed source is translated again.
    store.updateSource("gid://shopify/Product/1", "title", "Product 1 parka");
    const third = await runJob(deps, shop.id);
    expect(third.totalItems).toBe(1);
    expect((await listPendingDrafts(shop.id, {}, app)).map((d) => d.key)).toEqual(["title"]);
  });
});

describe("latestRevisions", () => {
  it("returns only the newest revision per field", async () => {
    const { shop } = await setup();
    const base = { shopId: shop.id, resourceGid: "gid://shopify/Product/1", locale: "de", sourceDigest: "d", origin: "MANUAL" as const };
    await withTenant(
      shop.id,
      (tx) =>
        tx.translationRevision.createMany({
          data: [
            { ...base, key: "title", value: "v1", createdAt: new Date("2026-01-01") },
            { ...base, key: "title", value: "v2", createdAt: new Date("2026-02-01") },
            { ...base, key: "body_html", value: "b1", createdAt: new Date("2026-01-15") },
            { ...base, key: "title", value: "fr", locale: "fr", createdAt: new Date("2026-03-01") },
          ],
        }),
      app,
    );
    const latest = await latestRevisions(shop.id, ["gid://shopify/Product/1"], "de", app);
    expect([...latest.entries()].map(([k, r]) => [k, r.value]).sort()).toEqual([
      ["gid://shopify/Product/1|body_html", "b1"],
      ["gid://shopify/Product/1|title", "v2"],
    ]);
  });
});

describe("locale sync", () => {
  it("doesn't rewrite unchanged locales on every page load", async () => {
    const { shop } = await setup();
    const locales = [{ locale: "de", name: "German", primary: true, published: true, rtl: false }];
    await syncShopLocales(shop.id, locales, app);
    const first = await withTenant(shop.id, (tx) => tx.shopLocale.findFirstOrThrow(), app);
    await new Promise((r) => setTimeout(r, 10));
    await syncShopLocales(shop.id, locales, app);
    const second = await withTenant(shop.id, (tx) => tx.shopLocale.findFirstOrThrow(), app);
    expect(second.syncedAt.getTime()).toBe(first.syncedAt.getTime());
    await syncShopLocales(shop.id, [{ ...locales[0]!, published: false }], app);
    const third = await withTenant(shop.id, (tx) => tx.shopLocale.findFirstOrThrow(), app);
    expect(third.published).toBe(false);
  });
});

describe("shop/redact", () => {
  it("also erases memory, glossary, drafts, jobs, revisions and usage", async () => {
    const { shop, deps } = await setup();
    await runJob(deps, shop.id);
    await storeMemory({ shopId: shop.id, sourceLocale: "en", targetLocale: "de" }, [{ source: "A b", target: "C d" }], "APPROVED", app);
    await upsertTerms(shop.id, [{ rule: "DO_NOT_TRANSLATE", term: "Brand" }], {}, app);
    const tables = ["TranslationDraft", "TranslationJob", "TranslationJobItem", "TranslationMemory", "GlossaryTerm", "Glossary", "UsageLedger"];
    for (const t of tables) expect(await countAsOwner(t, shop.id)).toBeGreaterThan(0);

    const call = shopRedact as (args: ActionFunctionArgs) => Promise<Response>;
    const response = await call({
      request: signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: DOMAIN, body: { shop_domain: DOMAIN } }),
      params: {},
      context: {},
    } as ActionFunctionArgs);
    expect(response.status).toBe(200);
    for (const t of [...tables, "TranslationRevision"]) expect(await countAsOwner(t, shop.id)).toBe(0);
  });
});

describe("fuzzy memory at scale", () => {
  it("finds the right match among 20,000 entries and never another tenant's", async () => {
    const { shop } = await setup();
    const other = (await upsertInstalledShop({ shopDomain: "other.myshopify.com" }, app)).shop;
    for (const [id, target] of [[shop.id, "own"], [other.id, "OTHER TENANT"]] as const) {
      await ownerDb.$transaction([
        ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${id}, true)`,
        ownerDb.$executeRawUnsafe(
          `INSERT INTO "TranslationMemory" ("shopId","sourceLocale","targetLocale","sourceHash","sourceText","targetText","status","updatedAt")
           SELECT $1::uuid, 'en', 'de', md5($1 || g::text), 'Product description number ' || g || ' with ' || md5(g::text), $2 || ' ' || g, 'APPROVED', now()
           FROM generate_series(1, 10000) g`,
          id,
          target,
        ),
      ]);
    }
    await ownerDb.$executeRawUnsafe(`ANALYZE "TranslationMemory"`);
    const { fuzzyMatches } = await import("../../app/.server/memory/translation-memory");
    const started = performance.now();
    const matches = await fuzzyMatches(
      { shopId: shop.id, sourceLocale: "en", targetLocale: "de" },
      "Product description number 1234 with " + "81dc9bdb52d04dc20036dbd8313ed055",
      { threshold: 0.6, limit: 3 },
      app,
    );
    const elapsed = performance.now() - started;
    expect(matches[0]).toMatchObject({ targetText: "own 1234" });
    expect(matches.every((m) => m.targetText.startsWith("own"))).toBe(true);
    // Informational; recorded in docs/VERIFICATION.md. Generous bound for CI.
    expect(elapsed).toBeLessThan(5_000);
    console.info(`fuzzyMatches over 10k tenant entries: ${elapsed.toFixed(0)} ms`);
  }, 60_000);
});
