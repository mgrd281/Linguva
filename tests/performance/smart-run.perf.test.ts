/**
 * A Smart Auto-Translate run over a large catalog: 5,000 products in two
 * languages, read 50 at a time. The measurement plans every page in its own
 * transaction; this measures how long a page takes, checks that nothing is
 * planned twice or left out, and that the estimate on the settings page
 * stays quick with 10,000 coverage items.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { forgetCurrentLocales } from "../../app/.server/locales/current-locales";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { saveSmartSettings, setSmartEnabled } from "../../app/.server/smart/config";
import { loadSmartPanel } from "../../app/.server/smart/panel";
import { smartTick } from "../../app/.server/smart/runs";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { PLANS } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const PRODUCTS = 5_000;
const NOON = new Date("2026-10-29T12:00:00Z");
const DUE = new Date("2026-10-29T22:01:00Z");
let shopId: string;
let store: FakeShopifyStore;
const pageTimes: number[] = [];
let queued = 0;
let totalMs = 0;

beforeAll(async () => {
  await resetDatabase();
  forgetCurrentLocales();
  shopId = (await upsertInstalledShop({ shopDomain: "smart-large.myshopify.com" }, app)).shop.id;
  await setAiConsent({ shopId, granted: true, actorId: null }, app);
  store = new FakeShopifyStore(PRODUCTS);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "de", name: "German", primary: false, published: true },
    { locale: "fr", name: "French", primary: false, published: true },
  ];
  await saveSmartSettings(
    {
      shopId,
      actorId: "7",
      version: 0,
      primaryLocale: "en",
      now: NOON,
      value: {
        mode: "daily",
        timeZone: "Europe/Berlin",
        times: [23 * 60],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        locales: ["de", "fr"],
        resourceTypes: ["PRODUCT"],
        fieldGroups: [],
        includeAttached: false,
        publishMode: "DRAFT",
        replaceOutdatedMachine: true,
        dailyBudget: null,
        monthlyBudget: null,
      },
    },
    app,
  );
  await setSmartEnabled({ shopId, actorId: "7", enabled: true, now: NOON }, app);
  const pages: CoveragePagePayload[] = [];
  await smartTick(
    {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      billingFor: async () => ({ configured: true, entitlements: PLANS.business }),
      aiAvailable: true,
      enqueueCoveragePage: async (payload) => void pages.push(payload),
    },
    DUE,
  );
  const coverage: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:smartperf", pageSize: 50 };
  const started = performance.now();
  let next: CoveragePagePayload | null = pages[0]!;
  while (next) {
    const t = performance.now();
    next = await runCoveragePage(coverage, next, { enqueueSmartItems: async (_shop, ids) => void (queued += ids.length) });
    pageTimes.push(performance.now() - t);
  }
  totalMs = performance.now() - started;
}, 600_000);

afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("a smart run over 5,000 products in two languages", () => {
  it("plans every product once per language, page by page", async () => {
    const [run] = await withTenant(shopId, (tx) => tx.smartAutoRun.findMany({ where: { shopId } }), app);
    expect(run).toMatchObject({ status: "RUNNING", resourcesChecked: PRODUCTS * 2, resourcesChanged: PRODUCTS * 2, itemsQueued: PRODUCTS * 2 });
    expect(run!.scanFinishedAt).not.toBeNull();
    const jobs = await withTenant(shopId, (tx) => tx.translationJob.findMany({ where: { shopId, smartRunId: run!.id }, orderBy: { targetLocale: "asc" } }), app);
    expect(jobs.map((j) => [j.targetLocale, j.totalItems, j.discoveryDone])).toEqual([
      ["de", PRODUCTS, true],
      ["fr", PRODUCTS, true],
    ]);
    const items = await withTenant(shopId, (tx) => tx.translationJobItem.count({ where: { shopId } }), app);
    expect(items).toBe(PRODUCTS * 2);
    expect(queued).toBe(PRODUCTS * 2);
  });

  it("reads and plans a page quickly", () => {
    const sorted = [...pageTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.info(`smart run: ${pageTimes.length} pages in ${Math.round(totalMs)} ms (median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms per page)`);
    // A page of 50 products: the store's read (simulated), the plan and the coverage sync.
    expect(median).toBeLessThan(250);
    expect(p95).toBeLessThan(1_000);
  });

  it("shows the settings page's estimate quickly with 10,000 coverage items", async () => {
    const context = { entitled: true, consent: true, available: true, allowed: ["de", "fr"], shopTimeZone: "Europe/Berlin" };
    const panel = await loadSmartPanel(shopId, context, app);
    // Title and description of every product, in both languages.
    const perProduct = store.products.get("gid://shopify/Product/1")!.filter((f) => f.key !== "handle").length;
    expect(perProduct).toBe(2);
    expect(panel.estimate).toBeGreaterThan(0);
    const timings: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      await loadSmartPanel(shopId, context, app);
      timings.push(performance.now() - t);
    }
    timings.sort((a, b) => a - b);
    expect(timings[3]!).toBeLessThan(300);
  });
});
