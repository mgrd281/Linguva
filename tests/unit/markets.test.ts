import { describe, expect, it } from "vitest";
import { analyzeMarkets, fetchMarketCountries, fetchMarkets, MarketsAccessError, type MarketInfo } from "../../app/.server/markets/markets";
import { clearMarketCountriesCache, COUNTRIES_CACHE_MS, loadMarketCountries } from "../../app/.server/markets/countries";

const loc = (locale: string, published = true) => ({ locale, name: locale.toUpperCase(), published });

function market(name: string, locales: Array<ReturnType<typeof loc>>, extra: Partial<MarketInfo> = {}): MarketInfo {
  const [first, ...rest] = locales;
  return {
    id: `gid://shopify/Market/${name}`,
    name,
    handle: name.toLowerCase(),
    status: "ACTIVE",
    webPresences: first
      ? [{ id: `wp-${name}`, host: null, subfolderSuffix: name.toLowerCase(), defaultLocale: first, alternateLocales: rest, rootUrls: [] }]
      : [],
    ...extra,
  };
}

const shopLocales = [
  { locale: "en", primary: true, published: true },
  { locale: "de", primary: false, published: true },
  { locale: "fr", primary: false, published: false },
  { locale: "ar", primary: false, published: true },
];

describe("market checks", () => {
  it("finds unpublished market languages, published languages in no market and plan gaps", () => {
    const findings = analyzeMarkets(
      [
        market("Germany", [loc("de"), loc("en")]),
        market("France", [loc("fr", false), loc("en")]),
        market("Draft", [loc("ar")], { status: "DRAFT" }),
        market("International", []),
      ],
      shopLocales,
      ["de"],
    );
    expect(findings).toEqual([
      { code: "UNPUBLISHED_LOCALE", market: "France", locale: "fr" },
      { code: "NO_WEB_PRESENCE", market: "International" },
      // Arabic is only in a draft market: customers can't reach it.
      { code: "LOCALE_IN_NO_MARKET", locale: "ar" },
      { code: "LOCALE_NOT_IN_PLAN", locale: "fr" },
    ]);
  });

  it("reports nothing for a consistent setup, and no plan findings without billing", () => {
    expect(analyzeMarkets([market("Germany", [loc("de"), loc("en")]), market("Arabia", [loc("ar")])], shopLocales, null)).toEqual([]);
  });

  it("doesn't flag languages as missing when no market has its own web presence", () => {
    // Everything is served from the primary domain with the language selector.
    expect(analyzeMarkets([market("International", [])], shopLocales, null)).toEqual([{ code: "NO_WEB_PRESENCE", market: "International" }]);
  });
});

describe("fetching markets", () => {
  const page = (names: string[], next: string | null) => ({
    data: {
      markets: {
        nodes: names.map((n) => ({
          id: `gid://shopify/Market/${n}`,
          name: n,
          handle: n,
          status: "ACTIVE",
          webPresences: { nodes: [{ id: "wp", subfolderSuffix: null, domain: { host: `${n}.example` }, defaultLocale: loc("de"), alternateLocales: [], rootUrls: [{ locale: "de", url: `https://${n}.example/` }] }] },
        })),
        pageInfo: { hasNextPage: Boolean(next), endCursor: next },
      },
    },
  });

  it("follows pagination and maps domains", async () => {
    const calls: unknown[] = [];
    const admin = {
      graphql: async (_q: string, options?: { variables?: { after?: string | null } }) => {
        calls.push(options?.variables?.after ?? null);
        return Response.json(options?.variables?.after ? page(["b"], null) : page(["a"], "c1"));
      },
    };
    const markets = await fetchMarkets(admin as never);
    expect(calls).toEqual([null, "c1"]);
    expect(markets.map((m) => [m.name, m.webPresences[0]!.host])).toEqual([["a", "a.example"], ["b", "b.example"]]);
  });

  it("turns a missing read_markets scope into MarketsAccessError, thrown or returned", async () => {
    const thrown = { graphql: async () => { throw Object.assign(new Error("GraphQL Client: Access denied for markets field. Required access: `read_markets` access scope.")); } };
    await expect(fetchMarkets(thrown as never)).rejects.toBeInstanceOf(MarketsAccessError);
    const returned = { graphql: async () => Response.json({ errors: [{ message: "Access denied for markets field.", extensions: { code: "ACCESS_DENIED" } }] }) };
    await expect(fetchMarkets(returned as never)).rejects.toBeInstanceOf(MarketsAccessError);
    const other = { graphql: async () => { throw new Error("network down"); } };
    await expect(fetchMarkets(other as never)).rejects.toThrow("network down");
  });
});

describe("countries of a market", () => {
  const regionsPage = (nodes: unknown[], next: string | null) => ({
    data: { market: { conditions: { regionsCondition: { regions: { nodes, pageInfo: { hasNextPage: Boolean(next), endCursor: next } } } } } },
  });

  it("reads countries page by page and turns states into their country", async () => {
    const calls: Array<string | null> = [];
    const admin = {
      graphql: async (_q: string, options?: { variables?: { id?: string; after?: string | null } }) => {
        calls.push(options?.variables?.after ?? null);
        return Response.json(
          options?.variables?.after
            ? regionsPage([{ country: { code: "US", name: "United States" } }, { country: { code: "US", name: "United States" } }], null)
            : regionsPage([{ code: "CZ", name: "Czechia" }, { code: "HU", name: "Hungary" }], "r1"),
        );
      },
    };
    expect(await fetchMarketCountries(admin as never, "gid://shopify/Market/1")).toEqual([
      { code: "CZ", name: "Czechia" },
      { code: "HU", name: "Hungary" },
      { code: "US", name: "United States" },
    ]);
    expect(calls).toEqual([null, "r1"]);
  });

  it("has no countries for markets not defined by regions", async () => {
    const admin = { graphql: async () => Response.json({ data: { market: { conditions: { regionsCondition: null } } } }) };
    expect(await fetchMarketCountries(admin as never, "gid://shopify/Market/2")).toEqual([]);
  });

  it("reports a revoked scope and other errors", async () => {
    const denied = { graphql: async () => Response.json({ errors: [{ message: "Access denied for market field.", extensions: { code: "ACCESS_DENIED" } }] }) };
    await expect(fetchMarketCountries(denied as never, "m")).rejects.toBeInstanceOf(MarketsAccessError);
    const failed = { graphql: async () => Response.json({ errors: [{ message: "Internal error" }] }) };
    await expect(fetchMarketCountries(failed as never, "m")).rejects.toThrow("Market regions query failed");
  });
});

describe("countries for the Overview", () => {
  const marketsBody = {
    data: {
      markets: {
        nodes: [
          { id: "gid://shopify/Market/1", name: "EU", handle: "eu", status: "ACTIVE", webPresences: { nodes: [] } },
          { id: "gid://shopify/Market/2", name: "Old", handle: "old", status: "DRAFT", webPresences: { nodes: [] } },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
  const admin = (counter: { calls: number }) => ({
    graphql: async (query: string) => {
      counter.calls++;
      return Response.json(query.includes("LinguvaMarketRegions") ? { data: { market: { conditions: { regionsCondition: { regions: { nodes: [{ code: "CZ", name: "Czechia" }], pageInfo: { hasNextPage: false } } } } } } } : marketsBody);
    },
  });

  it("reads active markets with their countries once per five minutes", async () => {
    clearMarketCountriesCache();
    const counter = { calls: 0 };
    const first = await loadMarketCountries("shop-a", admin(counter) as never, async () => true, 1_000);
    expect(first).toEqual({ access: true, markets: [{ name: "EU", status: "ACTIVE", countries: [{ code: "CZ", name: "Czechia" }], locales: null }] });
    expect(counter.calls).toBe(2);
    await loadMarketCountries("shop-a", admin(counter) as never, async () => true, 1_000 + COUNTRIES_CACHE_MS - 1);
    expect(counter.calls).toBe(2);
    await loadMarketCountries("shop-a", admin(counter) as never, async () => true, 1_000 + COUNTRIES_CACHE_MS);
    expect(counter.calls).toBe(4);
  });

  it("doesn't remember a missing grant, and keeps the page working when Shopify fails", async () => {
    clearMarketCountriesCache();
    const counter = { calls: 0 };
    expect(await loadMarketCountries("shop-b", admin(counter) as never, async () => false)).toEqual({ access: false });
    expect(counter.calls).toBe(0);
    expect((await loadMarketCountries("shop-b", admin(counter) as never, async () => true)).access).toBe(true);
    const broken = { graphql: async () => { throw new Error("socket hang up"); } };
    clearMarketCountriesCache();
    expect(await loadMarketCountries("shop-b", broken as never, async () => true)).toEqual({ access: true, error: true });
  });
});
