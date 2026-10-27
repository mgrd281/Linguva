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
 */
import { shopByDomain, UI_SHOPS, type UiShop } from "../fixtures/shops";
import type { FakeShopifyStore } from "../../support/fake-store";

const realFetch = globalThis.fetch.bind(globalThis);
const REQUIRED_SCOPES = ["read_products", "read_content", "read_online_store_pages", "read_translations", "write_translations", "read_locales", "write_locales"];
const OPTIONAL_SCOPES = ["read_markets", "read_online_store_navigation", "read_metaobjects", "read_themes", "read_legal_policies", "read_shipping"];
const stores = new Map<string, FakeShopifyStore>();
const storeFor = (shop: UiShop) => {
  let store = stores.get(shop.domain);
  if (!store) stores.set(shop.domain, (store = shop.build()));
  return store;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function adminGraphql(shop: UiShop, body: { query: string; variables?: Record<string, unknown> }) {
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
  if (shop.failing && /^LinguvaTranslatable/.test(name)) return json({ errors: "Service unavailable" }, 503);
  try {
    const response = await storeFor(shop).graphql(body.query, { variables: body.variables });
    return json(await response.json());
  } catch (error) {
    console.error(`[ui-fake-shopify] ${shop.domain} ${name}: ${(error as Error).message}`);
    return json({ errors: [{ message: (error as Error).message }] }, 200);
  }
}

function partnerApi(body: { variables?: { shopId?: string } }) {
  const shop = Object.values(UI_SHOPS).find((s) => s.gid === body.variables?.shopId);
  const handle = shop?.plan ?? null;
  return json({
    data: {
      activeSubscription: handle
        ? {
            billingPeriod: "EVERY_30_DAYS",
            cancelAtEndOfCycle: false,
            trialEndsAt: null,
            currentBillingCycle: { startTime: "2026-10-01T00:00:00Z", endTime: "2026-11-01T00:00:00Z" },
            items: [{ handle }],
            pendingUpdate: null,
          }
        : null,
    },
  });
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const read = async () => JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}")));
  if (url.hostname === "partners.shopify.com") return partnerApi(await read());
  const shop = shopByDomain(url.hostname);
  if (shop && url.pathname === "/admin/oauth/access_token") {
    return json({
      access_token: `ui-test-token-${shop.domain}`,
      scope: "read_products,read_content,read_online_store_pages,read_translations,write_translations,read_locales,write_locales",
      expires_in: 86_400,
      refresh_token: `ui-test-refresh-${shop.domain}`,
      refresh_token_expires_in: 2_592_000,
    });
  }
  if (shop && /^\/admin\/api\/[\w-]+\/graphql\.json$/.test(url.pathname)) return adminGraphql(shop, await read());
  if (/(^|\.)(shopify\.com|myshopify\.com|shopifycloud\.com)$/.test(url.hostname)) {
    throw new Error(`[ui-fake-shopify] refused request to ${url.hostname}: UI tests never call real Shopify`);
  }
  return realFetch(input, init);
};

console.log("[ui-fake-shopify] simulated Shopify active for", Object.values(UI_SHOPS).map((s) => s.domain).join(", "));
