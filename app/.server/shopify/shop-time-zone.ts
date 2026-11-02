/**
 * The store's time zone as Shopify has it (Settings → General). Scheduled
 * checks default to it, the settings name it as the store's own, and every
 * page shows instants in it (`shopTimeZone`, sent by the app route's loader).
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { withTenant } from "../tenancy/with-tenant";
import { canonicalTimeZone } from "../../lib/schedule";
import { settle } from "./preview-images";

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

/** How long a store's zone is kept in this process. */
export const SHOP_TIME_ZONE_TTL_MS = 60 * 60_000;
// Stores kept at once; the oldest entry goes first (a process serves far fewer).
const MAX_SHOPS = 5_000;
const zones = new Map<string, { zone: Promise<string>; at: number }>();

/**
 * The time zone the app shows a store's instants in: the smart schedule's
 * zone when the store has a schedule (no Shopify call), else the store's own
 * zone from Shopify, else "UTC" (the pages then say "UTC"). Kept in this
 * process for an hour per store, the answer "UTC" too, so a page that polls
 * never waits for Shopify and Shopify is asked once per store and hour at
 * most (requests that arrive together share one lookup).
 */
export function shopTimeZone(shopId: string, admin: Pick<AdminApiContext, "graphql">, now = Date.now(), client: PrismaClient = defaultClient): Promise<string> {
  const kept = zones.get(shopId);
  if (kept && now - kept.at < SHOP_TIME_ZONE_TTL_MS) return kept.zone;
  const zone = lookUpTimeZone(shopId, admin, client);
  zones.delete(shopId);
  if (zones.size >= MAX_SHOPS) zones.delete(zones.keys().next().value!);
  zones.set(shopId, { zone, at: now });
  // A failed database read isn't kept: the next request asks again.
  zone.catch(() => {
    if (zones.get(shopId)?.zone === zone) zones.delete(shopId);
  });
  return zone;
}

async function lookUpTimeZone(shopId: string, admin: Pick<AdminApiContext, "graphql">, client: PrismaClient): Promise<string> {
  const schedule = await withTenant(shopId, (tx) => tx.smartAutoConfig.findUnique({ where: { shopId }, select: { timeZone: true } }), client);
  const zone = schedule ? schedule.timeZone : await settle(shopId, "time zone", fetchShopTimeZone(admin));
  // Only a zone Intl knows ("Europe/Berlin", Shopify's "Asia/Kolkata"); an offset or a typo shows UTC.
  return (zone && canonicalTimeZone(zone, zone)) || "UTC";
}

/** Forgets the kept zones (tests). */
export function clearShopTimeZones() {
  zones.clear();
}
