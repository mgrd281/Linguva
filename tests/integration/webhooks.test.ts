import { PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action as uninstalled } from "../../app/routes/webhooks.app.uninstalled";
import { action as dataRequest } from "../../app/routes/webhooks.customers.data_request";
import { action as customersRedact } from "../../app/routes/webhooks.customers.redact";
import { action as shopRedact } from "../../app/routes/webhooks.shop.redact";
import { action as content } from "../../app/routes/webhooks.content";
import { purgeWebhookLog, WEBHOOK_LOG_RETENTION_DAYS } from "../../app/.server/webhooks/process-webhook";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { countAsOwner, ownerDb, resetDatabase } from "../support/db";
import { signedWebhookRequest } from "../support/webhooks";
import { resetConfigCache } from "../../app/.server/lib/config";

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
    await app.session.create({ data: { id: `offline_${SHOP}`, shop: SHOP, state: "", accessToken: "v1.a.b.c.d" } });
    await app.auditLog.createMany({ data: [{ shopId: shop.id, actorType: "SYSTEM", action: "test" }] });

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
