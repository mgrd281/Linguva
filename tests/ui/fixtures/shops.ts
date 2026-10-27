/**
 * Test shops for the UI tests. The global setup (database seed) and the
 * server preload (simulated Shopify) build the same deterministic stores
 * from these definitions, so both processes see the same catalog.
 */
import { FakeShopifyStore } from "../../support/fake-store";

export interface UiLocale {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}

export interface UiShop {
  domain: string;
  gid: string;
  name: string;
  locales: UiLocale[];
  /** Partner API plan handle (null: no subscription). */
  plan: string | null;
  /** Every Admin API call fails (Shopify outage or revoked access). */
  failing?: boolean;
  build(): FakeShopifyStore;
}

const en: UiLocale = { locale: "en", name: "English", primary: true, published: true };
const de: UiLocale = { locale: "de", name: "German", primary: false, published: true };

export const UI_SHOPS = {
  full: {
    domain: "ui-full.myshopify.com",
    gid: "gid://shopify/Shop/91001",
    name: "Linguva UI Store",
    locales: [en, de, { locale: "fr", name: "French", primary: false, published: true }, { locale: "ar", name: "Arabic", primary: false, published: false }],
    plan: "pro",
    build() {
      const store = new FakeShopifyStore(30).addCollections(3).addContent(2);
      // Some translations already exist, some are outdated.
      for (let i = 1; i <= 10; i++) store.translate(`gid://shopify/Product/${i}`, "de", "title", `Produkt ${i} Jacke`);
      store.translate("gid://shopify/Product/2", "de", "body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>");
      store.updateSource("gid://shopify/Product/2", "body_html", "<p>Very warm <b>jacket</b> number 2.</p>");
      store.setField("gid://shopify/Product/1", "meta_title", "Warm winter jacket for cold days");
      store.setField("gid://shopify/Product/1", "meta_description", "A warm jacket with two pockets, made for long winter walks in the cold.");
      store.addImage("gid://shopify/Product/1", "Red wool jacket, front view");
      store.addMetafield("gid://shopify/Product/1", { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
      return store;
    },
  },
  empty: {
    domain: "ui-empty.myshopify.com",
    gid: "gid://shopify/Shop/91002",
    name: "Empty Test Store",
    locales: [en],
    plan: null,
    build: () => new FakeShopifyStore(0),
  },
  emptyCatalog: {
    domain: "ui-nocatalog.myshopify.com",
    gid: "gid://shopify/Shop/91003",
    name: "No Catalog Store",
    locales: [en, de],
    plan: "starter",
    build: () => new FakeShopifyStore(0),
  },
  failing: {
    domain: "ui-failing.myshopify.com",
    gid: "gid://shopify/Shop/91004",
    name: "Failing Store",
    locales: [en, de],
    plan: "starter",
    failing: true,
    build: () => new FakeShopifyStore(3),
  },
  owner: {
    domain: "ui-owner.myshopify.com",
    gid: "gid://shopify/Shop/91005",
    name: "Owner Store",
    locales: [en, de],
    plan: null,
    build: () => new FakeShopifyStore(5),
  },
  fresh: {
    // Never seeded: installs through token exchange in the test.
    domain: "ui-fresh.myshopify.com",
    gid: "gid://shopify/Shop/91006",
    name: "Fresh Install Store",
    locales: [en, de],
    plan: null,
    build: () => new FakeShopifyStore(2),
  },
} satisfies Record<string, UiShop>;

export type UiShopKey = keyof typeof UI_SHOPS;

export function shopByDomain(domain: string): UiShop | undefined {
  return Object.values(UI_SHOPS).find((s) => s.domain === domain);
}

export const UI_ENV = {
  apiKey: "ui-test-api-key",
  // A fixed, test-only secret: session tokens in the tests are signed with it.
  apiSecret: "ui-test-api-secret-not-used-anywhere-else",
  appUrl: "http://localhost:4317",
  port: 4317,
} as const;
