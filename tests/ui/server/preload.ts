/**
 * Loaded with `node --import` into the UI test server only (never into the
 * app): replaces outbound fetch to Shopify with the simulated stores of
 * tests/ui/fixtures/shops.ts. The app code, its authentication and its
 * session token checks run unchanged.
 *
 * - POST https://<shop>/admin/oauth/access_token   token exchange (install)
 * - POST https://<shop>/admin/api/<v>/graphql.json Admin GraphQL
 * - POST https://partners.shopify.com/...          Partner API subscription
 * Any other request to a Shopify host is refused, so a test can never reach
 * a real store.
 *
 * The stores' images point at this server, which serves their pictures
 * (tests/support/fixture-images.ts) under /__fixtures/img/ the way
 * Shopify's CDN serves a store's images, before the app sees the request.
 */
import { Server, type IncomingMessage, type ServerResponse } from "node:http";
import { shopByDomain, UI_ENV, UI_SHOPS, type UiShop } from "../fixtures/shops";
import type { FakeShopifyStore } from "../../support/fake-store";
import { FIXTURE_IMAGE_PATH, fixturePicture } from "../../support/fixture-images";

const realFetch = globalThis.fetch.bind(globalThis);
const REQUIRED_SCOPES = ["read_products", "read_content", "read_online_store_pages", "read_translations", "write_translations", "read_locales"];
const OPTIONAL_SCOPES = ["read_markets", "read_online_store_navigation", "read_metaobjects", "read_themes", "read_legal_policies", "read_shipping"];
const stores = new Map<string, FakeShopifyStore>();
const storeFor = (shop: UiShop) => {
  let store = stores.get(shop.domain);
  if (!store) {
    stores.set(shop.domain, (store = shop.build()));
    store.imageOrigin = UI_ENV.appUrl;
  }
  return store;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Waits like a slow network; an abort (the app's time limit) ends the wait as with real fetch. */
function delay(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    });
  });
}

async function adminGraphql(shop: UiShop, body: { query: string; variables?: Record<string, unknown> }, signal?: AbortSignal | null) {
  const name = /(query|mutation)\s+(\w+)/.exec(body.query)?.[2] ?? "anonymous";
  if (name === "LinguvaShopLocales") return json({ data: { shopLocales: shop.locales } });
  if (name === "LinguvaShopId") return json({ data: { shop: { id: shop.gid } } });
  if (name === "LinguvaShopIdentity") return json({ data: { shop: { id: shop.gid, name: shop.name } } });
  if (name === "FetchAccessScopes") {
    const handles = (list: readonly string[]) => list.map((handle) => ({ handle }));
    return json({
      data: {
        app: {
          requestedAccessScopes: handles(REQUIRED_SCOPES),
          optionalAccessScopes: handles(OPTIONAL_SCOPES),
          installation: { accessScopes: handles([...REQUIRED_SCOPES, ...(shop.grantedOptionalScopes ?? [])]) },
        },
      },
    });
  }
  if (name === "LinguvaMarkets" || name === "LinguvaMarketRegions") {
    if (!shop.grantedOptionalScopes?.includes("read_markets")) {
      return json({ errors: [{ message: "Access denied for markets field. Required access: `read_markets` access scope.", extensions: { code: "ACCESS_DENIED" } }] });
    }
    const markets = shop.markets ?? [];
    if (name === "LinguvaMarketRegions") {
      const market = markets.find((m) => m.id === body.variables?.id);
      const nodes = (market?.countries ?? []).map((code) => ({ code, name: code }));
      return json({ data: { market: market ? { conditions: { regionsCondition: { regions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } } : null } });
    }
    const locale = (code: string) => {
      const l = shop.locales.find((x) => x.locale === code);
      return { locale: code, name: l?.name ?? code, published: l?.published ?? false };
    };
    return json({
      data: {
        markets: {
          nodes: markets.map((m) => ({
            id: m.id,
            name: m.name,
            handle: m.name.toLowerCase().replace(/\s+/g, "-"),
            status: m.status,
            webPresences: {
              nodes: m.webPresence
                ? [{ id: `${m.id}/wp`, subfolderSuffix: m.name.slice(0, 2).toLowerCase(), domain: null, defaultLocale: locale(m.webPresence[0]!), alternateLocales: m.webPresence.slice(1).map(locale), rootUrls: [] }]
                : [],
            },
          })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  }
  if (shop.failing && /^LinguvaTranslatable/.test(name)) return json({ errors: "Service unavailable" }, 503);
  if (shop.slowTranslationsMs && /^LinguvaTranslatable/.test(name)) await delay(shop.slowTranslationsMs, signal);
  try {
    const response = await storeFor(shop).graphql(body.query, { variables: body.variables });
    return json(await response.json());
  } catch (error) {
    console.error(`[ui-fake-shopify] ${shop.domain} ${name}: ${(error as Error).message}`);
    return json({ errors: [{ message: (error as Error).message }] }, 200);
  }
}

function partnerApi(body: { variables?: { shopId?: string } }) {
  const shop: UiShop | undefined = Object.values(UI_SHOPS).find((s) => s.gid === body.variables?.shopId);
  const extra = shop?.subscription ?? {};
  if (extra.partnerDown) return json({ errors: [{ message: "Service unavailable" }] }, 503);
  const handle = shop?.plan ?? null;
  // Dates relative to now, so a trial or a pending change is always ahead.
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  return json({
    data: {
      activeSubscription: handle
        ? {
            billingPeriod: "EVERY_30_DAYS",
            cancelAtEndOfCycle: extra.cancelAtEndOfCycle ?? false,
            trialEndsAt: extra.trialDays ? days(extra.trialDays) : null,
            currentBillingCycle:
              extra.periodEndDays !== undefined
                ? { startTime: days(extra.periodEndDays - 30), endTime: days(extra.periodEndDays) }
                : { startTime: "2026-10-01T00:00:00Z", endTime: "2026-11-01T00:00:00Z" },
            items: [{ handle }],
            pendingUpdate: extra.pendingPlan ? { items: [{ handle: extra.pendingPlan }] } : null,
          }
        : null,
    },
  });
}

/** Fictional usage per test key (playwright.config.ts sets the keys). */
const DEEPL_USAGE: Record<string, { character_count: number; character_limit: number }> = {
  "ui-key-one-0001:fx": { character_count: 250_000, character_limit: 1_000_000 },
  "ui-key-two-0002:fx": { character_count: 950_000, character_limit: 1_000_000 },
  "ui-key-pro-0003": { character_count: 7, character_limit: 1_000_000_000_000 },
};

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const read = async () => JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}")));
  if (url.hostname === "partners.shopify.com") return partnerApi(await read());
  if (/^api(-free)?\.deepl\.com$/.test(url.hostname)) {
    // The DeepL keys' usage on the operator's Overview; the UI tests translate with the mock provider.
    if (url.pathname !== "/v2/usage") throw new Error(`[ui-fake-deepl] refused ${url.pathname}: UI tests never translate with DeepL`);
    const headers = new Headers(init?.headers);
    const key = (headers.get("authorization") ?? "").replace("DeepL-Auth-Key ", "");
    return json(DEEPL_USAGE[key] ?? { character_count: 0, character_limit: 500_000 });
  }
  const shop = shopByDomain(url.hostname);
  if (shop && url.pathname === "/admin/oauth/access_token") {
    return json({
      access_token: `ui-test-token-${shop.domain}`,
      scope: "read_products,read_content,read_online_store_pages,read_translations,write_translations,read_locales",
      expires_in: 86_400,
      refresh_token: `ui-test-refresh-${shop.domain}`,
      refresh_token_expires_in: 2_592_000,
    });
  }
  if (shop && /^\/admin\/api\/[\w-]+\/graphql\.json$/.test(url.pathname)) {
    return adminGraphql(shop, await read(), init?.signal ?? (input instanceof Request ? input.signal : null));
  }
  if (/(^|\.)(shopify\.com|myshopify\.com|shopifycloud\.com)$/.test(url.hostname)) {
    throw new Error(`[ui-fake-shopify] refused request to ${url.hostname}: UI tests never call real Shopify`);
  }
  return realFetch(input, init);
};

/** Answers a request for one of the stores' pictures; false for any other request. */
function servePicture(request: IncomingMessage, response: ServerResponse): boolean {
  const path = new URL(request.url ?? "/", UI_ENV.appUrl).pathname;
  if (!path.startsWith(FIXTURE_IMAGE_PATH)) return false;
  const picture = request.method === "GET" || request.method === "HEAD" ? fixturePicture(path.slice(FIXTURE_IMAGE_PATH.length)) : null;
  if (picture) response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }).end(request.method === "HEAD" ? undefined : picture);
  else response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  return true;
}

// react-router-serve creates its own HTTP server; its requests pass here first.
const emit = Server.prototype.emit;
Server.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
  if (event === "request" && servePicture(args[0] as IncomingMessage, args[1] as ServerResponse)) return true;
  return Reflect.apply(emit, this, [event, ...args]) as boolean;
};

console.log("[ui-fake-shopify] simulated Shopify active for", Object.values(UI_SHOPS).map((s) => s.domain).join(", "));
