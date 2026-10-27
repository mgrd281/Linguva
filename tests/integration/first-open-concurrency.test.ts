/**
 * A merchant's first open: Shopify loads the app and several loaders run
 * at once, each creating the same rows (settings, languages, subscription
 * cache). Found by the UI install test (a 500 in about 1 of 3 runs): Prisma
 * upserts read first and then insert, so parallel first writes hit the
 * unique constraint. They must all succeed and leave one row each.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getBillingStatus } from "../../app/.server/billing/subscription";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { getShopSettings, setAiConsent, setTranslationStyle } from "../../app/.server/settings/shop-settings";
import { findShopByDomain, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const PARALLEL = 8;

async function freshShop() {
  const { shop } = await upsertInstalledShop({ shopDomain: "first-open.myshopify.com", shopifyShopGid: "gid://shopify/Shop/77" }, app);
  return shop;
}

describe("first open, everything at once", () => {
  it("creates the settings row once while pages read and write settings in parallel", async () => {
    const shop = await freshShop();
    await withTenant(shop.id, (tx) => tx.shopSettings.deleteMany({ where: { shopId: shop.id } }), app);
    const results = await Promise.allSettled([
      ...Array.from({ length: PARALLEL }, () => getShopSettings(shop.id, app)),
      setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app),
      setTranslationStyle({ shopId: shop.id, formality: { de: "less" }, storeContext: "Wool", allowedLocales: ["de"] }, app),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await withTenant(shop.id, (tx) => tx.shopSettings.count(), app)).toBe(1);
    const settings = await getShopSettings(shop.id, app);
    expect(settings.formalityByLocale).toEqual({ de: "less" });
    expect(settings.aiDataProcessingConsentAt).not.toBeNull();
  });

  it("survives the install itself racing with page loads (as in the UI install test)", async () => {
    // Request A installs: the shop row is committed first, its settings row
    // in a second transaction. Requests B already find the shop (requireShop
    // then skips the install) and read the settings right away.
    for (let round = 0; round < 20; round++) {
      const domain = `race-${round}.myshopify.com`;
      const install = upsertInstalledShop({ shopDomain: domain }, app);
      const readers = Array.from({ length: 6 }, async () => {
        for (;;) {
          const shop = await findShopByDomain(domain, app);
          if (shop) return getShopSettings(shop.id, app);
          await new Promise((r) => setImmediate(r));
        }
      });
      const results = await Promise.allSettled([install, ...readers]);
      expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason).slice(0, 160))).toEqual([]);
    }
  });

  it("stores the shop's languages once when several pages sync them together", async () => {
    const shop = await freshShop();
    const locales = [
      { locale: "en", name: "English", primary: true, published: true, rtl: false },
      { locale: "de", name: "German", primary: false, published: true, rtl: false },
      { locale: "fr", name: "French", primary: false, published: false, rtl: false },
    ];
    const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => syncShopLocales(shop.id, locales, app)));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const rows = await withTenant(shop.id, (tx) => tx.shopLocale.findMany({ orderBy: { locale: "asc" } }), app);
    expect(rows.map((r) => [r.locale, r.published])).toEqual([["de", true], ["en", true], ["fr", false]]);
  });

  it("caches the subscription once when several pages check billing together", async () => {
    const shop = await freshShop();
    const api = fakePartnerApi({ handle: "pro" });
    const deps = { prisma: app, settings: PARTNER_SETTINGS, required: false, fetchImpl: api.fetchImpl };
    const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => getBillingStatus(deps, shop)));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    for (const r of results) if (r.status === "fulfilled") expect(r.value.entitlements.plan).toBe("pro");
    expect(await withTenant(shop.id, (tx) => tx.shopSubscription.count(), app)).toBe(1);
  });
});
