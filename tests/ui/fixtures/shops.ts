/**
 * Test shops for the UI tests. The global setup (database seed) and the
 * server preload (simulated Shopify) build the same deterministic stores
 * from these definitions, so both processes see the same catalog.
 */
import { FakeShopifyStore } from "../../support/fake-store";
import { buildDemoStore } from "./demo-store";

export const UI_THEME_GID = "gid://shopify/OnlineStoreThemeJsonTemplate/index?theme_id=42";

export interface UiLocale {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}

/** A market as the simulated Shopify returns it (Markets page and Overview countries). */
export interface UiMarket {
  id: string;
  name: string;
  status: "ACTIVE" | "DRAFT";
  /** ISO country codes. */
  countries: string[];
  /** Languages of its own web presence (default first); none: the shop's primary domain. */
  webPresence?: string[];
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
  /** Translation queries answer only after this many ms (a hanging Shopify). */
  slowTranslationsMs?: number;
  /** Optional access scopes the merchant granted. */
  grantedOptionalScopes?: string[];
  /** Markets (needs read_markets in grantedOptionalScopes). */
  markets?: UiMarket[];
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
    grantedOptionalScopes: ["read_online_store_navigation", "read_themes"],
    build() {
      const store = new FakeShopifyStore(30).addCollections(3).addContent(2);
      // Some translations already exist, some are outdated.
      for (let i = 1; i <= 10; i++) store.translate(`gid://shopify/Product/${i}`, "de", "title", `Produkt ${i} Jacke`);
      store.translate("gid://shopify/Product/2", "de", "body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>");
      store.updateSource("gid://shopify/Product/2", "body_html", "<p>Very warm <b>jacket</b> number 2.</p>");
      store.setField("gid://shopify/Product/1", "meta_title", "Warm winter jacket for cold days");
      store.setField("gid://shopify/Product/1", "meta_description", "A warm jacket with two pockets, made for long winter walks in the cold.");
      store.addImage("gid://shopify/Product/1", "Red wool jacket, front view", "jacket");
      store.addMetafield("gid://shopify/Product/1", { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
      // Lists and links, translated item by item.
      store.addMetafield("gid://shopify/Product/14", {
        namespace: "custom",
        key: "guides",
        type: "list.link",
        value: '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]',
      });
      const features = store.addMetafield("gid://shopify/Product/14", {
        namespace: "custom",
        key: "features",
        type: "list.single_line_text_field",
        value: '["Warm","Waterproof"]',
      });
      // Written elsewhere, spaced differently: left as it is unless edited.
      store.translate(features, "de", "value", '[ "Warm", "Wasserdicht" ]');
      // Other content: menus, the store listing, theme content with many texts.
      store.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
      store.addResource("MENU", "2", [{ key: "title", value: "Footer", type: "SINGLE_LINE_TEXT_FIELD" }]);
      store.addResource("SHOP", "91001", [{ key: "meta_title", value: "Linguva UI Store", type: "SINGLE_LINE_TEXT_FIELD" }]);
      store.products.set(
        UI_THEME_GID,
        Array.from({ length: 120 }, (_, i) => ({
          key: `section.hero_${i}.heading:${i}`,
          value: i === 64 ? "Free shipping over 50 €" : `Theme text ${i}`,
          type: "STRING",
        })),
      );
      store.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>Returns within 30 days.</p>", type: "HTML" }]);
      // Policies need read_legal_policies, which this store hasn't granted.
      store.deniedTypes.add("SHOP_POLICY");
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
  demo: {
    // Realistic catalog for the App Store screenshots (fixtures/demo-store.ts).
    domain: "ui-demo.myshopify.com",
    gid: "gid://shopify/Shop/91010",
    name: "Alpine Demo Store",
    locales: [
      { locale: "en", name: "English", primary: true, published: true },
      { locale: "de", name: "German", primary: false, published: true },
      { locale: "fr", name: "French", primary: false, published: true },
      { locale: "es", name: "Spanish", primary: false, published: false },
    ],
    plan: "pro",
    grantedOptionalScopes: ["read_markets"],
    // Sells across Europe and North America; Spanish isn't published yet.
    markets: [
      { id: "gid://shopify/Market/1", name: "Europe", status: "ACTIVE", countries: ["DE", "AT", "CH", "FR", "BE", "NL", "IT", "ES", "PL", "CZ", "HU", "SE"] },
      { id: "gid://shopify/Market/2", name: "North America", status: "ACTIVE", countries: ["US", "CA"], webPresence: ["en", "fr"] },
      { id: "gid://shopify/Market/3", name: "Japan", status: "DRAFT", countries: ["JP"] },
    ],
    build: buildDemoStore,
  },
  stalled: {
    // Shaped like KARINEX: German primary, 12 published languages, one market
    // with the EU and Switzerland (9 countries without their language), and a
    // measurement queued an hour ago that never started. Nothing measured.
    domain: "ui-stalled.myshopify.com",
    gid: "gid://shopify/Shop/91012",
    name: "Stalled Store",
    locales: [
      { locale: "de", name: "German", primary: true, published: true },
      ...(
        [
          ["da", "Danish"],
          ["en", "English"],
          ["fi", "Finnish"],
          ["fr", "French"],
          ["el", "Greek"],
          ["nl", "Dutch"],
          ["it", "Italian"],
          ["pl", "Polish"],
          ["pt-PT", "Portuguese (Portugal)"],
          ["ro", "Romanian"],
          ["es", "Spanish"],
          ["sv", "Swedish"],
        ] as const
      ).map(([locale, name]) => ({ locale, name, primary: false, published: true })),
    ],
    plan: "pro",
    grantedOptionalScopes: ["read_markets"],
    markets: [{ id: "gid://shopify/Market/11", name: "Europa", status: "ACTIVE", countries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH"] }],
    build: () => new FakeShopifyStore(3),
  },
  remeasure: {
    // Measured once; a newer measurement got stuck: the figures stay, and it can be started again.
    domain: "ui-remeasure.myshopify.com",
    gid: "gid://shopify/Shop/91013",
    name: "Remeasure Store",
    locales: [en, de],
    plan: "pro",
    build: () => new FakeShopifyStore(3),
  },
  measure: {
    // Never scanned: the Overview offers to measure coverage.
    domain: "ui-measure.myshopify.com",
    gid: "gid://shopify/Shop/91011",
    name: "Measure Store",
    locales: [en, de],
    plan: "pro",
    build: () => new FakeShopifyStore(3),
  },
  catalog: {
    // 55 products (more than one page of an area's list) in every state, counted, with pictures.
    // German is only read; the French tests start translations.
    domain: "ui-catalog.myshopify.com",
    gid: "gid://shopify/Shop/91020",
    name: "Catalog Store",
    locales: [en, de, { locale: "fr", name: "French", primary: false, published: true }],
    plan: "pro",
    build() {
      const store = new FakeShopifyStore(55);
      const P = (n: number) => `gid://shopify/Product/${n}`;
      // Done: 1–8. Name only, the description still missing: 9–20.
      for (let n = 1; n <= 20; n++) store.translate(P(n), "de", "title", `Produkt ${n} Jacke`);
      for (let n = 1; n <= 8; n++) store.translate(P(n), "de", "body_html", `<p>Warme <b>Jacke</b> Nummer ${n}.</p>`);
      // Outdated: the description changed after it was translated.
      store.updateSource(P(8), "body_html", "<p>Very warm <b>jacket</b> number 8.</p>");
      const pictures = ["jacket", "sweater", "trousers", "vest", "socks", "shoes"] as const;
      pictures.forEach((picture, i) => store.addImage(P(i + 1), `Product ${i + 1} picture`, picture));
      return store;
    },
  },
  customFields: {
    // A German job with custom fields: a list of links waits on Review.
    domain: "ui-fields.myshopify.com",
    gid: "gid://shopify/Shop/91009",
    name: "Custom Fields Store",
    locales: [en, de],
    plan: "pro",
    build() {
      const store = new FakeShopifyStore(2);
      store.addMetafield("gid://shopify/Product/1", {
        namespace: "custom",
        key: "guides",
        type: "list.link",
        value: '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]',
      });
      return store;
    },
  },
  visual: {
    // Fixed content for screenshot comparisons, counted once; no test changes it.
    domain: "ui-visual.myshopify.com",
    gid: "gid://shopify/Shop/91008",
    name: "Visual Test Store",
    locales: [en, de, { locale: "fr", name: "French", primary: false, published: false }],
    plan: "pro",
    build() {
      // Pictures for the language page; not on product 2, whose editor is compared.
      const store = new FakeShopifyStore(6);
      store.addImage("gid://shopify/Product/1", "Product 1 picture", "jacket");
      store.addImage("gid://shopify/Product/3", "Product 3 picture", "sweater");
      store.addImage("gid://shopify/Product/4", "Product 4 picture", "shoes");
      return store;
    },
  },
  slow: {
    // Shopify hangs on translation queries: longer than the app's time limit.
    domain: "ui-slow.myshopify.com",
    gid: "gid://shopify/Shop/91007",
    name: "Slow Store",
    locales: [en, de],
    plan: "starter",
    slowTranslationsMs: 20_000,
    build: () => new FakeShopifyStore(3),
  },
  business: {
    // Business plan with the smart schedule on: daily at 23:00 (Berlin) into German and French, with past checks.
    // Read only: screenshots and the card's values come from it.
    domain: "ui-business.myshopify.com",
    gid: "gid://shopify/Shop/91014",
    name: "Business Store",
    locales: [en, de, { locale: "fr", name: "French", primary: false, published: true }],
    plan: "business",
    build: () => new FakeShopifyStore(6).addCollections(2),
  },
  businessEdit: {
    // Business plan, smart schedule never set up: the tests set it up, change it, pause and resume it.
    domain: "ui-business-edit.myshopify.com",
    gid: "gid://shopify/Shop/91017",
    name: "Business Edit Store",
    locales: [en, de, { locale: "fr", name: "French", primary: false, published: true }, { locale: "es", name: "Spanish", primary: false, published: true }],
    plan: "business",
    build: () => new FakeShopifyStore(3),
  },
  businessPause: {
    // Business plan with the smart schedule on (daily into German): the tests pause, resume and check now.
    domain: "ui-business-pause.myshopify.com",
    gid: "gid://shopify/Shop/91018",
    name: "Business Pause Store",
    locales: [en, de],
    plan: "business",
    build: () => new FakeShopifyStore(2),
  },
  smartDowngraded: {
    // The smart schedule was turned on under Business; the store is now on Pro (no smart schedule).
    domain: "ui-smart-downgraded.myshopify.com",
    gid: "gid://shopify/Shop/91019",
    name: "Smart Downgraded Store",
    locales: [en, de],
    plan: "pro",
    build: () => new FakeShopifyStore(2),
  },
  autoLimits: {
    // Starter (three additional languages) with four: Spanish is outside the plan.
    // Automatic translation was turned on for German and Spanish, and today's AI allowance ran out.
    domain: "ui-autolimits.myshopify.com",
    gid: "gid://shopify/Shop/91015",
    name: "Limits Store",
    locales: [
      en,
      de,
      { locale: "fr", name: "French", primary: false, published: true },
      { locale: "it", name: "Italian", primary: false, published: true },
      { locale: "es", name: "Spanish", primary: false, published: true },
    ],
    plan: "starter",
    build: () => new FakeShopifyStore(3),
  },
  downgraded: {
    // Automatic translation turned on under a paid plan; the store is now on Free (no bulk translation).
    domain: "ui-downgraded.myshopify.com",
    gid: "gid://shopify/Shop/91016",
    name: "Downgraded Store",
    locales: [en, de],
    plan: null,
    build: () => new FakeShopifyStore(3),
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

// Another port (UI_PORT) lets two checkouts run their UI tests at the same time.
const UI_PORT = Number(process.env.UI_PORT ?? 4317);

export const UI_ENV = {
  apiKey: "ui-test-api-key",
  // A fixed, test-only secret: session tokens in the tests are signed with it.
  apiSecret: "ui-test-api-secret-not-used-anywhere-else",
  appUrl: `http://localhost:${UI_PORT}`,
  port: UI_PORT,
} as const;
