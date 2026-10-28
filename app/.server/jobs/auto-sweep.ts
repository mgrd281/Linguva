/**
 * Periodic check for automatic translation. Pages, blog posts and blogs
 * have no webhook topics (WebhookSubscriptionTopic, Admin API 2026-10),
 * and a product or collection webhook can be missed (the app down longer
 * than Shopify retries). So the worker asks each shop with automatic
 * translation on for the resources changed since its last check
 * (`ShopSettings.autoSweptAt`) and queues the same check a webhook queues.
 * That check only translates missing or outdated fields, so content that
 * didn't really change costs no AI allowance.
 *
 * Each shop is read through its own Admin API session and handled in its
 * own tenant context; a failure leaves its position unchanged, so the next
 * run covers the same period again.
 */
import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { changedSince, SWEPT_TYPES } from "../shopify/recent-changes";
import { AccessDeniedError } from "../shopify/translations-api";
import { withTenant } from "../tenancy/with-tenant";
import { AUTO_GID, enqueueAutoCheck, type AutoQueue } from "./auto-translate";
import type { JobDependencies } from "./processors";

export const AUTO_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
/** Changes per type and shop one run queues; more are left to "Translate all" (logged). */
export const MAX_CHANGES_PER_TYPE = 500;
/** Reads a little before the last run, so a save during it isn't missed (the queue merges repeats). */
const OVERLAP_MS = 2 * 60 * 1000;

export async function sweepChangedContent(
  deps: Pick<JobDependencies, "prisma" | "adminFor" | "billingFor">,
  queue: AutoQueue,
  now = new Date(),
) {
  const summary = { shops: 0, queued: 0, failed: 0 };
  const shops = await deps.prisma.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    const settings = await getShopSettings(shop.id, deps.prisma);
    if (!settings.autoTranslateNew || !settings.autoTranslateLocales.length || !hasCurrentAiConsent(settings)) continue;
    const billing = deps.billingFor ? await deps.billingFor(shop.id) : null;
    if (billing?.configured && !billing.entitlements.bulk) continue;
    // Turned on before this check existed: start from now.
    const since = new Date((settings.autoSweptAt ?? now).getTime() - OVERLAP_MS);
    try {
      const admin = await deps.adminFor(shop.shopDomain);
      for (const resourceType of SWEPT_TYPES) {
        let found: Awaited<ReturnType<typeof changedSince>>;
        try {
          found = await changedSince(admin, resourceType, since, MAX_CHANGES_PER_TYPE);
        } catch (error) {
          // A scope the shop didn't grant: nothing of that type can be translated anyway.
          if (error instanceof AccessDeniedError) continue;
          throw error;
        }
        if (found.capped) logger.warn({ shopId: shop.id, resourceType, max: MAX_CHANGES_PER_TYPE }, "more changes than one automatic check covers");
        for (const resourceGid of found.ids) {
          if (!AUTO_GID[resourceType].test(resourceGid)) continue;
          await enqueueAutoCheck(queue, { shopId: shop.id, resourceGid, resourceType });
          summary.queued++;
        }
      }
      await advance(shop.id, now, deps.prisma);
      summary.shops++;
    } catch (error) {
      summary.failed++;
      logger.warn({ shopId: shop.id, err: (error as Error).name }, "automatic translation check failed");
    }
  }
  return summary;
}

/** Moves the position forward only (turning it off and on again meanwhile set a later one). */
async function advance(shopId: string, to: Date, client: PrismaClient) {
  await withTenant(
    shopId,
    (tx) =>
      tx.shopSettings.updateMany({
        where: { shopId, autoTranslateNew: true, OR: [{ autoSweptAt: null }, { autoSweptAt: { lt: to } }] },
        data: { autoSweptAt: to },
      }),
    client,
  );
}
