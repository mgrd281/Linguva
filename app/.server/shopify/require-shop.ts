import { authenticate } from "../../shopify.server";
import {
  findShopByDomain,
  upsertInstalledShop,
} from "../tenancy/shop-service";

/**
 * Authenticates an embedded-app request and resolves the tenant. The shop
 * comes only from the verified session token, never from request input.
 */
export async function requireShop(request: Request) {
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
  return { admin, session, shop, actorId };
}
