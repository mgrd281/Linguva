import { PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action as uninstalled } from "../../app/routes/webhooks.app.uninstalled";
import { action as dataRequest } from "../../app/routes/webhooks.customers.data_request";
import { action as customersRedact } from "../../app/routes/webhooks.customers.redact";
import { action as shopRedact } from "../../app/routes/webhooks.shop.redact";
import { action as content } from "../../app/routes/webhooks.content";
import { action as contentDelete } from "../../app/routes/webhooks.content.delete";
import { purgeWebhookLog, WEBHOOK_LOG_RETENTION_DAYS } from "../../app/.server/webhooks/process-webhook";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { loadCoverageSummary } from "../../app/.server/coverage/summary";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { byType } from "../../app/lib/coverage-view";
import { countAsOwner, ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { signedWebhookRequest } from "../support/webhooks";
import { resetConfigCache } from "../../app/.server/lib/config";
import { logger } from "../../app/.server/lib/logger";
import { ownDeepLKey } from "../support/engine-fixtures";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const SHOP = "webhooks.myshopify.com";

type Action = (args: ActionFunctionArgs) => Promise<Response>;

async function call(handler: Action, request: Request): Promise<Response> {
  try {
    return await handler({ request, params: {}, context: {} } as ActionFunctionArgs);
  } catch (thrown) {
    // The Shopify library signals auth failures by throwing a Response.
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("webhook authentication", () => {
  it.each([
    ["customers/data_request", "/webhooks/customers/data_request", dataRequest],
    ["customers/redact", "/webhooks/customers/redact", customersRedact],
    ["shop/redact", "/webhooks/shop/redact", shopRedact],
    ["app/uninstalled", "/webhooks/app/uninstalled", uninstalled],
    ["products/update", "/webhooks/content", content],
    ["products/delete", "/webhooks/content/delete", contentDelete],
  ])("returns 401 for %s with an invalid HMAC and does nothing", async (topic, path, handler) => {
    const response = await call(
      handler as Action,
      signedWebhookRequest({ path, topic, shop: SHOP, body: { shop_domain: SHOP }, secret: "wrong-secret" }),
    );
    expect(response.status).toBe(401);
    expect(await app.webhookEvent.count()).toBe(0);
    expect(await app.privacyRequest.count()).toBe(0);
  });

  it("rejects a body modified after signing", async () => {
    const request = signedWebhookRequest({
      path: "/webhooks/shop/redact",
      topic: "shop/redact",
      shop: SHOP,
      body: { shop_domain: SHOP },
    });
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ shop_domain: "other.myshopify.com" }),
    });
    expect((await call(shopRedact as Action, tampered)).status).toBe(401);
  });

  it("rejects non-POST requests", async () => {
    const response = await call(
      dataRequest as Action,
      new Request("https://linguva.test/webhooks/customers/data_request"),
    );
    expect(response.status).toBe(405);
  });
});

describe("compliance webhooks", () => {
  it("records customers/data_request as completed without storing customer data", async () => {
    const body = {
      shop_id: 1,
      shop_domain: SHOP,
      customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
      orders_requested: [299938],
      data_request: { id: 9999 },
    };
    const response = await call(
      dataRequest as Action,
      signedWebhookRequest({ path: "/webhooks/customers/data_request", topic: "customers/data_request", shop: SHOP, body }),
    );
    expect(response.status).toBe(200);
    const [request] = await app.privacyRequest.findMany();
    expect(request).toMatchObject({
      topic: "CUSTOMERS_DATA_REQUEST",
      status: "COMPLETED",
      resolution: "NO_CUSTOMER_DATA_STORED",
    });
    expect(request!.dueAt.getTime() - request!.receivedAt.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    // Customer identifiers are never persisted.
    const dump = JSON.stringify(await ownerDb.$queryRawUnsafe(`SELECT * FROM "PrivacyRequest"`));
    expect(dump).not.toContain("john@example.com");
    expect(dump).not.toContain("191167");
  });

  it("records customers/redact as completed", async () => {
    const response = await call(
      customersRedact as Action,
      signedWebhookRequest({
        path: "/webhooks/customers/redact",
        topic: "customers/redact",
        shop: SHOP,
        body: { shop_domain: SHOP, customer: { id: 1 }, orders_to_redact: [] },
      }),
    );
    expect(response.status).toBe(200);
    expect(await app.privacyRequest.count({ where: { topic: "CUSTOMERS_REDACT", status: "COMPLETED" } })).toBe(1);
  });

  it("shop/redact deletes all tenant data and keeps only the evidence record", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: SHOP }, app);
    const other = await upsertInstalledShop({ shopDomain: "keep.myshopify.com" }, app);
    await syncShopLocales(shop.id, [{ locale: "de", name: "German", primary: true, published: true, rtl: false }], app);
    await app.auditLog.createMany({ data: [{ shopId: shop.id, actorType: "SYSTEM", action: "test" }] });
    // Shopify sends shop/redact 48 hours after the uninstall. A session left for the domain goes too.
    await markShopUninstalled(SHOP, app);
    await app.session.create({ data: { id: `offline_${SHOP}`, shop: SHOP, state: "", accessToken: "v1.a.b.c.d" } });

    const response = await call(
      shopRedact as Action,
      signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: SHOP, body: { shop_id: 1, shop_domain: SHOP } }),
    );
    expect(response.status).toBe(200);

    expect(await app.shop.findUnique({ where: { shopDomain: SHOP } })).toBeNull();
    expect(await app.session.count({ where: { shop: SHOP } })).toBe(0);
    for (const table of ["ShopSettings", "ShopLocale", "ShopInstallation"]) {
      expect(await countAsOwner(table, shop.id)).toBe(0);
    }
    // Audit entries survive but no longer point at the shop.
    expect(await ownerDb.auditLog.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await ownerDb.auditLog.count({ where: { action: "test" } })).toBe(1);
    // Other tenants are untouched.
    expect(await countAsOwner("ShopSettings", other.shop.id)).toBe(1);
    expect(await app.privacyRequest.count({ where: { topic: "SHOP_REDACT", status: "COMPLETED" } })).toBe(1);
  });

  it("a replayed shop/redact (same signed body, new webhook id) after a reinstall deletes nothing", async () => {
    // Shopify's genuine delivery 48 hours after an uninstall erases the shop; someone keeps a copy.
    await upsertInstalledShop({ shopDomain: SHOP }, app);
    await call(uninstalled as Action, signedWebhookRequest({ path: "/webhooks/app/uninstalled", topic: "app/uninstalled", shop: SHOP, body: { domain: SHOP } }));
    const body = { shop_id: 1, shop_domain: SHOP };
    const genuine = signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: SHOP, body, webhookId: "redact-1" });
    const capturedHmac = genuine.headers.get("X-Shopify-Hmac-Sha256")!;
    expect((await call(shopRedact as Action, genuine)).status).toBe(200);
    expect(await app.shop.count({ where: { shopDomain: SHOP } })).toBe(0);

    // The merchant installs Linguva again and works with it.
    const { shop } = await upsertInstalledShop({ shopDomain: SHOP }, app);
    await syncShopLocales(shop.id, [{ locale: "de", name: "German", primary: true, published: true, rtl: false }], app);
    await app.session.create({ data: { id: `offline_${SHOP}`, shop: SHOP, state: "", accessToken: "v1.a.b.c.d" } });
    const warn = vi.spyOn(logger, "warn");

    // The HMAC covers only the body, so the copy passes it with any webhook id.
    const replay = signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: SHOP, body, webhookId: "redact-2", hmac: capturedHmac });
    expect((await call(shopRedact as Action, replay)).status).toBe(200);

    expect(await app.shop.findUnique({ where: { shopDomain: SHOP } })).toMatchObject({ id: shop.id, status: "ACTIVE" });
    expect(await app.session.count({ where: { shop: SHOP } })).toBe(1);
    for (const table of ["ShopSettings", "ShopLocale", "ShopInstallation"]) {
      expect(await countAsOwner(table, shop.id)).toBeGreaterThan(0);
    }
    expect(await app.webhookEvent.count({ where: { shopDomain: SHOP } })).toBe(2);
    // Recorded for the operator, not completed: a replay, or an uninstall that never reached the app.
    expect(await app.privacyRequest.findUnique({ where: { webhookId: "redact-2" } })).toMatchObject({
      topic: "SHOP_REDACT",
      status: "RECEIVED",
      completedAt: null,
      resolution: "SHOP_ACTIVE_NOT_DELETED",
    });
    expect(warn).toHaveBeenCalledWith({ webhookId: "redact-2", shopId: shop.id }, expect.stringMatching(/nothing deleted/));
    warn.mockRestore();
  });
});

describe("duplicate deliveries", () => {
  it("processes the same webhook id only once", async () => {
    await upsertInstalledShop({ shopDomain: SHOP }, app);
    const send = () =>
      call(
        uninstalled as Action,
        signedWebhookRequest({
          path: "/webhooks/app/uninstalled",
          topic: "app/uninstalled",
          shop: SHOP,
          body: { domain: SHOP },
          webhookId: "dup-webhook-1",
        }),
      );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const events = await app.webhookEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "PROCESSED", attempts: 1, topic: "APP_UNINSTALLED" });
    const shop = await app.shop.findUniqueOrThrow({ where: { shopDomain: SHOP } });
    expect(shop.status).toBe("UNINSTALLED");
    expect(await countAsOwner("ShopInstallation", shop.id)).toBe(2); // INSTALLED + one UNINSTALLED
  });

  it("allows a retry after a failed attempt", async () => {
    await app.webhookEvent.create({
      data: {
        webhookId: "retry-1",
        topic: "APP_UNINSTALLED",
        shopDomain: SHOP,
        payloadHash: "x",
        status: "FAILED",
      },
    });
    await upsertInstalledShop({ shopDomain: SHOP }, app);
    const response = await call(
      uninstalled as Action,
      signedWebhookRequest({
        path: "/webhooks/app/uninstalled",
        topic: "app/uninstalled",
        shop: SHOP,
        body: { domain: SHOP },
        webhookId: "retry-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(await app.webhookEvent.findUniqueOrThrow({ where: { webhookId: "retry-1" } })).toMatchObject({
      status: "PROCESSED",
      attempts: 2,
    });
  });
});

describe("content webhooks (automatic translation)", () => {
  it("accept a signed products/update and queue nothing while automatic translation is off", async () => {
    await upsertInstalledShop({ shopDomain: SHOP }, app);
    const response = await call(
      content as Action,
      signedWebhookRequest({
        path: "/webhooks/content",
        topic: "products/update",
        shop: SHOP,
        body: { admin_graphql_api_id: "gid://shopify/Product/1", updated_at: "2026-10-27T10:00:00Z" },
        webhookId: "content-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(await app.webhookEvent.findUniqueOrThrow({ where: { webhookId: "content-1" } })).toMatchObject({ status: "PROCESSED", topic: "PRODUCTS_UPDATE" });
  });
});

describe("deleted products and collections (coverage)", () => {
  async function scanned() {
    const { shop } = await upsertInstalledShop({ shopDomain: SHOP }, app);
    const store = new FakeShopifyStore(2).addCollections(1);
    const care = store.addMetafield("gid://shopify/Product/1", { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Wash cold" });
    const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:wh" };
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: null, idempotencyKey: "wh-scan" }, app);
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage(deps, next);
    return { shop, care };
  }
  const items = (shopId: string) =>
    withTenant(shopId, async (tx) => (await tx.coverageItem.findMany({ select: { locale: true, resourceGid: true } })).map((i) => `${i.locale} ${i.resourceGid}`).sort(), app);
  const send = (topic: string, body: unknown) => call(contentDelete as Action, signedWebhookRequest({ path: "/webhooks/content/delete", topic, shop: SHOP, body }));

  it("remove a deleted product with its custom fields in every language, and a deleted collection, at once", async () => {
    const { shop, care } = await scanned();
    // products/delete sends only the product's numeric id.
    expect((await send("products/delete", { id: 1 })).status).toBe(200);
    expect(await items(shop.id)).toEqual(["de gid://shopify/Collection/1", "de gid://shopify/Product/2", "fr gid://shopify/Collection/1", "fr gid://shopify/Product/2"]);
    expect(await items(shop.id)).not.toContain(`de ${care}`);
    expect((await send("collections/delete", { id: 1, published_scope: "web", admin_graphql_api_id: "gid://shopify/Collection/1" })).status).toBe(200);
    expect(await items(shop.id)).toEqual(["de gid://shopify/Product/2", "fr gid://shopify/Product/2"]);
    // The counts follow: product 2's title, description and URL; no custom field, no collection.
    const { counts } = await loadCoverageSummary(shop.id, app);
    for (const locale of ["de", "fr"]) {
      expect(byType(counts, locale).get("PRODUCT")?.counts).toMatchObject({ missing: 3 });
      expect(byType(counts, locale).has("PRODUCT_METAFIELD")).toBe(false);
      expect(byType(counts, locale).has("COLLECTION")).toBe(false);
    }
  });

  it("ignore a payload without a valid id for the topic's type", async () => {
    const { shop } = await scanned();
    const before = await items(shop.id);
    for (const body of [{ id: "1; DROP" }, { id: -1 }, { admin_graphql_api_id: "gid://shopify/Collection/1" }, {}]) {
      expect((await send("products/delete", body)).status).toBe(200);
    }
    expect(await items(shop.id)).toEqual(before);
  });
});

describe("webhook log retention", () => {
  it("deletes finished entries older than the retention period and keeps the rest", async () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const old = new Date(now.getTime() - (WEBHOOK_LOG_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(now.getTime() - 86_400_000);
    const row = (webhookId: string, status: "PROCESSED" | "FAILED" | "PROCESSING", receivedAt: Date) => ({
      webhookId,
      topic: "PRODUCTS_UPDATE",
      shopDomain: SHOP,
      payloadHash: "x",
      status,
      receivedAt,
    });
    await app.webhookEvent.createMany({
      data: [row("old-done", "PROCESSED", old), row("old-failed", "FAILED", old), row("old-running", "PROCESSING", old), row("recent", "PROCESSED", recent)],
    });
    expect(await purgeWebhookLog(app, now)).toBe(2);
    expect((await app.webhookEvent.findMany({ orderBy: { webhookId: "asc" } })).map((e) => e.webhookId)).toEqual(["old-running", "recent"]);
  });
});

describe("staging: stores the deployment doesn't serve", () => {
  const STAGING = { LINGUVA_STAGE: "staging", TRANSLATION_PROVIDER: "mock", ALLOWED_SHOPS: SHOP };

  beforeEach(() => {
    for (const [k, v] of Object.entries(STAGING)) vi.stubEnv(k, v);
    resetConfigCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it.each([
    ["a production store", "karinex.myshopify.com"],
    ["a store not on the list", "another-dev-store.myshopify.com"],
  ])("acknowledges and drops a signed webhook from %s, storing nothing", async (_label, shop) => {
    await upsertInstalledShop({ shopDomain: shop }, app);
    const response = await call(
      uninstalled as Action,
      signedWebhookRequest({ path: "/webhooks/app/uninstalled", topic: "app/uninstalled", shop, body: { domain: shop } }),
    );
    // 200: Shopify stops retrying; nothing recorded, the shop untouched.
    expect(response.status).toBe(200);
    expect(await app.webhookEvent.count()).toBe(0);
    expect((await ownerDb.shop.findUnique({ where: { shopDomain: shop } }))?.status).toBe("ACTIVE");
  });

  it("still refuses an invalid HMAC first (401), whatever the store", async () => {
    const response = await call(
      uninstalled as Action,
      signedWebhookRequest({ path: "/webhooks/app/uninstalled", topic: "app/uninstalled", shop: "karinex.myshopify.com", body: {}, secret: "wrong-secret" }),
    );
    expect(response.status).toBe(401);
  });

  it("processes webhooks of the listed test store as usual", async () => {
    await upsertInstalledShop({ shopDomain: SHOP }, app);
    const response = await call(
      uninstalled as Action,
      signedWebhookRequest({ path: "/webhooks/app/uninstalled", topic: "app/uninstalled", shop: SHOP, body: { domain: SHOP } }),
    );
    expect(response.status).toBe(200);
    expect(await app.webhookEvent.count()).toBe(1);
    expect((await ownerDb.shop.findUnique({ where: { shopDomain: SHOP } }))?.status).toBe("UNINSTALLED");
  });
});

describe("the store's own engine keys (Own key plan) and the lifecycle webhooks", () => {
  const keys = (shopId: string) => countAsOwner("ShopEngineCredential", shopId);
  const uninstall = () => call(uninstalled as Action, signedWebhookRequest({ path: "/webhooks/app/uninstalled", topic: "app/uninstalled", shop: SHOP, body: { domain: SHOP } }));

  it("app/uninstalled deletes the keys, also when the same delivery is replayed", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: SHOP }, app);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(1) }, { client: app });
    expect((await uninstall()).status).toBe(200);
    expect(await keys(shop.id)).toBe(0);
    expect((await uninstall()).status).toBe(200);
    expect(await keys(shop.id)).toBe(0);
  });

  it("shop/redact deletes a key left behind (cascade from the Shop row); a replay after a reinstall keeps the new keys", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: SHOP }, app);
    await markShopUninstalled(SHOP, app);
    await withTenant(
      shop.id,
      (tx) => tx.shopEngineCredential.create({ data: { shopId: shop.id, engine: "deepl", secret: "v1.test.aaaa.bbbb.cccc", hint: "abcd", dataLocation: "eu", deeplPlan: "free", verifiedAt: new Date() } }),
      ownerDb,
    );
    const body = { shop_id: 1, shop_domain: SHOP };
    const genuine = signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: SHOP, body, webhookId: "redact-keys-1" });
    const capturedHmac = genuine.headers.get("X-Shopify-Hmac-Sha256")!;
    expect((await call(shopRedact as Action, genuine)).status).toBe(200);
    expect(await keys(shop.id)).toBe(0);

    const again = (await upsertInstalledShop({ shopDomain: SHOP }, app)).shop;
    await seedOwnKey(again.id, { engine: "deepl", apiKey: ownDeepLKey(2) }, { client: app });
    const replay = signedWebhookRequest({ path: "/webhooks/shop/redact", topic: "shop/redact", shop: SHOP, body, webhookId: "redact-keys-2", hmac: capturedHmac });
    expect((await call(shopRedact as Action, replay)).status).toBe(200);
    expect(await keys(again.id)).toBe(1);
  });
});
