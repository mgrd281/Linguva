/**
 * The smart page's exclusions by their names and pictures
 * (app/.server/smart/exclusion-names.ts): read from Shopify at most once a
 * minute per shop and item, so the page's reloads while a check runs don't
 * ask each time. An item Shopify no longer has is kept as missing; a failed
 * read isn't kept, and what was kept still shows.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { beforeEach, describe, expect, it } from "vitest";
import { clearExclusionNamesCache, EXCLUSION_NAMES_KEEP_MS, exclusionNodes } from "../../app/.server/smart/exclusion-names";
import { FakeShopifyStore } from "../support/fake-store";

const P = (n: number) => `gid://shopify/Product/${n}`;

/** The store as the Admin API, with the ids of each LinguvaPreviewNodes read. */
function counted(store: FakeShopifyStore) {
  const asked: string[][] = [];
  const admin = {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (query.includes("LinguvaPreviewNodes")) asked.push([...(options?.variables?.ids as string[])]);
      return store.graphql(query, options);
    },
  } as unknown as Pick<AdminApiContext, "graphql">;
  return { admin, asked };
}

beforeEach(() => clearExclusionNamesCache());

describe("the smart page's exclusion names", () => {
  it("are read once a minute per shop and item", async () => {
    const store = new FakeShopifyStore(2);
    const { admin, asked } = counted(store);
    const now = Date.now();
    expect((await exclusionNodes(admin, "shop-a", [P(1), P(2)], "de", now)).get(P(1))?.text).toBe("Product 1 jacket");
    // The page's reloads within the minute: nothing asked, the same names.
    const again = await exclusionNodes(admin, "shop-a", [P(1), P(2)], "de", now + EXCLUSION_NAMES_KEEP_MS - 1);
    expect([...again.keys()]).toEqual([P(1), P(2)]);
    expect(asked).toHaveLength(1);
    // Another shop asks for its own.
    await exclusionNodes(admin, "shop-b", [P(1)], "de", now);
    expect(asked).toEqual([[P(1), P(2)], [P(1)]]);
    // After the minute, asked again.
    await exclusionNodes(admin, "shop-a", [P(1), P(2)], "de", now + EXCLUSION_NAMES_KEEP_MS);
    expect(asked).toHaveLength(3);
  });

  it("ask only for what isn't kept, and keep an item Shopify no longer has as missing", async () => {
    const store = new FakeShopifyStore(2);
    const { admin, asked } = counted(store);
    const now = Date.now();
    expect([...(await exclusionNodes(admin, "shop-a", [P(1), P(99)], "de", now)).keys()]).toEqual([P(1)]);
    // A new exclusion: only it is read; the deleted one isn't asked again within the minute.
    const nodes = await exclusionNodes(admin, "shop-a", [P(1), P(99), P(2)], "de", now + 1000);
    expect([...nodes.keys()].sort()).toEqual([P(1), P(2)]);
    expect(asked).toEqual([[P(1), P(99)], [P(2)]]);
  });

  it("keep nothing from a failed read, and still show what was kept", async () => {
    const store = new FakeShopifyStore(2);
    const { admin, asked } = counted(store);
    const now = Date.now();
    await exclusionNodes(admin, "shop-a", [P(1)], "de", now);
    store.failNext = { count: 1, error: () => new Error("Shopify is down") };
    const failed = await exclusionNodes(admin, "shop-a", [P(1), P(2)], "de", now + 1000);
    expect([...failed.keys()]).toEqual([P(1)]);
    // The next reload asks again for the one that failed.
    expect([...(await exclusionNodes(admin, "shop-a", [P(1), P(2)], "de", now + 2000)).keys()].sort()).toEqual([P(1), P(2)]);
    expect(asked).toEqual([[P(1)], [P(2)], [P(2)]]);
  });

  it("make no call without exclusions", async () => {
    const store = new FakeShopifyStore(1);
    const { admin, asked } = counted(store);
    expect((await exclusionNodes(admin, "shop-a", [], "de")).size).toBe(0);
    expect(asked).toEqual([]);
  });
});
