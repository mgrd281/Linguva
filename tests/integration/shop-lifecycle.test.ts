import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  markShopUninstalled,
  upsertInstalledShop,
} from "../../app/.server/tenancy/shop-service";
import { syncShopLocales } from "../../app/.server/locales/shop-locales";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { saveEngineKey } from "../../app/.server/credentials/service";
import type { KeyChecker } from "../../app/.server/credentials/checker";
import { ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { generousLimits, OWN_KEY_BILLING, seedOwnKey } from "../support/own-keys";

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

  it("marks the cached plan as cancelled and unchecked on uninstall (Shopify cancels the subscription)", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN, shopifyShopGid: "gid://shopify/Shop/77" }, app);
    const plan = {
      state: "ACTIVE" as const,
      planHandle: "pro",
      pendingPlanHandle: "starter",
      billingPeriod: "EVERY_30_DAYS",
      trialEndsAt: new Date("2026-11-05T00:00:00Z"),
      cancelAtEndOfCycle: true,
      currentPeriodEnd: new Date("2026-11-30T00:00:00Z"),
      checkedAt: new Date(),
    };
    await withTenant(shop.id, (tx) => tx.shopSubscription.create({ data: { shopId: shop.id, ...plan } }), app);
    await markShopUninstalled(DOMAIN, app);
    const row = await withTenant(shop.id, (tx) => tx.shopSubscription.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    expect(row).toMatchObject({
      state: "NONE",
      planHandle: null,
      pendingPlanHandle: null,
      billingPeriod: null,
      trialEndsAt: null,
      cancelAtEndOfCycle: false,
      currentPeriodEnd: null,
      checkedAt: new Date(0),
    });
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

describe("the store's own engine keys (Own key plan) follow the installation", () => {
  const keyCount = (shopId: string) => withTenant(shopId, (tx) => tx.shopEngineCredential.count(), ownerDb);
  const removedAudit = () => ownerDb.auditLog.findMany({ where: { action: "engine_key.removed", actorType: "SYSTEM" } });

  it("uninstall marks the shop UNINSTALLED, then deletes its keys, with one SYSTEM audit row", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    const other = (await upsertInstalledShop({ shopDomain: "keep-keys.myshopify.com" }, app)).shop;
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(1) }, { client: app });
    await seedOwnKey(shop.id, { engine: "google", apiKey: ownGoogleKey(1) }, { client: app });
    await seedOwnKey(other.id, { engine: "deepl", apiKey: ownDeepLKey(2) }, { client: app });
    await markShopUninstalled(DOMAIN, app);
    expect((await app.shop.findUniqueOrThrow({ where: { id: shop.id } })).status).toBe("UNINSTALLED");
    expect(await keyCount(shop.id)).toBe(0);
    expect(await keyCount(other.id)).toBe(1);
    const audit = await removedAudit();
    expect(audit.map((a) => [a.shopId, a.actorId, a.targetType, a.targetId, a.metadata])).toEqual([[shop.id, null, "shop", null, { engines: ["deepl", "google"], reason: "SHOP_UNINSTALLED" }]]);
    // A repeated uninstall without keys writes no second audit row.
    await markShopUninstalled(DOMAIN, app);
    expect(await removedAudit()).toHaveLength(1);
  });

  it("a replayed uninstall of an already uninstalled shop still deletes keys left behind", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await markShopUninstalled(DOMAIN, app);
    // A save can't add one any more; a key that outlived the uninstall (written by the owner role, as a leftover would be).
    await expect(seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(3) }, { client: app })).rejects.toThrow(/SHOP_INACTIVE/);
    expect(await keyCount(shop.id)).toBe(0);
    await withTenant(
      shop.id,
      (tx) =>
        tx.shopEngineCredential.create({
          data: { shopId: shop.id, engine: "deepl", secret: "v1.test.aaaa.bbbb.cccc", hint: "abcd", dataLocation: "eu", deeplPlan: "free", verifiedAt: new Date() },
        }),
      ownerDb,
    );
    await markShopUninstalled(DOMAIN, app);
    expect(await keyCount(shop.id)).toBe(0);
    expect((await app.shop.findUniqueOrThrow({ where: { id: shop.id } })).status).toBe("UNINSTALLED");
  });

  it("a reinstall starts without keys and deletes any left over", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(4) }, { client: app });
    await markShopUninstalled(DOMAIN, app);
    await withTenant(
      shop.id,
      (tx) =>
        tx.shopEngineCredential.create({
          data: { shopId: shop.id, engine: "google", secret: "v1.test.aaaa.bbbb.cccc", hint: "abcd", dataLocation: "global", verifiedAt: new Date() },
        }),
      ownerDb,
    );
    const re = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(re.event).toBe("REINSTALLED");
    expect(await keyCount(shop.id)).toBe(0);
  });

  it("a save whose check is still running when the uninstall happens writes nothing (SHOP_INACTIVE), also after a reinstall", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const entered = new Promise<void>((r) => (started = r));
    const checker: KeyChecker = async () => {
      started();
      await gate;
      return { state: "ok" };
    };
    const saving = saveEngineKey({ shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(5) } }, { client: app, mode: "live", checker, ...generousLimits() });
    await entered;
    await markShopUninstalled(DOMAIN, app);
    release();
    expect(await saving).toEqual({ ok: false, error: "SHOP_INACTIVE" });
    expect(await keyCount(shop.id)).toBe(0);
    await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(await keyCount(shop.id)).toBe(0);
    expect(await ownerDb.auditLog.count({ where: { action: { in: ["engine_key.saved", "engine_key.replaced"] } } })).toBe(0);
  });

  it("a save that finished before the uninstall is deleted by it", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    const results = await Promise.all([
      seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(6) }, { client: app }).then(() => "saved").catch(() => "refused"),
      markShopUninstalled(DOMAIN, app).then(() => "uninstalled"),
    ]);
    expect(results[1]).toBe("uninstalled");
    // Whichever came first: no key outlives the uninstall.
    expect(await keyCount(shop.id)).toBe(0);
  });

  it("a replayed uninstall of an installed own-key shop deletes its keys and pauses nothing", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await withTenant(shop.id, (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoTranslateNew: true } }), app);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(7) }, { client: app });
    await markShopUninstalled(DOMAIN, app);
    const settings = await withTenant(shop.id, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    expect(settings).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
    expect(await keyCount(shop.id)).toBe(0);
  });
});
