/**
 * Rehearsal of the live tests: the same suites, the same live client and
 * guards, but `fetch` answers from a simulated store instead of Shopify.
 * Catches mistakes in the live tests themselves before the owner spends a
 * run on the real development store. Proves nothing about Shopify.
 *
 *   pnpm test:live:rehearsal
 *
 * Two shapes (LIVE_REHEARSAL):
 *   dev-store     linguva-test-lab as measured on 2026-10-28 (no products,
 *                 1 collection, 2 pages, 1 blog; French unpublished)
 *   demo-catalog  the same plus the fictional catalog of
 *                 docs/dev-store/demo-catalog-products.csv (the next run)
 *
 * Any request to another host fails, so nothing leaves the machine.
 */
import { FakeShopifyStore } from "../support/fake-store";
import { DEMO_PRODUCTS } from "../ui/fixtures/demo-store";

export const REHEARSAL_SHOP = "linguva-rehearsal.myshopify.com";
export type RehearsalShape = "dev-store" | "demo-catalog";

/** Live settings of a rehearsal: a fake token, read-only, the store picks the language. */
export function rehearsalEnv(shape: string = process.env.LIVE_REHEARSAL ?? "dev-store"): Record<string, string> {
  return {
    LIVE_SHOPIFY_SHOP: REHEARSAL_SHOP,
    LIVE_SHOPIFY_ADMIN_TOKEN: "rehearsal-not-a-token",
    LIVE_SHOPIFY_CLIENT_ID: "",
    LIVE_SHOPIFY_CLIENT_SECRET: "",
    LIVE_USE_APP_SESSION: "",
    LIVE_TARGET_LOCALE: "",
    LIVE_ALLOW_WRITES: "",
    LIVE_REHEARSAL: shape,
  };
}

export function rehearsalShape(env: NodeJS.ProcessEnv = process.env): RehearsalShape {
  const shape = env.LIVE_REHEARSAL;
  if (shape === "dev-store" || shape === "demo-catalog") return shape;
  throw new Error(`LIVE_REHEARSAL must be dev-store or demo-catalog, not ${JSON.stringify(shape)}`);
}

/** The store of one rehearsal shape. */
export function rehearsalStore(shape: RehearsalShape): FakeShopifyStore {
  const store = new FakeShopifyStore(0);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "fr", name: "French", primary: false, published: false },
  ];
  // As reported for linguva-test-lab: collection 2 fields missing; pages 5
  // fields, 2 complete; blog 2 fields missing.
  store.addResource("COLLECTION", "1", [
    { key: "title", value: "Home page", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "handle", value: "frontpage", type: "URI" },
  ]);
  const contact = store.addResource("PAGE", "1", [
    { key: "title", value: "Contact", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "handle", value: "contact", type: "URI" },
  ]);
  const about = store.addResource("PAGE", "2", [
    { key: "title", value: "About us", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>A fictional store for testing Linguva.</p>", type: "HTML" },
    { key: "handle", value: "about-us", type: "URI" },
  ]);
  store.translate(contact, "fr", "title", "Contact");
  store.translate(about, "fr", "title", "À propos");
  store.addResource("BLOG", "1", [
    { key: "title", value: "News", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "handle", value: "news", type: "URI" },
  ]);
  if (shape === "demo-catalog") {
    DEMO_PRODUCTS.forEach((p, i) => {
      store.addResource("PRODUCT", String(i + 1), [
        { key: "title", value: p.title, type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "body_html", value: p.body, type: "HTML" },
        { key: "handle", value: p.handle, type: "URI" },
        { key: "meta_title", value: p.metaTitle, type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "meta_description", value: p.metaDescription, type: "MULTI_LINE_TEXT_FIELD" },
      ]);
    });
    store.addImage("gid://shopify/Product/1", DEMO_PRODUCTS[0]!.title);
    store.addImage("gid://shopify/Product/2", DEMO_PRODUCTS[1]!.title);
  }
  return store;
}

/**
 * Replaces `fetch` with the rehearsal store for REHEARSAL_SHOP's Admin API.
 * Returns a function that restores the original.
 */
export function installRehearsalFetch(store: FakeShopifyStore): () => void {
  const original = globalThis.fetch;
  const endpoint = `https://${REHEARSAL_SHOP}/admin/api/`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(endpoint)) throw new Error(`Rehearsal: no network, refused ${url}`);
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, unknown> };
    const name = /(query|mutation)\s+(\w+)/.exec(query)?.[2];
    if (name === "LinguvaLiveShopFacts") {
      return Response.json({ data: { shop: { myshopifyDomain: REHEARSAL_SHOP, plan: { partnerDevelopment: true, publicDisplayName: "Development" } } } });
    }
    // Like the test app on the real store: read_markets not granted.
    if (name === "LinguvaMarkets") return Response.json({ errors: [{ message: "Access denied for markets field.", extensions: { code: "ACCESS_DENIED" } }] });
    return store.graphql(query, { variables });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
