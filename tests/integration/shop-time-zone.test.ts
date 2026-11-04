/**
 * The store's time zone for every page (Jobs D1): the smart schedule's
 * zone when there is a schedule (no Shopify call), else Shopify's, else
 * UTC; kept per store for an hour in the process, so pages that poll never
 * wait for Shopify and Shopify is asked once per store and hour at most.
 * Shopify is the fake store throughout: no test here needs a real one.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { clearShopTimeZones, SHOP_TIME_ZONE_TTL_MS, shopTimeZone } from "../../app/.server/shopify/shop-time-zone";
import { saveSmartSettings } from "../../app/.server/smart/config";
import type { SmartSettingsValue } from "../../app/.server/smart/validate";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const T0 = Date.parse("2026-11-02T13:30:00Z");
const MINUTE = 60_000;

beforeEach(async () => {
  await resetDatabase();
  clearShopTimeZones();
});
afterAll(async () => {
  clearShopTimeZones();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function shop(domain = "zone.myshopify.com") {
  return (await upsertInstalledShop({ shopDomain: domain }, app)).shop;
}

const asked = (store: FakeShopifyStore) => store.calls.filter((name) => name === "LinguvaShopTimeZone").length;

const schedule = (timeZone: string): SmartSettingsValue => ({
  mode: "daily",
  timeZone,
  times: [23 * 60],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  locales: ["de"],
  resourceTypes: ["PRODUCT"],
  fieldGroups: [],
  includeAttached: false,
  publishMode: "DRAFT",
  replaceOutdatedMachine: true,
  dailyBudget: null,
  monthlyBudget: null,
});

describe("shopTimeZone", () => {
  it("a store without a schedule: Shopify's zone, asked once per store and hour", async () => {
    const { id } = await shop();
    const store = new FakeShopifyStore(0);
    store.timeZone = "America/New_York";
    expect(await shopTimeZone(id, store.asAdmin(), T0, app)).toBe("America/New_York");
    expect(asked(store)).toBe(1);
    // The page polls: kept, no call to Shopify.
    expect(await shopTimeZone(id, store.asAdmin(), T0 + 59 * MINUTE, app)).toBe("America/New_York");
    expect(asked(store)).toBe(1);
    // An hour later it is asked again (the store may have changed it in Shopify).
    store.timeZone = "America/Chicago";
    expect(await shopTimeZone(id, store.asAdmin(), T0 + SHOP_TIME_ZONE_TTL_MS, app)).toBe("America/Chicago");
    expect(asked(store)).toBe(2);
  });

  it("requests that arrive together share one lookup", async () => {
    const { id } = await shop();
    const store = new FakeShopifyStore(0);
    const zones = await Promise.all(Array.from({ length: 5 }, () => shopTimeZone(id, store.asAdmin(), T0, app)));
    expect(zones).toEqual(Array(5).fill("Europe/Berlin"));
    expect(asked(store)).toBe(1);
  });

  it("a store with a smart schedule: the schedule's zone, without asking Shopify", async () => {
    const { id } = await shop();
    expect(await saveSmartSettings({ shopId: id, actorId: "7", value: schedule("Asia/Tokyo"), version: 0, primaryLocale: "en" }, app)).not.toBeNull();
    const store = new FakeShopifyStore(0);
    expect(await shopTimeZone(id, store.asAdmin(), T0, app)).toBe("Asia/Tokyo");
    expect(store.calls).toEqual([]);
  });

  it("Shopify can't be asked: UTC, and Shopify isn't asked again within the hour", async () => {
    const { id } = await shop();
    const store = new FakeShopifyStore(0);
    store.failNext = { count: 1, error: () => new Error("Shopify is down") };
    expect(await shopTimeZone(id, store.asAdmin(), T0, app)).toBe("UTC");
    expect(await shopTimeZone(id, store.asAdmin(), T0 + 30 * MINUTE, app)).toBe("UTC");
    expect(store.calls).toEqual(["LinguvaShopTimeZone"]);
    // A page's time limit (a thrown 504 Response) is the same: UTC, the page still opens.
    const { id: other } = await shop("zone-timeout.myshopify.com");
    const timeout = {
      graphql: async () => {
        throw new Response("Shopify took too long to respond.", { status: 504 });
      },
    } as unknown as Pick<AdminApiContext, "graphql">;
    expect(await shopTimeZone(other, timeout, T0, app)).toBe("UTC");
  });

  it("only a real zone name: an offset or an unknown name from Shopify shows UTC; Shopify's spelling is kept", async () => {
    for (const [domain, answer, zone] of [
      ["zone-offset.myshopify.com", "+05:30", "UTC"],
      ["zone-unknown.myshopify.com", "Mars/Olympus_Mons", "UTC"],
      ["zone-kolkata.myshopify.com", "Asia/Kolkata", "Asia/Kolkata"],
    ] as const) {
      const { id } = await shop(domain);
      const store = new FakeShopifyStore(0);
      store.timeZone = answer;
      expect(await shopTimeZone(id, store.asAdmin(), T0, app), answer).toBe(zone);
    }
  });

  it("each store has its own entry", async () => {
    const berlin = await shop("zone-berlin.myshopify.com");
    const tokyo = await shop("zone-tokyo.myshopify.com");
    const berlinStore = new FakeShopifyStore(0);
    const tokyoStore = new FakeShopifyStore(0);
    tokyoStore.timeZone = "Asia/Tokyo";
    expect(await shopTimeZone(berlin.id, berlinStore.asAdmin(), T0, app)).toBe("Europe/Berlin");
    expect(await shopTimeZone(tokyo.id, tokyoStore.asAdmin(), T0, app)).toBe("Asia/Tokyo");
    expect(await shopTimeZone(berlin.id, berlinStore.asAdmin(), T0 + MINUTE, app)).toBe("Europe/Berlin");
    expect([asked(berlinStore), asked(tokyoStore)]).toEqual([1, 1]);
  });

  it("a failed database read isn't kept: the next request asks again", async () => {
    const { id } = await shop();
    const store = new FakeShopifyStore(0);
    const broken = { $transaction: async () => Promise.reject(new Error("database unavailable")) } as unknown as PrismaClient;
    await expect(shopTimeZone(id, store.asAdmin(), T0, broken)).rejects.toThrow("database unavailable");
    expect(await shopTimeZone(id, store.asAdmin(), T0 + MINUTE, app)).toBe("Europe/Berlin");
  });
});
