/**
 * The store's time zone as Shopify has it (Settings → General). Scheduled
 * checks default to it, and the settings name it as the store's own.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { logger } from "../lib/logger";

const SHOP_TIME_ZONE_QUERY = `#graphql
  query LinguvaShopTimeZone {
    shop {
      ianaTimezone
    }
  }
`;

/** The IANA zone ("Europe/Berlin"), or null when Shopify can't be asked (the page still works). */
export async function fetchShopTimeZone(admin: Pick<AdminApiContext, "graphql">): Promise<string | null> {
  try {
    const response = await admin.graphql(SHOP_TIME_ZONE_QUERY);
    const body = (await response.json()) as { data?: { shop?: { ianaTimezone?: unknown } } };
    const zone = body.data?.shop?.ianaTimezone;
    return typeof zone === "string" && zone.length <= 64 ? zone : null;
  } catch (error) {
    logger.warn({ err: (error as Error).name }, "shop time zone unavailable");
    return null;
  }
}
