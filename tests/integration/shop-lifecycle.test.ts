import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  markShopUninstalled,
  upsertInstalledShop,
} from "../../app/.server/tenancy/shop-service";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();
const DOMAIN = "lifecycle.myshopify.com";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function events(shopId: string) {
  const rows = await withTenant(
    shopId,
    (tx) => tx.shopInstallation.findMany({ orderBy: { occurredAt: "asc" } }),
    app,
  );
  return rows.map((r) => r.event);
}

describe("shop lifecycle", () => {
  it("installs once, is idempotent, and records reinstall after uninstall", async () => {
    const first = await upsertInstalledShop({ shopDomain: DOMAIN, name: "Demo", scopes: "read_products" }, app);
    expect(first.event).toBe("INSTALLED");
    const again = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(again.event).toBeNull();
    expect(again.shop.id).toBe(first.shop.id);

    await markShopUninstalled(DOMAIN, app);
    const after = await app.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(after.status).toBe("UNINSTALLED");
    // A repeated uninstall webhook doesn't add a second event.
    await markShopUninstalled(DOMAIN, app);

    const re = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(re.event).toBe("REINSTALLED");
    expect(re.shop.status).toBe("ACTIVE");
    expect(await events(first.shop.id)).toEqual(["INSTALLED", "UNINSTALLED", "REINSTALLED"]);

    const settings = await withTenant(first.shop.id, (tx) => tx.shopSettings.findMany(), app);
    expect(settings).toHaveLength(1);
  });

  it("deletes stored sessions on uninstall", async () => {
    await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await app.session.create({
      data: { id: `offline_${DOMAIN}`, shop: DOMAIN, state: "", accessToken: "v1.x.y.z.w" },
    });
    await markShopUninstalled(DOMAIN, app);
    expect(await app.session.count({ where: { shop: DOMAIN } })).toBe(0);
  });

  it("mirrors Shopify locales and removes locales that were disabled", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await syncShopLocales(shop.id, [
      { locale: "de", name: "German", primary: true, published: true, rtl: false },
      { locale: "ar", name: "Arabic", primary: false, published: false, rtl: true },
    ], app);
    await syncShopLocales(shop.id, [
      { locale: "de", name: "German", primary: true, published: true, rtl: false },
      { locale: "fr", name: "French", primary: false, published: true, rtl: false },
    ], app);
    const rows = await withTenant(shop.id, (tx) => tx.shopLocale.findMany({ orderBy: { locale: "asc" } }), app);
    expect(rows.map((r) => [r.locale, r.published])).toEqual([["de", true], ["fr", true]]);
  });
});

describe("concurrent installs", () => {
  // On first open, Shopify loads the app document and its loaders run in
  // parallel: each authenticates and records the shop at the same time.
  it("records a shop once when several requests install it at the same time", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        upsertInstalledShop({ shopDomain: DOMAIN, ...(i % 2 ? { shopifyShopGid: "gid://shopify/Shop/5" } : {}) }, app),
      ),
    );
    expect(new Set(results.map((r) => r.shop.id)).size).toBe(1);
    expect(results.filter((r) => r.event === "INSTALLED")).toHaveLength(1);
    const shop = await app.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(shop.shopifyShopGid).toBe("gid://shopify/Shop/5");
    expect(await withTenant(shop.id, (tx) => tx.shopInstallation.count(), app)).toBe(1);
    expect(await withTenant(shop.id, (tx) => tx.shopSettings.count(), app)).toBe(1);
  });

  it("records a reinstall once under concurrency", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await markShopUninstalled(DOMAIN, app);
    const results = await Promise.all(Array.from({ length: 4 }, () => upsertInstalledShop({ shopDomain: DOMAIN }, app)));
    expect(results.filter((r) => r.event === "REINSTALLED")).toHaveLength(1);
    expect(await withTenant(shop.id, (tx) => tx.shopInstallation.count({ where: { event: "REINSTALLED" } }), app)).toBe(1);
    expect((await app.shop.findUniqueOrThrow({ where: { id: shop.id } })).status).toBe("ACTIVE");
  });
});
