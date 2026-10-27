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
  const { admin, session } = await authenticate.admin(request);
  let shop = await findShopByDomain(session.shop);
  if (!shop || shop.status !== "ACTIVE") {
    // afterAuth normally creates the tenant; this covers a missed hook.
    ({ shop } = await upsertInstalledShop({
      shopDomain: session.shop,
      scopes: session.scope ?? null,
    }));
  }
  return { admin, session, shop };
}
