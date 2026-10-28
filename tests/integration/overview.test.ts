/**
 * Overview: the getting-started checklist follows the merchant's real
 * progress, languages show their coverage, AI usage warns early.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { loadOverview } from "../../app/.server/overview/overview";
import { translator } from "../../app/i18n/i18n";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { approveDrafts, listPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { usageLevel } from "../../app/lib/usage";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const steps = (o: Awaited<ReturnType<typeof loadOverview>>) => Object.fromEntries(o.checklist.map((s) => [s.id, s.done]));

describe("getting started", () => {
  it("guides a new store step by step and follows its progress", async () => {
    const store = new FakeShopifyStore(2);
    store.locales = [{ locale: "en", name: "English", primary: true, published: true }];
    const { shop } = await upsertInstalledShop({ shopDomain: "new.myshopify.com", name: "New store" }, app);

    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toEqual({ language: false, consent: false, "first-translation": false, review: false, "publish-language": false });
    expect(overview.progress).toEqual([]);

    store.locales = [...store.locales, { locale: "de", name: "German", primary: false, published: false }];
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toMatchObject({ language: true, consent: true, "first-translation": false });
    expect(overview.checklist.find((s) => s.id === "first-translation")?.href).toBe("/app/products?lang=de");

    // A bulk job in review mode: drafts to review, nothing published yet.
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: "lv:test:overview" };
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "ov-1" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    for (const id of page.itemIds) await processItem(deps, { shopId: shop.id, itemId: id }, 1);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.pendingDrafts).toBe(4);
    expect(overview.checklist.find((s) => s.id === "review")?.label).toEqual({ key: "overview.checklist.review.labelCount", vars: { count: 4 } });
    expect(translator("en").msg(overview.checklist.find((s) => s.id === "review")!.label)).toBe("Review 4 translations");

    const drafts = await listPendingDrafts(shop.id, {}, app);
    await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: drafts.map((d) => d.id) }, app);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toMatchObject({ "first-translation": true, review: true, "publish-language": false });

    store.locales = store.locales.map((l) => (l.locale === "de" ? { ...l, published: true } : l));
    expect(steps(await loadOverview(store.asAdmin(), shop, app))).toMatchObject({ "publish-language": true });
  });
});

describe("AI usage level", () => {
  it("warns from 80 % and stops at the allowance", () => {
    expect(usageLevel(0, 1000)).toBe("ok");
    expect(usageLevel(799, 1000)).toBe("ok");
    expect(usageLevel(800, 1000)).toBe("high");
    expect(usageLevel(1000, 1000)).toBe("exhausted");
    expect(usageLevel(5, 0)).toBe("exhausted");
  });
});
