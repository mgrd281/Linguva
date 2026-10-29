/**
 * Periodic check for automatic translation. Pages, blog posts and blogs
 * have no webhook topics (WebhookSubscriptionTopic, Admin API 2026-10),
 * and a product or collection webhook can be missed (the app down longer
 * than Shopify retries). So the worker asks each shop with automatic
 * translation on for the resources changed since its last check
 * (`ShopSettings.autoSweptAt`) and queues the same check a webhook queues.
 * That check only translates missing or outdated fields, so content that
 * didn't really change costs no AI allowance. Changed pages, blog posts and
 * blogs are also read again for the coverage report (products and
 * collections are, after their webhooks). With Smart Auto-Translate on,
 * only its real-time mode is checked this way: a scheduled mode reads
 * everything at its own times and translates nothing in between.
 *
 * Each shop is read through its own Admin API session and handled in its
 * own tenant context; a failure leaves its position unchanged, so the next
 * run covers the same period again.
 */
import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { shopKey } from "../queue/redis";
import { autoTranslatePaused, getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { queueSweptCoverageRefresh, type CoverageRefreshQueue } from "../coverage/refresh";
import { changedSince, SWEPT_TYPES, type SweptType } from "../shopify/recent-changes";
import { AccessDeniedError } from "../shopify/translations-api";
import { withTenant } from "../tenancy/with-tenant";
import { smartPaused } from "../smart/config";
import { AUTO_GID, enqueueAutoCheck, type AutoQueue } from "./auto-translate";
import { RateLimitedError } from "./errors";
import type { JobDependencies } from "./processors";

export const AUTO_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
/**
 * Changes per type and shop one run queues. More are read oldest first and
 * the position moves only up to the last one queued, so the next run goes on
 * from there: nothing is dropped (catching up after a large import takes a
 * few runs).
 */
export const MAX_CHANGES_PER_TYPE = 500;
/**
 * A run that got everything moves the position to a little before its start,
 * so the next run reads that time again (clock differences to Shopify; the
 * queue merges repeats). A run that stopped at the limit moves it exactly to
 * the last second it got completely.
 */
const OVERLAP_MS = 2 * 60 * 1000;
/** Admin API cost of one listing request, taken from the shop's Shopify budget like every other request. */
const LIST_COST = 10;
/** Types without webhooks: the check is the only way coverage learns they changed. */
const REFRESHED_BY_SWEEP: ReadonlySet<SweptType> = new Set(["PAGE", "ARTICLE", "BLOG"]);

export async function sweepChangedContent(
  deps: Pick<JobDependencies, "prisma" | "adminFor" | "billingFor"> &
    Partial<Pick<JobDependencies, "shopifyLimiter" | "keyPrefix">> & {
      /** The coverage queue: changed pages, blog posts and blogs are read again for the report. */
      coverageQueue?: CoverageRefreshQueue | null;
    },
  queue: AutoQueue,
  now = new Date(),
  maxPerType = MAX_CHANGES_PER_TYPE,
) {
  const summary = { shops: 0, queued: 0, failed: 0, catchingUp: 0 };
  const shops = await deps.prisma.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    // Each shop on its own: a failure (also reading its settings or plan) leaves its position
    // unchanged for the next run and never stops the shops after it.
    try {
      const settings = await getShopSettings(shop.id, deps.prisma);
      const smart = await withTenant(shop.id, (tx) => tx.smartAutoConfig.findUnique({ where: { shopId: shop.id } }), deps.prisma);
      let position: Date;
      if (smart?.enabled) {
        // The smart schedule replaces automatic translation; its real-time mode follows changes between checks.
        if (smart.mode !== "realtime" || smartPaused(smart, now) || !hasCurrentAiConsent(settings)) continue;
        const billing = deps.billingFor ? await deps.billingFor(shop.id) : null;
        if (billing?.configured && !billing.entitlements.smartAuto) continue;
        // Never before its last complete check started (that one read everything); a skipped or
        // failed check moves nothing.
        const lastCheck = await withTenant(
          shop.id,
          (tx) => tx.smartAutoRun.findFirst({ where: { shopId: shop.id, status: "COMPLETED", startedAt: { not: null } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
          deps.prisma,
        );
        const fromCheck = lastCheck?.startedAt ? new Date(lastCheck.startedAt.getTime() - OVERLAP_MS) : null;
        position = [settings.autoSweptAt, fromCheck].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(now.getTime() - OVERLAP_MS);
      } else {
        if (!settings.autoTranslateNew || !settings.autoTranslateLocales.length || !hasCurrentAiConsent(settings)) continue;
        // Waiting for a limit or the provider: the position stays, so the changes follow afterwards.
        if (autoTranslatePaused(settings, now)) continue;
        const billing = deps.billingFor ? await deps.billingFor(shop.id) : null;
        if (billing?.configured && !billing.entitlements.bulk) continue;
        // Turned on before this check existed: start from now.
        position = settings.autoSweptAt ?? new Date(now.getTime() - OVERLAP_MS);
      }
      const since = position;
      const beforeRequest = async () => {
        if (!deps.shopifyLimiter || !deps.keyPrefix) return;
        const wait = await deps.shopifyLimiter.take(shopKey(deps.keyPrefix, shop.id, "rl", "shopify"), LIST_COST);
        if (wait > 0) throw new RateLimitedError(wait);
      };
      const admin = await deps.adminFor(shop.shopDomain);
      // Up to when every change was queued; a capped type holds it back.
      const everything = new Date(now.getTime() - OVERLAP_MS);
      let complete = everything;
      for (const resourceType of SWEPT_TYPES) {
        let found: Awaited<ReturnType<typeof changedSince>>;
        try {
          found = await changedSince(admin, resourceType, since, maxPerType, beforeRequest);
        } catch (error) {
          // A scope the shop didn't grant: nothing of that type can be translated anyway.
          if (error instanceof AccessDeniedError) continue;
          throw error;
        }
        for (const change of found.changes) {
          if (!AUTO_GID[resourceType].test(change.id)) continue;
          await enqueueAutoCheck(queue, { shopId: shop.id, resourceGid: change.id, resourceType, changedAt: new Date(change.updatedAt).toISOString() });
          if (deps.coverageQueue && REFRESHED_BY_SWEEP.has(resourceType)) await queueSweptCoverageRefresh(deps.coverageQueue, shop.id, change.id);
          summary.queued++;
        }
        if (found.capped) {
          // Blogs can't be read in update order: their position stays until a run gets them all.
          const through = found.through ?? position;
          if (through < complete) complete = through;
          logger.info({ shopId: shop.id, resourceType, max: maxPerType }, "automatic translation catching up: more changes follow in the next run");
        }
      }
      if (complete < everything) summary.catchingUp++;
      await advance(shop.id, complete, deps.prisma, Boolean(smart?.enabled));
      summary.shops++;
    } catch (error) {
      summary.failed++;
      logger.warn({ shopId: shop.id, err: (error as Error).name }, "automatic translation check failed");
    }
  }
  return summary;
}

/** Moves the position forward only (turning it off and on again meanwhile set a later one). */
async function advance(shopId: string, to: Date, client: PrismaClient, smart: boolean) {
  await withTenant(
    shopId,
    (tx) =>
      tx.shopSettings.updateMany({
        where: { shopId, ...(smart ? {} : { autoTranslateNew: true }), OR: [{ autoSweptAt: null }, { autoSweptAt: { lt: to } }] },
        data: { autoSweptAt: to },
      }),
    client,
  );
}
