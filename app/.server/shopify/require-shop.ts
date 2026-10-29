import { authenticate } from "../../shopify.server";
import { getConfig, isShopAllowed } from "../lib/config";
import { ensureDatabasePosture } from "../lib/db-guard";
import { withShopifyTimeout } from "./admin-timeout";
import {
  findShopByDomain,
  upsertInstalledShop,
} from "../tenancy/shop-service";

/**
 * Authenticates an embedded-app request and resolves the tenant. The shop
 * comes only from the verified session token, never from request input.
 */
export async function requireShop(request: Request) {
  // A store this deployment doesn't serve (staging: anything but its test
  // stores) is turned away before Shopify's token exchange stores a session.
  refuseShop(new URL(request.url).searchParams.get("shop"));
  await ensureDatabasePosture();
  const context = await authenticate.admin(request);
  const { admin, session } = context;
  // The verified shop decides; the query parameter above is only a shortcut.
  refuseShop(session.shop, true);
  let shop = await findShopByDomain(session.shop);
  if (!shop || shop.status !== "ACTIVE") {
    // afterAuth normally creates the tenant; this covers a missed hook.
    ({ shop } = await upsertInstalledShop({
      shopDomain: session.shop,
      scopes: session.scope ?? null,
    }));
  }
  // The staff member who made the request (session token `sub`), for audit
  // logs. Offline sessions carry no user, so the token is the reliable source.
  const sessionToken = "sessionToken" in context ? context.sessionToken : undefined;
  const actorId =
    (sessionToken?.sub ? String(sessionToken.sub) : null) ??
    session.onlineAccessInfo?.associated_user?.id?.toString() ??
    null;
  // Redirects outside the app frame (for example to the plan selection page).
  const redirect = context.redirect;
  // Optional scopes (for example read_markets) are queried and requested here.
  const scopes = context.scopes;
  // Every Admin API call from a page has a time limit (see admin-timeout.ts).
  return { admin: withShopifyTimeout(admin, getConfig().SHOPIFY_TIMEOUT_MS, "page"), session, shop, actorId, redirect, scopes };
}

export const SHOP_NOT_SERVED = "This Linguva deployment isn't available for this store.";

/**
 * Throws 403 for a shop this deployment doesn't serve (ALLOWED_SHOPS, and
 * never a production store from staging). `required`: a missing shop is
 * refused too (verified sessions always name one).
 */
export function refuseShop(shop: string | null, required = false) {
  if (!shop && !required) return;
  if (!isShopAllowed(shop)) throw new Response(SHOP_NOT_SERVED, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * The login form's shop field as Shopify's login reads it ("karinex",
 * "https://karinex.myshopify.com/"), checked like a shop parameter.
 */
export function refuseShopInput(raw: FormDataEntryValue | string | null) {
  if (typeof raw !== "string" || !raw.trim()) return;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  refuseShop(host.includes(".") ? host : `${host}.myshopify.com`);
}
