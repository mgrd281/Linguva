/**
 * Safety gate for live tests against a real Shopify store. Live tests run
 * only when explicitly configured, only against a Partner development store,
 * and only write to fixtures they create themselves.
 */

export type LiveCredentials =
  /** An Admin API token (for example from an existing admin-created custom app). */
  | { kind: "token"; token: string }
  /** A Dev Dashboard app in the same organization (client credentials grant). */
  | { kind: "client"; clientId: string; clientSecret: string }
  /**
   * The Linguva app's own offline session for this store, read from the
   * local development database named in .env and decrypted with its key.
   * Read-only: the app has no write_products scope for fixtures.
   */
  | { kind: "appSession" };

export interface LiveSettings {
  shop: string;
  credentials: LiveCredentials;
  targetLocale: string;
  allowWrites: boolean;
}

export class LiveTestRefused extends Error {
  constructor(reason: string) {
    super(`Live tests refused: ${reason}`);
    this.name = "LiveTestRefused";
  }
}

const DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

// Stores that must never be touched by tests, whatever their plan says.
// Matching is a safety net only; the development-store check below is the gate.
const ALWAYS_DENIED = ["karinex", "softwarefach"];

/** Reads live settings from the environment, or null when live tests are off. */
export function readLiveSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings | null {
  const shop = env.LIVE_SHOPIFY_SHOP?.trim().toLowerCase();
  const token = env.LIVE_SHOPIFY_ADMIN_TOKEN?.trim();
  const clientId = env.LIVE_SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.LIVE_SHOPIFY_CLIENT_SECRET?.trim();
  const appSession = env.LIVE_USE_APP_SESSION === "yes";
  if (!shop && !token && !clientId && !clientSecret && !appSession) return null;
  let credentials: LiveCredentials;
  if (appSession && !token && !clientId && !clientSecret) credentials = { kind: "appSession" };
  else if (!appSession && token && !clientId && !clientSecret) credentials = { kind: "token", token };
  else if (!appSession && !token && clientId && clientSecret) credentials = { kind: "client", clientId, clientSecret };
  else {
    throw new LiveTestRefused(
      "set LIVE_SHOPIFY_SHOP and exactly one of: LIVE_USE_APP_SESSION=yes, LIVE_SHOPIFY_ADMIN_TOKEN, or LIVE_SHOPIFY_CLIENT_ID with LIVE_SHOPIFY_CLIENT_SECRET",
    );
  }
  if (appSession && env.LIVE_ALLOW_WRITES === "yes") {
    throw new LiveTestRefused("LIVE_ALLOW_WRITES needs the live-test app (write_products for fixtures); the app's own session is read-only");
  }
  if (!shop) throw new LiveTestRefused("set LIVE_SHOPIFY_SHOP");
  if (!DOMAIN.test(shop)) throw new LiveTestRefused("LIVE_SHOPIFY_SHOP must be a *.myshopify.com domain");
  const denied = [
    ...ALWAYS_DENIED,
    ...(env.LIVE_DENY_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  ];
  if (denied.some((d) => shop.includes(d))) throw new LiveTestRefused(`${shop} is on the deny list`);
  const targetLocale = env.LIVE_TARGET_LOCALE?.trim() || "de";
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(targetLocale)) {
    throw new LiveTestRefused("LIVE_TARGET_LOCALE is not a locale code");
  }
  return { shop, credentials, targetLocale, allowWrites: env.LIVE_ALLOW_WRITES === "yes" };
}

export interface ShopFacts {
  myshopifyDomain: string;
  partnerDevelopment: boolean;
}

/** Throws unless the connected store is the configured development store. */
export function assertDevelopmentStore(settings: LiveSettings, facts: ShopFacts) {
  if (facts.myshopifyDomain.toLowerCase() !== settings.shop) {
    throw new LiveTestRefused(`the token belongs to ${facts.myshopifyDomain}, not ${settings.shop}`);
  }
  if (facts.partnerDevelopment !== true) {
    throw new LiveTestRefused(`${settings.shop} is not a Partner development store`);
  }
}
