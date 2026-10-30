/**
 * The per-type lists (`/app/products`, `/app/content/<type>`): opened without
 * ?lang they show a visible language, never a hidden one while a visible one
 * exists; hidden languages are marked; and a type Shopify refuses although
 * its permission was granted offers no useless "Allow access".
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resourceListPage } from "../../app/.server/translation/resource-list";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

/** By Shopify's names: Arabic (hidden) comes first. */
const LOCALES = [
  { locale: "en", name: "English", primary: true, published: true },
  { locale: "de", name: "German", primary: false, published: true },
  { locale: "fr", name: "French", primary: false, published: true },
  { locale: "ar", name: "Arabic", primary: false, published: false },
];

async function setUp() {
  const store = new FakeShopifyStore(3);
  store.locales = [...LOCALES];
  store.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>Returns within 30 days.</p>", type: "HTML" }]);
  store.addResource("PAYMENT_GATEWAY", "1", [{ key: "name", value: "Invoice", type: "SINGLE_LINE_TEXT_FIELD" }]);
  const { shop } = await upsertInstalledShop({ shopDomain: "resource-lists.myshopify.com" }, app);
  return { store, shop };
}

describe("a type's list", () => {
  it("opens in a visible language without ?lang, keeps a valid ?lang and marks hidden languages", async () => {
    const { store, shop } = await setUp();
    const list = (lang: string | null) => resourceListPage(store.asAdmin(), shop, "PRODUCT", { lang, after: null, granted: async () => [] }, app);
    const page = await list(null);
    expect(page.target).toEqual({ locale: "fr", name: "French" });
    expect(page.targets).toEqual([
      { locale: "ar", name: "Arabic", published: false },
      { locale: "fr", name: "French", published: true },
      { locale: "de", name: "German", published: true },
    ]);
    expect(page.items).toHaveLength(3);
    expect((await list("de")).target?.locale).toBe("de");
    // A hidden language can still be opened on purpose.
    expect((await list("ar")).target?.locale).toBe("ar");
    expect((await list("xx")).target?.locale).toBe("fr");
    // Only hidden languages: then the first of them.
    store.locales = [LOCALES[0]!, LOCALES[3]!];
    expect((await list(null)).target?.locale).toBe("ar");
  });

  it("offers the permission only while granting it can help", async () => {
    const { store, shop } = await setUp();
    store.deniedTypes.add("SHOP_POLICY");
    store.deniedTypes.add("PAYMENT_GATEWAY");
    let granted: string[] = [];
    let reads = 0;
    const list = (type: "SHOP_POLICY" | "PAYMENT_GATEWAY" | "PRODUCT") =>
      resourceListPage(store.asAdmin(), shop, type, { lang: "de", after: null, granted: async () => (reads++, granted) }, app);

    expect((await list("SHOP_POLICY")).denied).toEqual({ scope: "read_legal_policies" });
    // Granted already, and Shopify still refuses: no button that can't help.
    granted = ["read_legal_policies"];
    expect((await list("SHOP_POLICY")).denied).toEqual({ scope: null });
    // A type without an optional scope never asks.
    expect((await list("PAYMENT_GATEWAY")).denied).toEqual({ scope: null });
    // The granted scopes are read only when Shopify refuses.
    reads = 0;
    expect((await list("PRODUCT")).denied).toBeNull();
    expect(reads).toBe(0);
  });
});
