/**
 * A language's page, its previews and its category lists against a measured
 * store: the categories add up to the language's percentage (the Overview's
 * figure), previews and lists show open work first with names and pictures
 * read live, survive Shopify failing, and translating a category starts one
 * job per type behind the plan, consent, provider and queue gates.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { loadCoverageSummary } from "../../app/.server/coverage/summary";
import { finishItem } from "../../app/.server/jobs/bulk-jobs";
import {
  CATEGORY_PAGE_SIZE,
  clearLanguagePreviewsCache,
  loadCategoryItems,
  loadLanguagePage,
  loadLanguagePreviews,
  PREVIEWS_CACHE_MS,
  translateCategoryAction,
} from "../../app/.server/languages/language-page";
import { resetConfigCache } from "../../app/.server/lib/config";
import type { MarketCountriesResult } from "../../app/.server/markets/countries";
import { loadOverview } from "../../app/.server/overview/overview";
import { getQueues, resetQueueClient } from "../../app/.server/queue/client";
import { saveDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { headlineByLocale } from "../../app/lib/coverage-view";
import { CATEGORY_IDS, ITEM_STATES, type CategoryId } from "../../app/lib/language-categories";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
let n = 0;

beforeEach(async () => {
  await resetDatabase();
  clearLanguagePreviewsCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await resetQueueClient();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const LOCALES = [
  { locale: "en", name: "English", primary: true, published: true },
  { locale: "de", name: "German", primary: false, published: true },
  { locale: "fr", name: "French", primary: false, published: true },
  { locale: "ar", name: "Arabic", primary: false, published: false },
];

/**
 * An outdoor store, read in German: products 1-4 translated, product 5's
 * description outdated, product 6's last attempt failed, two collection
 * titles waiting for approval; menus, a filter, an option, the store's
 * listing, a policy, custom fields, pages, blog posts, images and a theme
 * text, all untranslated.
 */
async function outdoorShop(options: { products?: number; denied?: string[]; domain?: string } = {}) {
  const store = new FakeShopifyStore(options.products ?? 12).addCollections(3).addContent(2);
  store.locales = [...LOCALES];
  for (let i = 1; i <= 5; i++) {
    store.translate(P(i), "de", "title", `Produkt ${i} Jacke`);
    store.translate(P(i), "de", "body_html", `<p>Warme Jacke ${i}.</p>`);
  }
  store.updateSource(P(5), "body_html", "<p>Very warm jacket 5.</p>");
  store.addImage(P(1), "Red wool jacket, front view", "jacket");
  store.addImage(C(1), "Winter collection banner", "mountains");
  store.addMetafield(P(1), { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold.", name: "Care" });
  store.addMetafield(P(2), { namespace: "custom", key: "features", type: "list.single_line_text_field", value: '["Warm","Waterproof"]' });
  store.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("LINK", "1", [{ key: "title", value: "Hiking", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.translate("gid://shopify/Link/1", "de", "title", "Wandern");
  store.addResource("FILTER", "1", [{ key: "label", value: "Color", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("PRODUCT_OPTION", "1", [{ key: "name", value: "Size", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("SHOP", "1", [
    { key: "meta_title", value: "Alpine Outfitters", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "meta_description", value: "Warm and dry outdoor clothing for every season, made to last.", type: "MULTI_LINE_TEXT_FIELD" },
  ]);
  store.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>Returns within 30 days.</p>", type: "HTML" }]);
  store.addResource("ONLINE_STORE_THEME_JSON_TEMPLATE", "index?theme_id=1", [{ key: "section.hero.heading", value: "Welcome", type: "STRING" }]);
  for (const type of options.denied ?? []) store.deniedTypes.add(type);

  const { shop } = await upsertInstalledShop({ shopDomain: options.domain ?? `outdoor-${++n}.myshopify.com`, name: "Outdoor store" }, app);
  await measure(store, shop.id, ["de", "ar"]);
  // A failed attempt (the job is done), and drafts of two collection titles.
  const job = await withTenant(
    shop.id,
    (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: `failed-${n}`, status: "RUNNING", totalItems: 1, discoveryDone: true } }),
    app,
  );
  const item = await withTenant(shop.id, (tx) => tx.translationJobItem.create({ data: { shopId: shop.id, jobId: job.id, resourceGid: P(6) } }), app);
  await finishItem(shop.id, item.id, { status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" }, app);
  await saveDrafts(
    shop.id,
    [1, 2].map((i) => ({
      jobId: null,
      resourceGid: C(i),
      resourceTitle: null,
      locale: "de",
      key: "title",
      sourceDigest: digest(`Collection ${i} winter`),
      sourceValue: `Collection ${i} winter`,
      value: `Kollektion ${i} Winter`,
      segmentPairs: [],
      issues: [],
      provider: "test",
    })),
    app,
  );
  return { shop, store };
}

/** A complete measurement of the given languages. */
async function measure(store: FakeShopifyStore, shopId: string, locales: string[]) {
  const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:lang", pageSize: 50 };
  const { report } = await createCoverageReport({ shopId, locales, requestedBy: null, idempotencyKey: `measure-${++n}` }, app);
  let next: CoveragePagePayload | null = { shopId, reportId: report.id, segmentIndex: 0, cursor: null };
  while (next) next = await runCoveragePage(deps, next);
}

const available = { jobsAvailable: true, aiAvailable: true } as const;
const rejection = (promise: Promise<unknown>) => promise.then(() => null, (thrown: unknown) => thrown as Response);
const category = (page: Awaited<ReturnType<typeof loadLanguagePage>>, id: CategoryId) => page.categories.find((c) => c.id === id)!;

describe("the language page", () => {
  it("adds its categories up to the language's percentage, the Overview's figure", async () => {
    const { shop, store } = await outdoorShop();
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);

    expect(page.language).toEqual({ locale: "de", name: "German", published: true, rtl: false });
    expect(page.primary).toEqual({ locale: "en", name: "English" });
    expect(page.measured).toBe(true);
    expect(page.measuredAt).not.toBeNull();
    expect(page.categories.map((c) => c.id)).toEqual([...CATEGORY_IDS]);
    const sum = (key: "complete" | "total") => page.categories.reduce((total, c) => total + c.tally[key], 0);
    expect(sum("complete")).toBe(page.headline!.complete);
    expect(sum("total")).toBe(page.headline!.total);
    for (const state of ["complete", "review", "draft", "failed", "outdated", "missing"] as const) {
      expect(page.categories.reduce((total, c) => total + c.tally.counts[state], 0)).toBe(page.headline!.counts[state]);
    }
    // The same figure as the Overview's and the Coverage page's.
    expect(page.headline).toEqual(headlineByLocale((await loadCoverageSummary(shop.id, app)).counts).get("de"));
    const overview = await loadOverview(store.asAdmin(), shop, app, { jobsAvailable: true });
    expect(overview.progress.find((l) => l.locale === "de")).toMatchObject({ complete: page.headline!.complete, total: page.headline!.total, percent: page.headline!.percent });

    expect(category(page, "products").tally.counts).toEqual({ complete: 9, review: 0, draft: 0, failed: 2, outdated: 1, missing: 12 });
    expect(category(page, "products")).toMatchObject({ tier: "first", href: "/app/languages/de/products", items: 12, state: { kind: "ok" }, job: null, automatic: false });
    expect(category(page, "navigation").tally).toMatchObject({ complete: 1, total: 3 });
    // Things of several kinds have no item count; things nobody has none either.
    expect(category(page, "navigation").items).toBeNull();
    expect(category(page, "metaobjects")).toMatchObject({ items: 0, tally: { total: 0 }, textTypes: [] });
    expect(category(page, "products").textTypes).toEqual(["PRODUCT"]);
    expect(category(page, "blog").items).toBe(2);
    expect(category(page, "images").items).toBe(2);
    expect(page.steps).toEqual({ open: page.headline!.counts.missing + page.headline!.counts.outdated + page.headline!.counts.failed, waiting: 2, live: page.headline!.complete });
    // 10 of 56 texts are live (17 %); approving the two drafts makes it 21 %.
    expect(page.headline).toMatchObject({ complete: 10, total: 56, percent: 17 });
    expect(page.payoff).toBe(21);
    // Left out of the percentage: the theme's text, notifications and every URL handle.
    expect(page.extras.map((e) => [e.id, e.tally.total])).toEqual([
      ["theme", 1],
      ["notifications", 0],
      ["urls", 12 + 3 + 2 + 2 + 2],
    ]);
    expect(page.extras.map((e) => e.state)).toEqual([{ kind: "ok" }, { kind: "ok" }, null]);
  });

  it("puts approving first, then the categories that can be translated in bulk", async () => {
    const { shop, store } = await outdoorShop();
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(page.bulk).toMatchObject({ gate: null, publishMode: "DRAFT" });
    expect(page.next[0]).toEqual({ kind: "review", count: 2, payoff: 21, href: "/app/review?lang=de" });
    expect(page.next[1]).toMatchObject({ kind: "category", category: "products", missing: 12, outdated: 1, failed: 2, action: "translate", href: "/app/languages/de/products" });
    expect(page.next).toHaveLength(3);
    expect(category(page, "collections").review).toEqual({ count: 2, href: "/app/review?lang=de&type=COLLECTION" });
    expect(category(page, "products").review).toBeNull();

    // What "Translate" would do: open products, their texts, and the characters of their originals.
    const fields = (gid: string, keys: string[]) => store.products.get(gid)!.filter((f) => keys.includes(f.key));
    const chars = [...fields(P(5), ["body_html"]), ...[6, 7, 8, 9, 10, 11, 12].flatMap((i) => fields(P(i), ["title", "body_html"]))].reduce((total, f) => total + f.value.length, 0);
    expect(category(page, "products").bulk).toEqual({ types: ["PRODUCT"], texts: { missing: 12, outdated: 1, failed: 2 }, items: 8, chars, attached: true });
    // Shop & checkout: the store's listing, never the legal texts (one by one).
    expect(category(page, "checkout").bulk).toMatchObject({ types: ["SHOP"], texts: { missing: 2, outdated: 0, failed: 0 }, items: null, attached: false });
    expect(category(page, "checkout").tally.counts.missing).toBe(3);
    // Image descriptions and custom fields are never translated in bulk.
    expect(category(page, "images").bulk).toBeNull();
    expect(category(page, "customFields").bulk).toBeNull();
    expect(page.next.find((s) => s.kind === "category" && s.category === "images")).toBeUndefined();

    // Without the AI consent nothing starts in bulk: the steps open the lists instead.
    await setAiConsent({ shopId: shop.id, granted: false, actorId: "1" }, app);
    const gated = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(gated.bulk.gate).toBe("CONSENT_REQUIRED");
    expect(gated.next[1]).toMatchObject({ kind: "category", category: "products", action: "view" });
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, { ...available, aiAvailable: false })).bulk.gate).toBe("AI_NOT_CONFIGURED");
    expect((await loadLanguagePage(store.asAdmin(), shop, "de", app, { jobsAvailable: false, aiAvailable: true })).bulk.gate).toBe("JOBS_UNAVAILABLE");
  });

  it("shows a running job in its category, and the countries reading the language", async () => {
    const { shop, store } = await outdoorShop();
    const job = await withTenant(
      shop.id,
      (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "running", status: "RUNNING", totalItems: 5, succeededItems: 2, discoveryDone: true } }),
      app,
    );
    const markets = async (): Promise<MarketCountriesResult> => ({
      access: true,
      markets: [
        { name: "Europe", status: "ACTIVE", countries: [{ code: "DE", name: "Germany" }, { code: "AT", name: "Austria" }, { code: "CH", name: "Switzerland" }, { code: "FR", name: "France" }], locales: null },
        { name: "Japan", status: "DRAFT", countries: [{ code: "JP", name: "Japan" }], locales: null },
      ],
    });
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, { ...available, markets });
    expect(page.activeJobs).toBe(1);
    expect(category(page, "products").job).toEqual({ href: `/app/jobs/${job.id}`, done: 2, total: 5, discoveryDone: true });
    expect(category(page, "collections").job).toBeNull();
    expect(page.countries).toEqual([{ code: "AT", name: "Austria" }, { code: "DE", name: "Germany" }, { code: "CH", name: "Switzerland" }]);
    expect(page.marketCountries).toEqual(["DE", "AT", "CH", "FR"]);
    // Without the markets permission the page doesn't name countries.
    expect(await loadLanguagePage(store.asAdmin(), shop, "de", app, { ...available, markets: async () => ({ access: false }) })).toMatchObject({ countries: [], marketCountries: [] });
  });

  it("names the categories Linguva may not read, with where to allow it", async () => {
    const { shop, store } = await outdoorShop({ denied: ["MENU", "LINK", "SHOP_POLICY"] });
    const page = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(category(page, "navigation").state).toEqual({ kind: "no-access", types: ["MENU", "LINK"], href: "/app/content/menus" });
    expect(category(page, "checkout").state).toEqual({ kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content/policies" });
    expect(category(page, "products").state).toEqual({ kind: "ok" });
    // What it could read still adds up.
    expect(page.categories.reduce((total, c) => total + c.tally.total, 0)).toBe(page.headline!.total);
    expect(category(page, "navigation").tally.total).toBe(1);
  });

  it("has a page for a hidden language, none for an unknown one, and sends the original language to the Overview", async () => {
    const { shop, store } = await outdoorShop();
    const hidden = await loadLanguagePage(store.asAdmin(), shop, "ar", app, available);
    expect(hidden.language).toEqual({ locale: "ar", name: "Arabic", published: false, rtl: true });
    expect(hidden.measured).toBe(true);
    expect((await rejection(loadLanguagePage(store.asAdmin(), shop, "xx", app, available)))?.status).toBe(404);
    const primary = await rejection(loadLanguagePage(store.asAdmin(), shop, "en", app, available));
    expect(primary?.status).toBe(302);
    expect(primary?.headers.get("Location")).toBe("/app");
  });

  it("shows no figures for a language not counted yet, and offers to count it", async () => {
    const { shop, store } = await outdoorShop();
    const french = await loadLanguagePage(store.asAdmin(), shop, "fr", app, available);
    expect(french).toMatchObject({ measured: false, scanning: false, canCount: true, headline: null, steps: null, payoff: null, categories: [], extras: [] });
    expect(french.next).toEqual([{ kind: "count" }]);
    // Nothing can count without background jobs.
    expect((await loadLanguagePage(store.asAdmin(), shop, "fr", app, { ...available, jobsAvailable: false })).next).toEqual([]);

    // While a measurement reads it, it is being counted: no step, and German keeps its figures.
    await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: null, idempotencyKey: "again" }, app);
    const counting = await loadLanguagePage(store.asAdmin(), shop, "fr", app, available);
    expect(counting).toMatchObject({ measured: false, scanning: true, canCount: false, measurement: { state: "queued" }, next: [] });
    const german = await loadLanguagePage(store.asAdmin(), shop, "de", app, available);
    expect(german).toMatchObject({ measured: true, scanning: true, canCount: false });
    expect(german.headline).not.toBeNull();
  });
});

describe("previews", () => {
  it("show open work first, with names, translations and pictures", async () => {
    const { shop, store } = await outdoorShop();
    const previews = await loadLanguagePreviews(store.asAdmin(), shop, "de", app);

    const products = previews.products;
    expect(products.error).toBe(false);
    expect(products.items).toHaveLength(6);
    expect(products.items.slice(0, 2).map((i) => [i.original, i.state])).toEqual([
      ["Product 6 jacket", "failed"],
      ["Product 5 jacket", "outdated"],
    ]);
    const ranks = products.items.map((i) => ITEM_STATES.indexOf(i.state));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(products.items[1]).toMatchObject({ translated: "Produkt 5 Jacke", textState: "complete", href: "/app/products/5?lang=de", image: null });
    expect(products.items[0]).toMatchObject({ translated: null, textState: "failed" });

    // Pictures at the tile's size; a draft isn't live yet, so customers still see the original name.
    expect(previews.collections.items.find((i) => i.original === "Collection 1 winter")).toMatchObject({
      state: "missing",
      textState: "waiting",
      translated: null,
      image: { url: "https://cdn.example/__fixtures/img/mountains.svg?width=192", alt: "Winter collection banner" },
    });
    expect(previews.images.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "MEDIA_IMAGE", original: "Red wool jacket, front view", image: { url: "https://cdn.example/__fixtures/img/jacket.svg?width=192", alt: "Red wool jacket, front view" }, href: null }),
        expect.objectContaining({ type: "COLLECTION_IMAGE", original: "Winter collection banner", image: null }),
      ]),
    );

    // Texts beside their translations, open ones first; long, HTML and list values left out.
    expect(previews.navigation.items.map((i) => [i.original, i.translated, i.textState])).toEqual([
      ...previews.navigation.items.filter((i) => i.state === "missing").map((i) => [i.original, null, "missing"]),
      ["Hiking", "Wandern", "complete"],
    ]);
    expect(previews.navigation.items.map((i) => i.original).sort()).toEqual(["Color", "Hiking", "Main menu"]);
    expect(previews.customFields.items).toEqual([expect.objectContaining({ type: "PRODUCT_METAFIELD", original: "Hand wash cold.", label: "Care", href: "/app/products/1?lang=de" })]);
    expect(previews.checkout.items.map((i) => i.original)).toEqual(["Alpine Outfitters"]);
    expect(previews.pages.items.map((i) => i.original).sort()).toEqual(["About us 1", "About us 2"]);
    expect(previews.metaobjects).toEqual({ items: [], error: false });
  });

  it("are read from Shopify once a minute per language", async () => {
    const { shop, store } = await outdoorShop();
    // The measurement read custom fields by id too: count from here.
    const start = store.calls.length;
    const reads = () => store.calls.slice(start).filter((c) => c === "LinguvaPreviewNodes" || c === "LinguvaTranslatableByIds").length;
    const now = Date.now();
    const first = await loadLanguagePreviews(store.asAdmin(), shop, "de", app, now);
    const before = reads();
    expect(before).toBe(2);
    expect(await loadLanguagePreviews(store.asAdmin(), shop, "de", app, now + PREVIEWS_CACHE_MS - 1)).toBe(first);
    expect(reads()).toBe(before);
    await loadLanguagePreviews(store.asAdmin(), shop, "ar", app, now);
    expect(reads()).toBe(before + 2);
    await loadLanguagePreviews(store.asAdmin(), shop, "de", app, now + PREVIEWS_CACHE_MS);
    expect(reads()).toBe(before + 4);
  });

  it("survive Shopify failing: the items keep their states, without names, and nothing is kept", async () => {
    const { shop, store } = await outdoorShop();
    // Opened before (the shop's languages are known for a few minutes); then Shopify fails.
    await loadLanguagePreviews(store.asAdmin(), shop, "de", app);
    clearLanguagePreviewsCache();
    store.failNext = { count: 2, error: () => new Error("Shopify is unavailable") };
    const failed = await loadLanguagePreviews(store.asAdmin(), shop, "de", app);
    expect(failed.products.error).toBe(true);
    expect(failed.products.items.slice(0, 2)).toEqual([
      expect.objectContaining({ state: "failed", original: null, image: null, href: "/app/products/6?lang=de" }),
      expect.objectContaining({ state: "outdated", original: null }),
    ]);
    expect(failed.navigation.error).toBe(true);
    expect(failed.metaobjects.error).toBe(false);
    // The next load reads again.
    const read = await loadLanguagePreviews(store.asAdmin(), shop, "de", app);
    expect(read.products.error).toBe(false);
    expect(read.products.items[0]!.original).toBe("Product 6 jacket");
  });

  it("exist only for the shop's own additional languages", async () => {
    const { shop, store } = await outdoorShop();
    for (const locale of ["xx", "en"]) expect((await rejection(loadLanguagePreviews(store.asAdmin(), shop, locale, app)))?.status).toBe(404);
  });
});

describe("a category's list", () => {
  it("counts its items per state so they add up, and pages through them in state order", async () => {
    const { shop, store } = await outdoorShop({ products: 60 });
    const first = await loadCategoryItems(store.asAdmin(), shop, "de", "products", {}, app, available);
    expect(first.counts).toEqual({ all: 60, failed: 1, outdated: 1, missing: 54, waiting: 0, complete: 4 });
    expect(first.rows).toHaveLength(CATEGORY_PAGE_SIZE);
    expect(first.page).toMatchObject({ from: 1, to: 50, total: 60, number: 1 });
    expect(first.rows.slice(0, 2).map((r) => [r.reference, r.state])).toEqual([
      ["6", "failed"],
      ["5", "outdated"],
    ]);
    const second = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { after: first.page.nextCursor }, app, available);
    expect(second.page).toMatchObject({ from: 51, to: 60, total: 60, number: 2, nextCursor: null });
    const rows = [...first.rows, ...second.rows];
    expect(new Set(rows.map((r) => r.id)).size).toBe(60);
    const ranks = rows.map((r) => ITEM_STATES.indexOf(r.state));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(second.rows.slice(-4).map((r) => r.state)).toEqual(["complete", "complete", "complete", "complete"]);

    // One state: the same counts, its rows only.
    const missing = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { state: "missing" }, app, available);
    expect(missing.filter.state).toBe("missing");
    expect(missing.counts).toEqual(first.counts);
    expect(missing.page).toMatchObject({ from: 1, to: 50, total: 54 });
    expect(missing.rows.every((r) => r.state === "missing")).toBe(true);
    const rest = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { state: "missing", after: missing.page.nextCursor }, app, available);
    expect(rest.page).toMatchObject({ from: 51, to: 54, total: 54, nextCursor: null });
    // Anything else is every state.
    expect((await loadCategoryItems(store.asAdmin(), shop, "de", "products", { state: "nope", after: "2.not-a-uuid" }, app, available)).page).toMatchObject({ from: 1, total: 60 });
  });

  it("shows each row's texts, names, picture and editor", async () => {
    const { shop, store } = await outdoorShop();
    const complete = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { state: "complete" }, app, available);
    expect(complete.rows.find((r) => r.reference === "1")).toEqual({
      id: expect.any(String),
      type: "PRODUCT",
      reference: "1",
      state: "complete",
      texts: [
        { group: "title", state: "complete" },
        { group: "description", state: "complete" },
      ],
      counts: { complete: 2, review: 0, draft: 0, failed: 0, outdated: 0, missing: 0 },
      failureCode: null,
      href: "/app/products/1?lang=de",
      smart: null,
      title: "Product 1 jacket",
      translated: "Produkt 1 Jacke",
      label: null,
      image: { url: "https://cdn.example/__fixtures/img/jacket.svg?width=128", alt: "Red wool jacket, front view" },
    });
    const failed = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { state: "failed" }, app, available);
    expect(failed.rows).toEqual([expect.objectContaining({ reference: "6", failureCode: "PROVIDER_UNAVAILABLE", texts: [{ group: "title", state: "failed" }, { group: "description", state: "failed" }] })]);

    // Custom fields by their owner's name, picture and their own name; images by their description.
    const fields = await loadCategoryItems(store.asAdmin(), shop, "de", "customFields", {}, app, available);
    expect(fields.rows.map((r) => [r.title, r.label, r.href, r.image?.url ?? null]).sort()).toEqual([
      ["Product 1 jacket", "Care", "/app/products/1?lang=de", "https://cdn.example/__fixtures/img/jacket.svg?width=128"],
      ["Product 2 jacket", "Features", "/app/products/2?lang=de", null],
    ]);
    const images = await loadCategoryItems(store.asAdmin(), shop, "de", "images", {}, app, available);
    expect(images.rows.map((r) => [r.type, r.title, r.image?.url ?? null, r.href]).sort()).toEqual([
      ["COLLECTION_IMAGE", "Winter collection banner", null, null],
      ["MEDIA_IMAGE", "Red wool jacket, front view", "https://cdn.example/__fixtures/img/jacket.svg?width=128", null],
    ]);
    const navigation = await loadCategoryItems(store.asAdmin(), shop, "de", "navigation", {}, app, available);
    expect(navigation.rows.find((r) => r.type === "LINK")).toMatchObject({ title: "Hiking", translated: "Wandern", href: expect.stringMatching(/^\/app\/content\/menu-links\/[\w-]+\?lang=de$/) });
  });

  it("carries the category's figure, drafts, and what translating it would do", async () => {
    const { shop, store } = await outdoorShop();
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    const list = await loadCategoryItems(store.asAdmin(), shop, "de", "collections", {}, app, available);
    expect(list.category).toMatchObject({
      id: "collections",
      tier: "first",
      state: { kind: "ok" },
      tally: { total: 9, complete: 0, counts: { draft: 2, missing: 7 } },
      payoff: 22,
      review: { count: 2, href: "/app/review?lang=de&type=COLLECTION" },
      job: null,
      searchable: true,
    });
    expect(list.counts).toEqual({ all: 3, failed: 0, outdated: 0, missing: 3, waiting: 0, complete: 0 });
    expect(list.bulk).toMatchObject({ gate: null, publishMode: "DRAFT", estimate: { types: ["COLLECTION"], items: 3, texts: { missing: 7, outdated: 0, failed: 0 } } });
    expect(list.bulk.aiRemaining).toBeGreaterThan(0);
    expect(list.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(list).toMatchObject({ measured: true, scanning: false, canCount: true, measurement: { state: "done" }, countries: [], marketCountries: [] });

    // Where customers read the language, as on the language page.
    const markets = async (): Promise<MarketCountriesResult> => ({
      access: true,
      markets: [{ name: "DACH", status: "ACTIVE", countries: [{ code: "DE", name: "Germany" }, { code: "AT", name: "Austria" }], locales: null }],
    });
    expect(await loadCategoryItems(store.asAdmin(), shop, "de", "collections", {}, app, { ...available, markets })).toMatchObject({
      countries: [{ code: "AT", name: "Austria" }, { code: "DE", name: "Germany" }],
      marketCountries: ["DE", "AT"],
    });
  });

  it("finds items by title where Shopify can search them", async () => {
    const { shop, store } = await outdoorShop({ products: 60 });
    const found = await loadCategoryItems(store.asAdmin(), shop, "de", "products", { q: "  product 7 " }, app, available);
    expect(found.filter.q).toBe("product 7");
    expect(found.counts.all).toBe(1);
    expect(found.rows.map((r) => r.title)).toEqual(["Product 7 jacket"]);
    expect((await loadCategoryItems(store.asAdmin(), shop, "de", "products", { q: "kayak" }, app, available)).counts.all).toBe(0);
    // Menus and filters can't be searched: the words are ignored.
    const navigation = await loadCategoryItems(store.asAdmin(), shop, "de", "navigation", { q: "menu" }, app, available);
    expect(navigation.category.searchable).toBe(false);
    expect(navigation.filter.q).toBe("");
    expect(navigation.counts.all).toBe(3);
  });

  it("still lists its items when Shopify fails, and refuses unknown categories and languages", async () => {
    const { shop, store } = await outdoorShop();
    // The shop's languages are read first; then the names fail.
    const graphql = store.graphql;
    store.graphql = async (query, options) => {
      if (/LinguvaPreviewNodes/.test(query)) throw new Error("Shopify is unavailable");
      return graphql(query, options);
    };
    const list = await loadCategoryItems(store.asAdmin(), shop, "de", "products", {}, app, available);
    expect(list.titlesUnavailable).toBe(true);
    expect(list.rows).toHaveLength(12);
    expect(list.rows[0]).toMatchObject({ reference: "6", state: "failed", title: null, image: null, href: "/app/products/6?lang=de" });
    store.graphql = graphql;

    expect((await rejection(loadCategoryItems(store.asAdmin(), shop, "de", "nope", {}, app, available)))?.status).toBe(404);
    expect((await rejection(loadCategoryItems(store.asAdmin(), shop, "xx", "products", {}, app, available)))?.status).toBe(404);
    expect((await rejection(loadCategoryItems(store.asAdmin(), shop, "en", "products", {}, app, available)))?.headers.get("Location")).toBe("/app");
  });
});

describe("translating a category", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ intent: "translate-category", idempotencyKey: "0b8a3c2e-5d41-4c1e-9a7f-2f6d8e1b3c4a", ...fields })) data.append(key, value);
    return data;
  };
  const jobs = (shopId: string) =>
    withTenant(shopId, (tx) => tx.translationJob.findMany({ where: { shopId, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } }, orderBy: { resourceType: "asc" } }), app);

  const shops = new Set<string>();
  const queued = async () => ((await getQueues()?.discovery.getJobs(["waiting", "prioritized", "delayed"])) ?? []).filter((job) => shops.has(job.data.shopId));

  /** A store ready to translate: AI consent, the mock provider, background jobs (Redis). */
  async function ready(options: Parameters<typeof outdoorShop>[0] = {}) {
    vi.stubEnv("TRANSLATION_PROVIDER", "mock");
    resetConfigCache();
    const { shop, store } = await outdoorShop(options);
    shops.add(shop.id);
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    return { shop, store };
  }

  afterEach(async () => {
    // The discovery pages the jobs queued (no worker runs here).
    for (const job of await queued()) await job.remove();
  });

  it("starts one job per type with texts to translate, once, and opens it", async () => {
    const { shop, store } = await ready();
    const navigation = (await translateCategoryAction(store.asAdmin(), shop, { locale: "de", form: form({ category: "navigation" }), requestedBy: "7" }, app)) as Response;
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get("Location")).toBe("/app/jobs");
    // The link is translated already: menus and filters only.
    expect((await jobs(shop.id)).map((j) => [j.resourceType, j.targetLocale, j.requestedBy, j.idempotencyKey])).toEqual([
      ["FILTER", "de", "7", "0b8a3c2e-5d41-4c1e-9a7f-2f6d8e1b3c4a:FILTER"],
      ["MENU", "de", "7", "0b8a3c2e-5d41-4c1e-9a7f-2f6d8e1b3c4a:MENU"],
    ]);
    expect((await queued()).map((job) => job.data.jobId).sort()).toEqual((await jobs(shop.id)).map((j) => j.id).sort());
    // The same confirmation again starts nothing new.
    await translateCategoryAction(store.asAdmin(), shop, { locale: "de", form: form({ category: "navigation" }), requestedBy: "7" }, app);
    expect(await jobs(shop.id)).toHaveLength(2);

    const products = (await translateCategoryAction(store.asAdmin(), shop, { locale: "de", form: form({ category: "products", includeAttached: "on" }), requestedBy: "7" }, app)) as Response;
    const product = (await jobs(shop.id)).find((j) => j.resourceType === "PRODUCT")!;
    expect(products.headers.get("Location")).toBe(`/app/jobs/${product.id}`);
    expect(product).toMatchObject({ fieldScope: "ALL", includeAttached: true, publishMode: "DRAFT" });

    // Shop & checkout: the store's listing, never the legal texts.
    await translateCategoryAction(store.asAdmin(), shop, { locale: "de", form: form({ category: "checkout" }), requestedBy: "7" }, app);
    expect((await jobs(shop.id)).map((j) => j.resourceType)).toEqual(["FILTER", "MENU", "PRODUCT", "SHOP"]);
  });

  it("refuses what bulk jobs can't do, and requests it doesn't know", async () => {
    const { shop, store } = await ready();
    const act = (locale: string, fields: Record<string, string>) => translateCategoryAction(store.asAdmin(), shop, { locale, form: form(fields), requestedBy: null }, app);
    expect(await act("de", { category: "images" })).toEqual({ error: "INVALID_REQUEST" });
    expect(await act("de", { category: "customFields" })).toEqual({ error: "INVALID_REQUEST" });
    expect(await act("de", { category: "metaobjects" })).toEqual({ error: "NOTHING_TO_TRANSLATE" });
    expect(await act("de", { category: "nope" })).toEqual({ error: "INVALID_REQUEST" });
    expect(await act("de", { category: "products", idempotencyKey: "x" })).toEqual({ error: "INVALID_REQUEST" });
    expect(await act("de", { category: "products", intent: "translate" })).toEqual({ error: "UNKNOWN_INTENT" });
    for (const locale of ["xx", "en"]) expect(await act(locale, { category: "products" })).toEqual({ error: "INVALID_REQUEST" });
    expect(await jobs(shop.id)).toEqual([]);
  });

  it("starts nothing without the AI consent, a provider, the plan or the plan's language", async () => {
    const { shop, store } = await ready();
    const act = (locale = "de") => translateCategoryAction(store.asAdmin(), shop, { locale, form: form({ category: "products" }), requestedBy: null }, app);
    await setAiConsent({ shopId: shop.id, granted: false, actorId: "1" }, app);
    expect(await act()).toEqual({ error: "CONSENT_REQUIRED" });
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    vi.stubEnv("TRANSLATION_PROVIDER", "deepl");
    vi.stubEnv("DEEPL_API_KEY", "");
    resetConfigCache();
    expect(await act()).toEqual({ error: "AI_NOT_CONFIGURED" });

    // Billing on: the free plan has no bulk translation; Starter covers three languages (by name: Arabic, French, German).
    vi.stubEnv("TRANSLATION_PROVIDER", "mock");
    vi.stubEnv("SHOPIFY_PARTNER_ORG_ID", "1");
    vi.stubEnv("SHOPIFY_PARTNER_API_TOKEN", "partner-token");
    vi.stubEnv("SHOPIFY_APP_GID", "gid://shopify/App/1");
    resetConfigCache();
    const billed = await app.shop.update({ where: { id: shop.id }, data: { shopifyShopGid: `gid://shopify/Shop/${shop.id.slice(0, 8)}` } });
    const subscribe = (data: { state: "NONE" | "ACTIVE"; planHandle?: string }) =>
      withTenant(shop.id, (tx) => tx.shopSubscription.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, checkedAt: new Date(), ...data }, update: { checkedAt: new Date(), planHandle: null, ...data } }), app);
    const billedAct = (locale = "de") => translateCategoryAction(store.asAdmin(), billed, { locale, form: form({ category: "products" }), requestedBy: null }, app);
    await subscribe({ state: "NONE" });
    expect(await billedAct()).toEqual({ error: "PLAN_BULK" });
    store.locales = [...LOCALES, { locale: "es", name: "Spanish", primary: false, published: true }];
    await subscribe({ state: "ACTIVE", planHandle: "starter" });
    expect(await billedAct("es")).toEqual({ error: "PLAN_LANGUAGE" });
    expect((await loadLanguagePage(store.asAdmin(), billed, "es", app, available)).bulk.gate).toBe("PLAN_LANGUAGE");
    expect(await jobs(shop.id)).toEqual([]);
    expect(await billedAct("de")).toBeInstanceOf(Response);
    expect((await jobs(shop.id)).map((j) => j.resourceType)).toEqual(["PRODUCT"]);
  });
});
