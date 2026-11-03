/**
 * The smart schedule's page loader (app/routes/app.settings_.automatic.tsx)
 * against PostgreSQL, with the session and billing stood in: its exclusions
 * are named by their titles and pictures as Shopify has them, read live in
 * one call (Linguva stores no merchant text), and a read that fails or an
 * item Shopify no longer has keeps the row by its kind and number, never
 * breaking the page.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const stand = vi.hoisted(() => ({
  shop: null as null | { id: string; shopDomain: string; name: string | null },
  admin: null as unknown,
  billing: null as unknown,
}));
vi.mock("../../app/.server/shopify/require-shop", () => ({
  requireShop: async () => ({ admin: stand.admin, shop: stand.shop, actorId: "42", session: {}, redirect: () => null, scopes: { query: async () => ({ granted: [] }) } }),
}));
vi.mock("../../app/.server/billing/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/billing/billing")>()),
  shopBilling: async () => stand.billing,
}));

import { PrismaClient } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { resetConfigCache } from "../../app/.server/lib/config";
import { resetQueueClient } from "../../app/.server/queue/client";
import { addSmartExclusion, saveSmartSettings } from "../../app/.server/smart/config";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { PLANS } from "../../app/lib/plans";
import { loader as smartLoader } from "../../app/routes/app.settings_.automatic";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();

beforeEach(async () => {
  await resetDatabase();
  resetConfigCache();
});
afterAll(async () => {
  await resetQueueClient();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const business: BillingStatus = {
  configured: true,
  state: "ACTIVE",
  entitlements: PLANS.business,
  subscription: {
    shopId: "",
    state: "ACTIVE",
    planHandle: "business",
    pendingPlanHandle: null,
    billingPeriod: "EVERY_30_DAYS",
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    currentPeriodEnd: new Date("2026-11-28T00:00:00.000Z"),
    checkedAt: new Date(),
    updatedAt: new Date(),
  },
  stale: false,
  mustChoosePlan: false,
};

let seq = 0;
async function standIn(admin: unknown) {
  const { shop } = await upsertInstalledShop({ shopDomain: `smart-page-${++seq}.myshopify.com`, name: "Smart Page Store" }, app);
  stand.shop = shop;
  stand.admin = admin;
  stand.billing = business;
  await saveSmartSettings(
    {
      shopId: shop.id,
      actorId: "42",
      version: 0,
      primaryLocale: "en",
      value: {
        mode: "daily",
        timeZone: "Europe/Berlin",
        times: [23 * 60],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        locales: ["de"],
        resourceTypes: ["PRODUCT", "COLLECTION"],
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
  return shop;
}
const page = async () => (await smartLoader({ request: new Request("http://app.test/app/settings/automatic"), params: {}, context: {} } as LoaderFunctionArgs)) as Awaited<ReturnType<typeof smartLoader>>;
const byGid = (exclusions: Awaited<ReturnType<typeof page>>["panel"]["exclusions"]) => Object.fromEntries(exclusions.map((e) => [e.resourceGid, e]));

describe("the smart page's exclusions", () => {
  it("are named by their titles and pictures as Shopify has them; one Shopify no longer has keeps its kind and number", async () => {
    const store = new FakeShopifyStore(2).addCollections(1);
    store.addImage("gid://shopify/Product/2", "A red jacket");
    const shop = await standIn(store.asAdmin());
    for (const gid of ["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Collection/1", "gid://shopify/Product/99"]) {
      expect(await addSmartExclusion({ shopId: shop.id, resourceGid: gid, actorId: "42" }, app)).not.toBe(false);
    }
    const exclusions = byGid((await page()).panel.exclusions);
    expect(exclusions["gid://shopify/Product/1"]).toMatchObject({ resourceType: "PRODUCT", title: "Product 1 jacket", image: null });
    expect(exclusions["gid://shopify/Collection/1"]).toMatchObject({ resourceType: "COLLECTION", title: "Collection 1 winter" });
    // Its picture at the size shown (Shopify's CDN width parameter).
    const picture = exclusions["gid://shopify/Product/2"]!;
    expect(picture.title).toBe("Product 2 jacket");
    expect(picture.image?.url).toMatch(/^https:\/\/cdn\.example\/.+\?width=80$/);
    expect(exclusions["gid://shopify/Product/99"]).toMatchObject({ resourceType: "PRODUCT", title: null, image: null });
    // The way to each one's editor stays.
    expect(exclusions["gid://shopify/Product/1"]!.href).toContain("/app/products/1");
  });

  it("are shown by kind and number when Shopify can't be read, and the page still loads", async () => {
    const store = new FakeShopifyStore(1);
    const failing = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("LinguvaPreviewNodes")) throw new Error("Shopify is down");
        return store.asAdmin().graphql(query, options);
      },
    };
    const shop = await standIn(failing);
    await addSmartExclusion({ shopId: shop.id, resourceGid: "gid://shopify/Product/1", actorId: "42" }, app);
    const loaded = await page();
    expect(loaded.panel.exclusions).toEqual([expect.objectContaining({ resourceGid: "gid://shopify/Product/1", title: null, image: null })]);
    expect(loaded.panel.config?.mode).toBe("daily");
  });

  it("make no call to Shopify when there are none", async () => {
    const store = new FakeShopifyStore(1);
    const asked: string[] = [];
    const counting = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        asked.push(/query (\w+)/.exec(query)?.[1] ?? "?");
        return store.asAdmin().graphql(query, options);
      },
    };
    await standIn(counting);
    expect((await page()).panel.exclusions).toEqual([]);
    expect(asked).not.toContain("LinguvaPreviewNodes");
  });
});
