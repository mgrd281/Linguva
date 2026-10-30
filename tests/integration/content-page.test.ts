/**
 * The Content page ("Inhalte") against a counted store: every type in its
 * one place from the live probes, the language's figures per area only
 * where they are honest, item counts from a counted language, the
 * permission rows by scope, the folds, the notes, the plan line, running
 * translations, content added since the last count, and the language shown
 * without ?lang.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { contentItemCounts, loadContentPage, type ContentPageInput } from "../../app/.server/content/content-page";
import { resetConfigCache } from "../../app/.server/lib/config";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { clearContentHubCache } from "../../app/.server/translation/content-hub";
import { HUB_TYPES } from "../../app/lib/content-areas";
import { categoryOf } from "../../app/lib/language-categories";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
let n = 0;

beforeEach(async () => {
  await resetDatabase();
  clearContentHubCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

/** As Shopify lists them: Arabic (hidden), French, German; English is the original. */
const LOCALES = [
  { locale: "en", name: "English", primary: true, published: true },
  { locale: "de", name: "German", primary: false, published: true },
  { locale: "fr", name: "French", primary: false, published: true },
  { locale: "ar", name: "Arabic", primary: false, published: false },
];
const THEME_TYPES = [
  "ONLINE_STORE_THEME",
  "ONLINE_STORE_THEME_LOCALE_CONTENT",
  "ONLINE_STORE_THEME_JSON_TEMPLATE",
  "ONLINE_STORE_THEME_SECTION_GROUP",
  "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
  "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
  "ONLINE_STORE_THEME_APP_EMBED",
];

/**
 * An outdoor store: six products (two titles in German, product 1 with a
 * picture and a custom field), two collections, a page, a menu, the store's
 * listing, a legal text, a theme template and an email template. No blog,
 * no options, no filters.
 */
function outdoorStore() {
  const store = new FakeShopifyStore(6).addCollections(2);
  store.locales = [...LOCALES];
  store.translate(P(1), "de", "title", "Produkt 1 Jacke");
  store.translate(P(2), "de", "title", "Produkt 2 Jacke");
  store.addImage(P(1), "Red wool jacket, front view", "jacket");
  store.addMetafield(P(1), { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
  store.addResource("PAGE", "1", [{ key: "title", value: "About us", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("SHOP", "1", [{ key: "meta_title", value: "Alpine Outfitters", type: "SINGLE_LINE_TEXT_FIELD" }]);
  store.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>Returns within 30 days.</p>", type: "HTML" }]);
  store.addResource("ONLINE_STORE_THEME_JSON_TEMPLATE", "index?theme_id=1", [{ key: "section.hero.heading", value: "Welcome", type: "STRING" }]);
  store.addResource("EMAIL_TEMPLATE", "1", [{ key: "title", value: "Order {{ order.name }} confirmed", type: "SINGLE_LINE_TEXT_FIELD" }]);
  return store;
}

/** A complete count of the given languages. */
async function measure(store: FakeShopifyStore, shopId: string, locales: string[]) {
  const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:content", pageSize: 50 };
  const { report } = await createCoverageReport({ shopId, locales, requestedBy: null, idempotencyKey: `content-${++n}` }, app);
  let next: CoveragePagePayload | null = { shopId, reportId: report.id, segmentIndex: 0, cursor: null };
  while (next) next = await runCoveragePage(deps, next);
}

async function shopFor(store: FakeShopifyStore, counted: string[] = ["de", "fr", "ar"]) {
  const { shop } = await upsertInstalledShop({ shopDomain: `content-page-${++n}.myshopify.com` }, app);
  if (counted.length) await measure(store, shop.id, counted);
  return shop;
}

/** Every optional permission the content types need, except legal texts (as the UI test store). */
const GRANTED = ["read_online_store_navigation", "read_themes", "read_metaobjects", "read_shipping"];

function load(store: FakeShopifyStore, shop: { id: string; shopifyShopGid: string | null }, input: Partial<ContentPageInput> = {}) {
  return loadContentPage(store.asAdmin(), shop, { granted: GRANTED, lang: null, open: null, ...input }, app, { jobsAvailable: true });
}

type Page = Awaited<ReturnType<typeof load>>;
const area = (page: Page, id: string) => page.areas.find((a) => a.id === id);

describe("the Content page", () => {
  it("shows the areas the store has, each in its tier, and lists everything else in its one place", async () => {
    const store = outdoorStore();
    store.deniedTypes.add("SHOP_POLICY"); // read_legal_policies isn't granted
    const shop = await shopFor(store);
    const page = await load(store, shop, { lang: "de" });

    expect(page.language).toEqual({ locale: "de", name: "German", published: true });
    expect(page.measured).toBe(true);
    // Areas with content now; none for options, metaobjects or the blog (not in the store).
    expect(page.areas.map((a) => [a.id, a.tier])).toEqual([
      ["products", "first"],
      ["collections", "first"],
      ["navigation", "first"],
      ["checkout", "beforeBuying"],
      ["pages", "content"],
    ]);
    expect(area(page, "products")).toMatchObject({ href: "/app/languages/de/products", state: "figure", items: 6, translating: false, pictures: true, locked: [], unavailable: [] });
    expect(area(page, "products")!.tally).toMatchObject({ complete: 2, total: 12 });
    expect(area(page, "navigation")).toMatchObject({ items: null, pictures: false });
    // Every type is in exactly one place: the eight in the store in their tiles and groups, the rest listed once.
    const inStore = ["PRODUCT", "COLLECTION", "MENU", "SHOP", "PAGE", "ONLINE_STORE_THEME_JSON_TEMPLATE", "EMAIL_TEMPLATE"];
    const listed = [...page.access.flatMap((row) => row.types), ...page.empty, ...page.unavailable, ...page.unknown];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...inStore, ...listed].sort()).toEqual([...HUB_TYPES].sort());
    expect(page.access).toEqual([{ scope: "read_legal_policies", types: ["SHOP_POLICY"] }]);
    // The tile names the refused type as the reason it shows no figure; its place is the card.
    expect(area(page, "checkout")).toMatchObject({ state: "refused", locked: ["SHOP_POLICY"], unavailable: [], tally: null });
    expect(page.unknown).toEqual([]);
    expect(page.empty).toEqual(HUB_TYPES.filter((type) => ![...inStore, "SHOP_POLICY"].includes(type)));
    // The folds keep the page's order: area by area.
    expect(page.empty.slice(0, 5)).toEqual(["LINK", "FILTER", "PRODUCT_OPTION", "PRODUCT_OPTION_VALUE", "DELIVERY_METHOD_DEFINITION"]);
    // The theme's and the notifications' parts, each a link to its list in the language.
    expect(page.extras.theme).toMatchObject({ state: "figure", parts: [{ type: "ONLINE_STORE_THEME_JSON_TEMPLATE", href: "/app/content/theme-templates?lang=de" }] });
    expect(page.extras.theme!.parts[0]!.tally).toMatchObject({ total: 1, complete: 0 });
    expect(page.extras.notifications).toMatchObject({ state: "figure", parts: [{ type: "EMAIL_TEMPLATE", href: "/app/content/email-templates?lang=de" }] });
    // Web addresses: the products' and collections' handles.
    expect(page.extras.urls).toMatchObject({ href: "/app/coverage/items?lang=de&group=url", tally: { total: 8 } });
    expect(page.nothing).toBe(false);
    expect(page.measuredAt).not.toBeNull();
    expect(page.canCount).toBe(true);
  });

  it("names the image descriptions and custom fields translated with an area's items only when they have texts", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    const page = await load(store, shop, { lang: "de" });
    expect(area(page, "products")!.attached).toEqual(["images", "customFields"]);
    expect(area(page, "collections")!.attached).toEqual([]);
    expect(area(page, "pages")!.attached).toEqual([]);

    const later = outdoorStore();
    later.addImage(C(1), "Winter collection banner", "mountains");
    const counted = await shopFor(later);
    expect(area(await load(later, counted, { lang: "de" }), "collections")!.attached).toEqual(["images"]);
  });

  it("shows no figures for a language that isn't counted, with item counts from a counted one", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store, ["de"]);
    const page = await load(store, shop, { lang: "fr" });
    expect(page.language?.locale).toBe("fr");
    expect(page.measured).toBe(false);
    expect(page.measuredAt).not.toBeNull();
    for (const a of page.areas) {
      expect(a.state, a.id).toBe("notCounted");
      expect(a.tally, a.id).toBeNull();
      expect(a.pictures, a.id).toBe(false);
    }
    // "6 products": the store's items, as German's count found them.
    expect(area(page, "products")!.items).toBe(6);
    expect(area(page, "collections")!.items).toBe(2);
    expect(page.extras.theme).toMatchObject({ state: "notCounted", tally: null });
    expect(page.extras.theme!.parts[0]!.tally).toBeNull();
    // Web addresses: listed without a figure, products have them.
    expect(page.extras.urls).toEqual({ tally: null, href: "/app/coverage/items?lang=fr&group=url" });
    // The chips: German counted with its figure, French not counted.
    expect(page.languages.map((l) => [l.locale, l.measured])).toEqual([
      ["ar", false],
      ["fr", false],
      ["de", true],
    ]);
    expect(page.languages.find((l) => l.locale === "de")).toMatchObject({ complete: 2, published: true, country: "DE" });
  });

  it("tells a refusal the merchant can lift from one nobody can, and content unlocked since the last count", async () => {
    const store = outdoorStore();
    store.addResource("PAYMENT_GATEWAY", "1", [{ key: "name", value: "Invoice", type: "SINGLE_LINE_TEXT_FIELD" }]);
    store.deniedTypes.add("SHOP_POLICY");
    store.deniedTypes.add("PAYMENT_GATEWAY"); // no scope: apps may not read it
    const shop = await shopFor(store);
    const refused = await load(store, shop, { lang: "de" });
    expect(area(refused, "checkout")).toMatchObject({ state: "refused", locked: ["SHOP_POLICY"], unavailable: ["PAYMENT_GATEWAY"], tally: null });
    expect(refused.unavailable).toEqual(["PAYMENT_GATEWAY"]);
    expect(refused.recount).toEqual([]);

    // The merchant allowed legal texts; Shopify lets apps read payment methods now too. The last count still has them refused.
    store.deniedTypes.clear();
    const unlocked = await load(store, shop, { lang: "de", granted: [...GRANTED, "read_legal_policies"] });
    expect(unlocked.access).toEqual([]);
    expect(area(unlocked, "checkout")).toMatchObject({ state: "recount", locked: [], unavailable: [], tally: null });
    expect(unlocked.recount).toEqual(["SHOP_POLICY", "PAYMENT_GATEWAY"]);
  });

  it("asks for each missing permission once, the theme's seven types as one row", async () => {
    const store = outdoorStore();
    for (const type of ["SHOP_POLICY", "MENU", "LINK", ...THEME_TYPES]) store.deniedTypes.add(type);
    const shop = await shopFor(store);
    const page = await load(store, shop, { lang: "de", granted: [] });
    expect(page.access).toEqual([
      { scope: "read_legal_policies", types: ["SHOP_POLICY"] },
      { scope: "read_online_store_navigation", types: ["MENU", "LINK"] },
      {
        scope: "read_themes",
        types: [
          "ONLINE_STORE_THEME_LOCALE_CONTENT",
          "ONLINE_STORE_THEME_JSON_TEMPLATE",
          "ONLINE_STORE_THEME_SECTION_GROUP",
          "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
          "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
          "ONLINE_STORE_THEME_APP_EMBED",
          "ONLINE_STORE_THEME",
        ],
      },
    ]);
    // Only content Shopify refused: metaobjects and shipping came back empty, so they need no question.
    expect(page.empty).toEqual(expect.arrayContaining(["METAOBJECT", "DELIVERY_METHOD_DEFINITION"]));
    // A fully locked area has no tile (navigation: menus refused, filters not in the store); the theme's group shows refused, with no parts.
    expect(area(page, "navigation")).toBeUndefined();
    expect(page.extras.theme).toMatchObject({ state: "refused", tally: null, parts: [], locked: page.access[2]!.types });
  });

  it("lists the parts of the theme and the notifications Linguva may read, also while another part is refused", async () => {
    const store = outdoorStore();
    store.addResource("ONLINE_STORE_THEME_LOCALE_CONTENT", "1", [{ key: "products.product.add_to_cart", value: "Add to cart", type: "STRING" }]);
    // Shopify refuses one part of each group although nothing can be granted (read_themes is).
    store.deniedTypes.add("ONLINE_STORE_THEME_APP_EMBED");
    store.deniedTypes.add("PACKING_SLIP_TEMPLATE");
    const shop = await shopFor(store);
    const page = await load(store, shop, { lang: "de" });
    // No figure while a part is refused, the refused part named, and the readable parts still listed, each a link.
    expect(page.extras.theme).toMatchObject({ state: "refused", tally: null, locked: [], unavailable: ["ONLINE_STORE_THEME_APP_EMBED"] });
    expect(page.extras.theme!.parts).toEqual([
      { type: "ONLINE_STORE_THEME_LOCALE_CONTENT", href: "/app/content/theme-locale?lang=de", tally: null },
      { type: "ONLINE_STORE_THEME_JSON_TEMPLATE", href: "/app/content/theme-templates?lang=de", tally: null },
    ]);
    expect(page.extras.notifications).toMatchObject({ state: "refused", unavailable: ["PACKING_SLIP_TEMPLATE"] });
    expect(page.extras.notifications!.parts).toEqual([{ type: "EMAIL_TEMPLATE", href: "/app/content/email-templates?lang=de", tally: null }]);
    // Every type has its place: the card, a fold or the banner, else (in the store) its area's tile or its group's part.
    const listed = new Set([...page.access.flatMap((row) => row.types), ...page.empty, ...page.unavailable, ...page.unknown]);
    const shown = new Set([
      ...page.areas.flatMap((a) => HUB_TYPES.filter((type) => categoryOf(type) === a.id)),
      ...[page.extras.theme, page.extras.notifications].flatMap((g) => g?.parts.map((p) => p.type) ?? []),
    ]);
    expect(HUB_TYPES.filter((type) => !listed.has(type) && !shown.has(type))).toEqual([]);
    expect(page.unavailable).toEqual(["ONLINE_STORE_THEME_APP_EMBED", "PACKING_SLIP_TEMPLATE"]);
  });

  it("keeps a refusal of the last count while Shopify doesn't answer for it, unless its permission was granted since", async () => {
    const store = outdoorStore();
    store.addResource("PAYMENT_GATEWAY", "1", [{ key: "name", value: "Invoice", type: "SINGLE_LINE_TEXT_FIELD" }]);
    store.deniedTypes.add("SHOP_POLICY");
    store.deniedTypes.add("PAYMENT_GATEWAY");
    const shop = await shopFor(store);
    // Shopify doesn't answer for either of them now.
    store.deniedTypes.clear();
    store.brokenTypes.add("SHOP_POLICY");
    store.brokenTypes.add("PAYMENT_GATEWAY");

    // Legal texts: still no permission, so still no access (never "access allowed"), and the card asks for it.
    const still = await load(store, shop, { lang: "de" });
    expect(area(still, "checkout")).toMatchObject({ state: "refused", locked: ["SHOP_POLICY"], unavailable: ["PAYMENT_GATEWAY"], tally: null });
    expect(still.access).toEqual([{ scope: "read_legal_policies", types: ["SHOP_POLICY"] }]);
    // Payment methods, with nothing to grant, stay where the last count put them.
    expect(still.unavailable).toEqual(["PAYMENT_GATEWAY"]);
    expect(still.unknown).toEqual([]);
    expect(still.recount).toEqual([]);

    // Granted since: counting again adds them, though Shopify didn't answer this time.
    const granted = await load(store, shop, { lang: "de", granted: [...GRANTED, "read_legal_policies"] });
    expect(granted.access).toEqual([]);
    expect(granted.unknown).toEqual(["SHOP_POLICY"]);
    expect(granted.recount).toEqual(["SHOP_POLICY"]);
    expect(area(granted, "checkout")).toMatchObject({ state: "refused", locked: [], unavailable: ["PAYMENT_GATEWAY"] });
    // Payment methods readable again: the area waits for the next count, as the notice says.
    store.brokenTypes.delete("PAYMENT_GATEWAY");
    const readable = await load(store, shop, { lang: "de", granted: [...GRANTED, "read_legal_policies"] });
    expect(area(readable, "checkout")).toMatchObject({ state: "recount", locked: [], unavailable: [] });
    expect(readable.recount).toEqual(["SHOP_POLICY", "PAYMENT_GATEWAY"]);

    // A type Shopify didn't refuse at the last count is simply not checked.
    store.brokenTypes.clear();
    store.brokenTypes.add("PAGE");
    const unchecked = await load(store, shop, { lang: "de" });
    expect(unchecked.unknown).toEqual(["PAGE"]);
    expect(area(unchecked, "pages")).toBeUndefined();
  });

  it("lists types Shopify didn't answer for, and the rest of the page as usual", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    store.brokenTypes.add("MENU");
    const page = await load(store, shop, { lang: "de" });
    expect(page.unknown).toEqual(["MENU"]);
    // Navigation has nothing else in the store: no tile while its menus are unknown.
    expect(area(page, "navigation")).toBeUndefined();
    expect(area(page, "products")!.state).toBe("figure");
  });

  it("says when the plan doesn't include the language (the free plan: the first language only)", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    vi.stubEnv("SHOPIFY_PARTNER_ORG_ID", "1");
    vi.stubEnv("SHOPIFY_PARTNER_API_TOKEN", "partner-token");
    vi.stubEnv("SHOPIFY_APP_GID", "gid://shopify/App/1");
    resetConfigCache();
    const billed = await app.shop.update({ where: { id: shop.id }, data: { shopifyShopGid: `gid://shopify/Shop/${shop.id.slice(0, 8)}` } });
    await withTenant(shop.id, (tx) => tx.shopSubscription.create({ data: { shopId: shop.id, checkedAt: new Date(), state: "NONE" } }), app);
    // By the app's order Arabic is first (the plan's one language), French second.
    expect((await load(store, billed, { lang: "fr" })).planIncludes).toBe(false);
    expect((await load(store, billed, { lang: "ar" })).planIncludes).toBe(true);
    // Without ?lang: never the hidden Arabic, though the plan includes only it.
    expect((await load(store, billed)).language?.locale).toBe("fr");
    // Without billing every language is included.
    vi.unstubAllEnvs();
    resetConfigCache();
    expect((await load(store, billed, { lang: "fr" })).planIncludes).toBe(true);
  });

  it("marks the area a translation into the language runs in, in that language only", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    await withTenant(
      shop.id,
      (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "running-de", status: "RUNNING", totalItems: 6, discoveryDone: true } }),
      app,
    );
    const german = await load(store, shop, { lang: "de" });
    expect(area(german, "products")!.translating).toBe(true);
    expect(area(german, "collections")!.translating).toBe(false);
    expect(area(await load(store, shop, { lang: "fr" }), "products")!.translating).toBe(false);
  });

  it("tells content added since the last count from nothing to translate", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    // A blog started after the count: the probe finds it, the count stored no item of it.
    store.addContent(1);
    const page = await load(store, shop, { lang: "de" });
    expect(area(page, "blog")).toMatchObject({ state: "new", tally: null });
    expect((await contentItemCounts(shop.id, "de", app)).get("ARTICLE")).toBeUndefined();
    // Pages were counted: their figure, as counted.
    expect(area(page, "pages")!.state).toBe("figure");
    expect((await contentItemCounts(shop.id, "de", app)).get("PAGE")).toEqual({ all: 1, texts: 1 });
  });

  it("lands on a visible language with the most open work without ?lang, and keeps a valid ?lang", async () => {
    const store = outdoorStore();
    store.translate(P(3), "fr", "title", "Produit 3 veste");
    const shop = await shopFor(store);
    // German has two titles translated, French one: French has more open work. Arabic (hidden) has the most, but is hidden.
    expect((await load(store, shop)).language?.locale).toBe("fr");
    expect((await load(store, shop, { lang: "de" })).language?.locale).toBe("de");
    expect((await load(store, shop, { lang: "ar" })).language).toEqual({ locale: "ar", name: "Arabic", published: false });
    expect((await load(store, shop, { lang: "xx" })).language?.locale).toBe("fr");
  });

  it("accepts only the two groups for ?open", async () => {
    const store = outdoorStore();
    const shop = await shopFor(store);
    expect((await load(store, shop, { open: "theme" })).open).toBe("theme");
    expect((await load(store, shop, { open: "notifications" })).open).toBe("notifications");
    expect((await load(store, shop, { open: "<script>" })).open).toBeNull();
    expect((await load(store, shop, { open: "urls" })).open).toBeNull();
  });

  it("without a language still shows what the store has, with no figures and no links", async () => {
    const store = outdoorStore();
    store.locales = [LOCALES[0]!];
    const shop = await shopFor(store, []);
    const page = await load(store, shop);
    expect(page.language).toBeNull();
    expect(page.languages).toEqual([]);
    expect(page.areas.length).toBeGreaterThan(0);
    expect(page.areas.every((a) => a.href === null && a.tally === null)).toBe(true);
    expect(page.extras.theme!.parts.every((p) => p.href === null)).toBe(true);
    expect(page.extras.urls).toBeNull();
    expect(page.planIncludes).toBe(false);
  });

  it("says when the store has nothing to translate at all", async () => {
    const store = new FakeShopifyStore(0);
    store.locales = [...LOCALES];
    const shop = await shopFor(store, []);
    const page = await load(store, shop);
    expect(page.nothing).toBe(true);
    expect(page.areas).toEqual([]);
    expect(page.empty).toHaveLength(26);
    expect(page.language?.locale).toBe("fr");
    expect(page.measured).toBe(false);
  });

  it("never says there is nothing to translate while Shopify didn't answer for a type, or a permission is missing", async () => {
    const store = new FakeShopifyStore(0);
    store.locales = [...LOCALES];
    const shop = await shopFor(store, []);
    // Products weren't checked: there may be some.
    store.brokenTypes.add("PRODUCT");
    const unchecked = await load(store, shop);
    expect(unchecked.unknown).toEqual(["PRODUCT"]);
    expect(unchecked.nothing).toBe(false);
    // Every type unanswered (Shopify had a bad moment).
    for (const type of HUB_TYPES) store.brokenTypes.add(type);
    expect((await load(store, shop)).nothing).toBe(false);
    // Legal texts Linguva may not read yet: they may exist.
    store.brokenTypes.clear();
    store.deniedTypes.add("SHOP_POLICY");
    const locked = await load(store, shop, { granted: [] });
    expect(locked.access).toEqual([{ scope: "read_legal_policies", types: ["SHOP_POLICY"] }]);
    expect(locked.nothing).toBe(false);
    // What Shopify doesn't let apps read is no work for Linguva: nothing to translate.
    const refused = await load(store, shop, { granted: ["read_legal_policies"] });
    expect(refused.unavailable).toEqual(["SHOP_POLICY"]);
    expect(refused.nothing).toBe(true);
  });
});
