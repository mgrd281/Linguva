/**
 * The countries the shop sells to (its active markets) and the languages
 * offered there, for the Overview and the Markets page. Read-only; needs the
 * optional read_markets scope.
 *
 * Markets rarely change: they are read at most every five minutes per shop
 * (per process). A missing grant isn't cached, so countries appear as soon
 * as the merchant allows access.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { logger } from "../lib/logger";
import type { MarketCountries } from "../../lib/country-coverage";
import { fetchMarketCountries, fetchMarkets, MarketsAccessError, type MarketInfo } from "./markets";

type Admin = Pick<AdminApiContext, "graphql">;

export const COUNTRIES_CACHE_MS = 5 * 60_000;

export type MarketCountriesResult =
  | { access: false }
  | { access: true; markets: MarketCountries[] }
  /** Shopify didn't answer; the page works without the countries. */
  | { access: true; error: true };

const cache = new Map<string, { at: number; markets: MarketCountries[] }>();

/** Distinct languages of a market's web presences (null: it has none of its own). */
function offeredLocales(market: MarketInfo): MarketCountries["locales"] {
  if (!market.webPresences.length) return null;
  const seen = new Map<string, boolean>();
  for (const wp of market.webPresences) {
    for (const l of [wp.defaultLocale, ...wp.alternateLocales]) seen.set(l.locale, (seen.get(l.locale) ?? false) || l.published);
  }
  return [...seen].map(([locale, published]) => ({ locale, published }));
}

export async function loadMarketCountries(
  shopId: string,
  admin: Admin,
  isGranted: () => Promise<boolean>,
  now = Date.now(),
): Promise<MarketCountriesResult> {
  const cached = cache.get(shopId);
  if (cached && now - cached.at < COUNTRIES_CACHE_MS) return { access: true, markets: cached.markets };
  if (!(await isGranted())) return { access: false };
  try {
    const active = (await fetchMarkets(admin)).filter((m) => m.status === "ACTIVE");
    const markets: MarketCountries[] = [];
    // A few markets at a time: each regions query may cost up to 255 points.
    for (let i = 0; i < active.length; i += 3) {
      const batch = active.slice(i, i + 3);
      const countries = await Promise.all(batch.map((m) => fetchMarketCountries(admin, m.id)));
      batch.forEach((m, j) => markets.push({ name: m.name, status: m.status, countries: countries[j]!, locales: offeredLocales(m) }));
    }
    cache.set(shopId, { at: now, markets });
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    return { access: true, markets };
  } catch (error) {
    if (error instanceof MarketsAccessError) return { access: false };
    logger.warn({ shopId, err: (error as Error).message }, "markets could not be read");
    return { access: true, error: true };
  }
}

/** Tests only: forget cached markets. */
export function clearMarketCountriesCache() {
  cache.clear();
}
