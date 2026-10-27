/**
 * Read-only Markets overview: which languages each market offers, under
 * which URLs, and what stops customers from seeing a translation.
 *
 * Needs the optional scope read_markets (requested by the merchant on the
 * Markets page). Linguva never changes markets or web presences.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

type Admin = Pick<AdminApiContext, "graphql">;

export const MARKETS_SCOPE = "read_markets";

const MARKETS_QUERY = `#graphql
  query LinguvaMarkets($after: String) {
    markets(first: 50, after: $after) {
      nodes {
        id
        name
        handle
        status
        webPresences(first: 10) {
          nodes {
            id
            subfolderSuffix
            domain {
              host
            }
            defaultLocale {
              locale
              name
              published
            }
            alternateLocales {
              locale
              name
              published
            }
            rootUrls {
              locale
              url
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface MarketLocale {
  locale: string;
  name: string;
  published: boolean;
}

export interface MarketWebPresence {
  id: string;
  /** Domain host, or null when the market uses subfolders of the primary domain. */
  host: string | null;
  subfolderSuffix: string | null;
  defaultLocale: MarketLocale;
  alternateLocales: MarketLocale[];
  rootUrls: Array<{ locale: string; url: string }>;
}

export interface MarketInfo {
  id: string;
  name: string;
  handle: string;
  status: string;
  webPresences: MarketWebPresence[];
}

export class MarketsAccessError extends Error {
  constructor() {
    super("read_markets not granted");
    this.name = "MarketsAccessError";
  }
}

type GraphqlErrorBody = { errors?: Array<{ message?: string; extensions?: { code?: string } }> | { message?: string } };

const isAccessDenied = (text: string) => /access denied|read_markets|ACCESS_DENIED/i.test(text);

/** All markets (at most 250) with their web presences. */
export async function fetchMarkets(admin: Admin): Promise<MarketInfo[]> {
  const markets: MarketInfo[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    let body: { data?: { markets?: { nodes: RawMarket[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } } } & GraphqlErrorBody;
    try {
      const response = await admin.graphql(MARKETS_QUERY, { variables: { after } });
      body = (await response.json()) as typeof body;
    } catch (error) {
      // The library throws on GraphQL errors; a missing scope surfaces here.
      if (isAccessDenied(JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})))) throw new MarketsAccessError();
      throw error;
    }
    if (body.errors && isAccessDenied(JSON.stringify(body.errors))) throw new MarketsAccessError();
    const connection = body.data?.markets;
    if (!connection) throw new Error("Markets query returned no data");
    markets.push(...connection.nodes.map(toMarket));
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor ?? null;
  }
  return markets;
}

type RawLocale = { locale: string; name: string; published: boolean };
type RawMarket = {
  id: string;
  name: string;
  handle: string;
  status: string;
  webPresences: {
    nodes: Array<{
      id: string;
      subfolderSuffix?: string | null;
      domain?: { host: string } | null;
      defaultLocale: RawLocale;
      alternateLocales: RawLocale[];
      rootUrls: Array<{ locale: string; url: string }>;
    }>;
  };
};

function toMarket(m: RawMarket): MarketInfo {
  return {
    id: m.id,
    name: m.name,
    handle: m.handle,
    status: m.status,
    webPresences: m.webPresences.nodes.map((wp) => ({
      id: wp.id,
      host: wp.domain?.host ?? null,
      subfolderSuffix: wp.subfolderSuffix ?? null,
      defaultLocale: wp.defaultLocale,
      alternateLocales: wp.alternateLocales,
      rootUrls: wp.rootUrls,
    })),
  };
}

export type MarketFinding =
  /** A market offers a language that isn't published: customers see the default language. */
  | { code: "UNPUBLISHED_LOCALE"; market: string; locale: string }
  /** A published language no active market offers: no storefront URL serves it. */
  | { code: "LOCALE_IN_NO_MARKET"; locale: string }
  /** A language the shop's plan doesn't cover for AI translation. */
  | { code: "LOCALE_NOT_IN_PLAN"; locale: string }
  /** An active market without its own web presence (served through the primary domain). */
  | { code: "NO_WEB_PRESENCE"; market: string };

/**
 * Checks markets against the shop's languages. `planLocales` is the list of
 * target languages the plan covers (null: no limit).
 */
export function analyzeMarkets(
  markets: readonly MarketInfo[],
  shopLocales: ReadonlyArray<{ locale: string; primary: boolean; published: boolean }>,
  planLocales: readonly string[] | null,
): MarketFinding[] {
  const findings: MarketFinding[] = [];
  const primary = shopLocales.find((l) => l.primary)?.locale;
  const active = markets.filter((m) => m.status === "ACTIVE");
  const offered = new Set<string>();
  const anyWebPresence = active.some((m) => m.webPresences.length > 0);

  for (const market of active) {
    if (!market.webPresences.length) findings.push({ code: "NO_WEB_PRESENCE", market: market.name });
    const seen = new Set<string>();
    for (const wp of market.webPresences) {
      for (const l of [wp.defaultLocale, ...wp.alternateLocales]) {
        offered.add(l.locale);
        if (!l.published && l.locale !== primary && !seen.has(l.locale)) {
          findings.push({ code: "UNPUBLISHED_LOCALE", market: market.name, locale: l.locale });
        }
        seen.add(l.locale);
      }
    }
  }
  if (anyWebPresence) {
    for (const l of shopLocales) {
      if (!l.primary && l.published && !offered.has(l.locale)) findings.push({ code: "LOCALE_IN_NO_MARKET", locale: l.locale });
    }
  }
  if (planLocales) {
    const allowed = new Set(planLocales);
    for (const locale of [...offered].sort()) {
      if (locale !== primary && !allowed.has(locale)) findings.push({ code: "LOCALE_NOT_IN_PLAN", locale });
    }
  }
  return findings;
}
