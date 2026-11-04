/**
 * The glossary page's loader (app/routes/app.glossary.tsx) against PostgreSQL,
 * called as a function with the session, its access scopes and billing stood
 * in: the store's markets (a term's market choice) are read from Shopify at
 * most once a minute per shop, so adding, deleting or importing a term (each
 * revalidates the page) doesn't wait for Shopify; a missing grant and a
 * failed read aren't kept.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const stand = vi.hoisted(() => ({
  shop: null as null | { id: string; shopDomain: string; name: string | null },
  admin: null as unknown,
  billing: null as unknown,
  granted: [] as string[],
  scopeQueries: 0,
}));
vi.mock("../../app/.server/shopify/require-shop", () => ({
  requireShop: async () => ({
    admin: stand.admin,
    shop: stand.shop,
    actorId: "42",
    session: {},
    redirect: () => null,
    scopes: {
      query: async () => {
        stand.scopeQueries++;
        return { granted: stand.granted };
      },
    },
  }),
}));
vi.mock("../../app/.server/billing/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/billing/billing")>()),
  shopBilling: async () => stand.billing,
}));

import { PrismaClient } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { PLANS } from "../../app/lib/plans";
import { loader } from "../../app/routes/app.glossary";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

let seq = 0;
const market = (id: number, name: string, status: string) => ({ id: `gid://shopify/Market/${id}`, name, handle: name.toLowerCase(), status, webPresences: { nodes: [] } });

/** A shop whose Shopify answers the markets query (counted; `fail`: it doesn't answer), with the other queries from a fake store. */
async function standIn(name: string, granted: string[]) {
  const { shop } = await upsertInstalledShop({ shopDomain: `${name}-${++seq}.myshopify.com`, name: "Glossary Store" }, app);
  const store = new FakeShopifyStore(0);
  const markets = { reads: 0, fail: false };
  stand.shop = shop;
  stand.billing = { configured: true, entitlements: PLANS.pro };
  stand.granted = granted;
  stand.scopeQueries = 0;
  stand.admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (!/query LinguvaMarkets\b/.test(query)) return store.graphql(query, options);
      markets.reads++;
      if (markets.fail) throw new Error("Shopify didn't answer");
      return Response.json({ data: { markets: { nodes: [market(1, "Europe", "ACTIVE"), market(2, "Japan", "DRAFT")], pageInfo: { hasNextPage: false, endCursor: null } } } });
    },
  };
  return markets;
}

const page = async () => (await loader({ request: new Request("http://app.test/app/glossary"), params: {}, context: {} } as unknown as LoaderFunctionArgs)) as Awaited<ReturnType<typeof loader>>;
const CHOICES = [
  { id: "gid://shopify/Market/1", name: "Europe", active: true },
  { id: "gid://shopify/Market/2", name: "Japan", active: false },
];

describe("the glossary's market choice", () => {
  it("is read from Shopify once a minute: the page's revalidations don't ask again", async () => {
    const markets = await standIn("kept", ["read_markets"]);
    expect((await page()).markets).toEqual(CHOICES);
    // Adding a term revalidates the page: the markets come from the minute's read.
    expect((await page()).markets).toEqual(CHOICES);
    expect(markets.reads).toBe(1);
    expect(stand.scopeQueries).toBe(1);
  });

  it("keeps neither a missing grant nor a failed read", async () => {
    const markets = await standIn("not-kept", []);
    expect((await page()).markets).toEqual([]);
    expect(markets.reads).toBe(0);
    // Access allowed since: the next load asks again and shows the choice.
    stand.granted = ["read_markets"];
    markets.fail = true;
    expect((await page()).markets).toEqual([]);
    expect(stand.scopeQueries).toBe(2);
    // Shopify didn't answer: the form has no market choice, and the next load asks again.
    markets.fail = false;
    expect((await page()).markets).toEqual(CHOICES);
    expect((await page()).markets).toEqual(CHOICES);
    expect(markets.reads).toBe(2);
  });
});
