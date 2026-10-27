import { describe, expect, it } from "vitest";
import { analyzeMarkets, fetchMarkets, MarketsAccessError, type MarketInfo } from "../../app/.server/markets/markets";

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
