import { authenticate } from "../../shopify.server";
import { ensureDatabasePosture } from "../lib/db-guard";
import {
  findShopByDomain,
  upsertInstalledShop,
} from "../tenancy/shop-service";

/**
 * Authenticates an embedded-app request and resolves the tenant. The shop
 * comes only from the verified session token, never from request input.
 */
export async function requireShop(request: Request) {
  await ensureDatabasePosture();
  const context = await authenticate.admin(request);
  const { admin, session } = context;
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
  return { admin, session, shop, actorId, redirect, scopes };
}
