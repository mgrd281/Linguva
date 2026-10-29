/**
 * Every other Shopify content type: the content overview (availability and
 * permissions), the shared editor (incl. theme content with many texts) and
 * bulk translation where it is allowed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
  process.env.AI_USER_REQUESTS_PER_MINUTE = "100";
  process.env.AI_SHOP_REQUESTS_PER_MINUTE = "100";
});

import { PrismaClient } from "@prisma/client";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { loadContentHub } from "../../app/.server/translation/content-hub";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import type { TranslatableKind } from "../../app/lib/resource-kinds";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const THEME = "gid://shopify/OnlineStoreThemeJsonTemplate/index?theme_id=42";

function store() {
  const s = new FakeShopifyStore(2);
  s.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
  s.addResource("LINK", "11", [{ key: "title", value: "Shop all", type: "SINGLE_LINE_TEXT_FIELD" }]);
  s.addResource("SHOP", "1", [
    { key: "meta_title", value: "Wool & Co", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "meta_description", value: "Warm clothes made from merino wool since 1991.", type: "MULTI_LINE_TEXT_FIELD" },
  ]);
  // Theme content: many texts, non-numeric resource id.
  const theme = Array.from({ length: 130 }, (_, i) => ({
    key: `section.hero_${i}.heading:${i}`,
    value: i === 77 ? "Free shipping over 50 €" : `Theme text ${i}`,
    type: "STRING",
  }));
  s.products.set(THEME, theme);
  s.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>You may return items within 30 days.</p>", type: "HTML" }]);
  s.addResource("EMAIL_TEMPLATE", "1", [
    { key: "title", value: "Order {{ order.name }} confirmed", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>Hi {{ customer.first_name }}, thanks for your order.</p>", type: "HTML" },
  ]);
  return s;
}

async function shop() {
  const { shop } = await upsertInstalledShop({ shopDomain: "content.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  return shop;
}

const ctx = (s: FakeShopifyStore, shopId: string, kind: TranslatableKind, resourceId: string, view?: EditorContext["view"]): EditorContext => ({
  admin: s.asAdmin(),
  shopId,
  actorId: "5",
  kind,
  resourceId,
  target: { locale: "de", name: "German", rtl: false },
  sourceName: "English",
  ...(view ? { view } : {}),
});

describe("content overview", () => {
  it("shows what can be translated, what needs a permission and what isn't available", async () => {
    const s = store();
    s.deniedTypes.add("SHOP_POLICY"); // optional scope read_legal_policies not granted
    s.deniedTypes.add("PAYMENT_GATEWAY"); // no documented scope
    const entries = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"]);
    const status = Object.fromEntries(entries.map((e) => [e.type, e.status]));
    expect(status).toMatchObject({
      MENU: "has-content",
      LINK: "has-content",
      SHOP: "has-content",
      ONLINE_STORE_THEME_JSON_TEMPLATE: "has-content",
      EMAIL_TEMPLATE: "has-content",
      FILTER: "empty",
      PAGE: "empty",
      SHOP_POLICY: "needs-permission",
      PAYMENT_GATEWAY: "unavailable",
    });
    expect(entries.find((e) => e.type === "SHOP_POLICY")).toMatchObject({ scope: "read_legal_policies", caution: "legal", bulk: false });
    // One probe per type, in batches (no unbounded fan-out).
    expect(s.calls.filter((c) => c === "LinguvaProbeTranslatable")).toHaveLength(entries.length);
  });

  it("treats a denial as unavailable once the permission was granted", async () => {
    const s = store();
    s.deniedTypes.add("SHOP_POLICY");
    const entries = await loadContentHub(s.asAdmin(), ["read_legal_policies"]);
    expect(entries.find((e) => e.type === "SHOP_POLICY")?.status).toBe("unavailable");
  });
});

describe("shared editor for every content type", () => {
  it("translates and publishes a menu", async () => {
    const s = store();
    const sh = await shop();
    const data = await loadEditorData(ctx(s, sh.id, "MENU", "gid://shopify/Menu/1"));
    expect(data).toMatchObject({ title: "Main menu", kind: { label: "Menus", path: "/app/content/menus" }, seoPreview: false, paging: null, caution: null });

    const ai = await runEditorAction(ctx(s, sh.id, "MENU", "gid://shopify/Menu/1"), form([["intent", "ai-translate"], ["key", "title"]]));
    expect(ai).toMatchObject({ kind: "ai", drafts: { title: "[de] Main menu" } });
    expect(s.translationOf("gid://shopify/Menu/1", "de", "title")).toBeUndefined();

    const digest = data.fields[0]!.digest;
    await runEditorAction(ctx(s, sh.id, "MENU", "gid://shopify/Menu/1"), form([["intent", "save"], ["value:title", "Hauptmenü"], ["digest:title", digest]]));
    expect(s.translationOf("gid://shopify/Menu/1", "de", "title")).toBe("Hauptmenü");
  });

  it("searches and pages theme content with many texts", async () => {
    const s = store();
    const sh = await shop();
    const first = await loadEditorData(ctx(s, sh.id, "ONLINE_STORE_THEME_JSON_TEMPLATE", THEME, { query: "", page: 1 }));
    expect(first.paging).toMatchObject({ total: 130, matching: 130, page: 1, pages: 3, pageSize: 50 });
    expect(first.fields).toHaveLength(50);
    const last = await loadEditorData(ctx(s, sh.id, "ONLINE_STORE_THEME_JSON_TEMPLATE", THEME, { query: "", page: 3 }));
    expect(last.fields).toHaveLength(30);
    // Out-of-range pages show the last page.
    expect((await loadEditorData(ctx(s, sh.id, "ONLINE_STORE_THEME_JSON_TEMPLATE", THEME, { query: "", page: 99 }))).paging?.page).toBe(3);

    const found = await loadEditorData(ctx(s, sh.id, "ONLINE_STORE_THEME_JSON_TEMPLATE", THEME, { query: "free SHIPPING", page: 1 }));
    expect(found.paging).toMatchObject({ matching: 1, pages: 1 });
    expect(found.fields.map((f) => f.source)).toEqual(["Free shipping over 50 €"]);

    // Saving one text of a page only changes that text.
    const field = found.fields[0]!;
    await runEditorAction(
      ctx(s, sh.id, "ONLINE_STORE_THEME_JSON_TEMPLATE", THEME),
      form([["intent", "save"], [`value:${field.key}`, "Kostenloser Versand ab 50 €"], [`digest:${field.key}`, field.digest]]),
    );
    expect(s.translationOf(THEME, "de", field.key)).toBe("Kostenloser Versand ab 50 €");
    expect([...s.translations.keys()].filter((k) => k.startsWith(THEME))).toHaveLength(1);
  });

  it("marks legal texts and Liquid templates and keeps Liquid unchanged", async () => {
    const s = store();
    const sh = await shop();
    expect((await loadEditorData(ctx(s, sh.id, "SHOP_POLICY", "gid://shopify/ShopPolicy/1"))).caution).toBe("legal");
    const email = await loadEditorData(ctx(s, sh.id, "EMAIL_TEMPLATE", "gid://shopify/EmailTemplate/1"));
    expect(email.caution).toBe("liquid");
    const ai = await runEditorAction(ctx(s, sh.id, "EMAIL_TEMPLATE", "gid://shopify/EmailTemplate/1"), form([["intent", "ai-translate"], ["key", "title"], ["key", "body_html"]]));
    if (!("kind" in ai) || ai.kind !== "ai") throw new Error("expected drafts");
    expect(ai.drafts.title).toContain("{{ order.name }}");
    expect(ai.drafts.body_html).toContain("{{ customer.first_name }}");
  });

  it("sends HTML to the page only sanitised, for the rendered preview", async () => {
    const s = store();
    s.addResource("PAGE", "9", [
      { key: "title", value: "About", type: "SINGLE_LINE_TEXT_FIELD" },
      { key: "body_html", value: `<p onclick="steal()">Hello <b>world</b></p><script>steal()</script><img src=x onerror=steal()>`, type: "HTML" },
    ]);
    const sh = await shop();
    const data = await loadEditorData(ctx(s, sh.id, "PAGE", "gid://shopify/Page/9"));
    const body = data.fields.find((f) => f.key === "body_html")!;
    expect(body.sourcePreview).toBe("<p>Hello <b>world</b></p>");
    // The editable original stays exactly as in Shopify.
    expect(body.source).toContain("<script>");
    expect(data.fields.find((f) => f.key === "title")!.sourcePreview).toBeNull();
  });

  it("shows the store's search listing without a page preview", async () => {
    const s = store();
    const sh = await shop();
    const data = await loadEditorData(ctx(s, sh.id, "SHOP", "gid://shopify/Shop/1"));
    expect(data).toMatchObject({ title: "Wool & Co", seoPreview: false });
    expect(data.fields.map((f) => f.key)).toEqual(["meta_title", "meta_description"]);
  });
});

describe("bulk translation of content types", () => {
  it("translates all menus and links in review mode, with a menu context for the AI", async () => {
    const s = store();
    const sh = await shop();
    await setBulkPublishMode({ shopId: sh.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const provider = new MockTranslationProvider();
    const deps: JobDependencies = { prisma: app, adminFor: async () => s.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:content-types" };
    const { job } = await createBulkJob({ shopId: sh.id, resourceType: "MENU", targetLocale: "de", requestedBy: null, idempotencyKey: "ct-1" }, app);
    const page = await runDiscoveryPage(deps, { shopId: sh.id, jobId: job.id });
    expect(page.itemIds).toHaveLength(1);
    await processItem(deps, { shopId: sh.id, itemId: page.itemIds[0]! }, 1);
    expect(s.translationOf("gid://shopify/Menu/1", "de", "title")).toBe("[de] Main menu");
    expect(provider.requests.some((r) => r.context === "Menu: Main menu")).toBe(true);
    // Links are their own type; the menu job leaves them alone.
    expect(s.translationOf("gid://shopify/Link/11", "de", "title")).toBeUndefined();
  });

  it("refuses bulk jobs for legal texts, templates and theme content", async () => {
    const sh = await shop();
    for (const resourceType of ["SHOP_POLICY", "EMAIL_TEMPLATE", "ONLINE_STORE_THEME"]) {
      await expect(
        createBulkJob({ shopId: sh.id, resourceType: resourceType as never, targetLocale: "de", requestedBy: null, idempotencyKey: `ct-${resourceType}` }, app),
      ).rejects.toThrow(/Unsupported resource type/);
    }
  });
});

function form(entries: Array<[string, string]>) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
