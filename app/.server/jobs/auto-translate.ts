/**
 * Automatic translation of new and changed products, collections, pages,
 * blog posts and blogs.
 *
 * Shopify sends products/create|update and collections/create|update
 * webhooks; pages, blog posts and blogs have no webhook topics, and a
 * webhook can be missed, so a periodic check (auto-sweep.ts) queues what
 * changed since its last run. When the merchant turned automatic
 * translation on (Settings, per language), the resource is queued with a
 * delay and a fixed queue job id: several saves in a row, or a webhook and
 * the periodic check for the same change, lead to one check. The check runs the same
 * item processing as bulk jobs, so the same rules apply: only missing or
 * outdated fields, drafts unless automatic publishing is on, translations
 * written or approved by a person are kept, AI allowance and daily caps,
 * the plan's bulk entitlement and the AI consent.
 *
 * Linguva's own translations don't change a resource's source text, so if
 * they cause an update webhook, its check finds nothing to do (no AI cost).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { JobsOptions } from "bullmq";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { withTenant } from "../tenancy/with-tenant";
import type { SweptType } from "../shopify/recent-changes";
import { ACTIVE_JOB_STATUSES, AUTO_REQUESTED_BY } from "./bulk-jobs";

export { AUTO_REQUESTED_BY };
import type { JobDependencies } from "./processors";

/** Saves within this window are checked together. */
export const AUTO_TRANSLATE_DELAY_MS = 60_000;

export interface AutoTranslatePayload {
  shopId: string;
  resourceGid: string;
  resourceType: SweptType;
}

/** The queue's add (a BullMQ Queue in production). */
export interface AutoQueue {
  add(name: string, data: AutoTranslatePayload, opts: JobsOptions): Promise<unknown>;
}

const TOPICS: Record<string, AutoTranslatePayload["resourceType"]> = {
  PRODUCTS_CREATE: "PRODUCT",
  PRODUCTS_UPDATE: "PRODUCT",
  COLLECTIONS_CREATE: "COLLECTION",
  COLLECTIONS_UPDATE: "COLLECTION",
};
/** The GID each type's resources have (webhook payloads and Shopify's lists are checked against it). */
export const AUTO_GID: Record<SweptType, RegExp> = {
  PRODUCT: /^gid:\/\/shopify\/Product\/\d{1,20}$/,
  COLLECTION: /^gid:\/\/shopify\/Collection\/\d{1,20}$/,
  PAGE: /^gid:\/\/shopify\/Page\/\d{1,20}$/,
  ARTICLE: /^gid:\/\/shopify\/Article\/\d{1,20}$/,
  BLOG: /^gid:\/\/shopify\/Blog\/\d{1,20}$/,
};

/** Normalises "products/update" and "PRODUCTS_UPDATE". */
function topicKey(topic: string) {
  return topic.toUpperCase().replace("/", "_");
}

/**
 * Handles a verified webhook: queues the resource when the shop translates
 * automatically. The shop comes from the verified webhook, the resource id
 * from its payload (checked against the topic's type); the check later
 * reads the resource from that shop's Admin API only.
 */
export async function queueAutoTranslate(
  input: { shopDomain: string; topic: string; payload: unknown },
  deps: { queue: AutoQueue | null; prisma?: PrismaClient },
): Promise<"queued" | "off" | "ignored"> {
  const resourceType = TOPICS[topicKey(input.topic)];
  const gid = (input.payload as { admin_graphql_api_id?: unknown } | null)?.admin_graphql_api_id;
  if (!resourceType || typeof gid !== "string" || !AUTO_GID[resourceType].test(gid)) return "ignored";
  const client = deps.prisma ?? defaultClient;
  const shop = await client.shop.findUnique({ where: { shopDomain: input.shopDomain } });
  if (!shop || shop.status !== "ACTIVE") return "ignored";
  const settings = await getShopSettings(shop.id, client);
  if (!settings.autoTranslateNew || settings.autoTranslateLocales.length === 0) return "off";
  if (!deps.queue) {
    logger.warn({ shopId: shop.id }, "automatic translation on, but background jobs aren't configured");
    return "ignored";
  }
  await enqueueAutoCheck(deps.queue, { shopId: shop.id, resourceGid: gid, resourceType });
  return "queued";
}

/** Queues the check of one resource (from a webhook or the periodic check). */
export async function enqueueAutoCheck(queue: AutoQueue, payload: AutoTranslatePayload) {
  await queue.add("auto-translate", payload, {
    // One pending check per resource: later saves within the delay join it.
    jobId: `auto_${payload.shopId}_${payload.resourceGid.replace(/\D/g, "")}_${payload.resourceType}`,
    delay: AUTO_TRANSLATE_DELAY_MS,
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
    // Removed when done, so the next save can queue a new check.
    removeOnComplete: true,
    removeOnFail: { age: 14 * 86_400 },
  });
}

/**
 * Creates one item per chosen language for the resource, in the automatic
 * job of the day for that type and language (or in a bulk job already
 * running for it). The caller enqueues the items on the item queue, so they
 * get the same retries, rate limits and error handling as bulk items.
 * "busy": a running job for the type and language has other settings
 * (search engine listings only, or replacing protected translations); the
 * check waits for it instead of adding the item to it.
 */
export async function createAutoItems(
  client: PrismaClient,
  payload: AutoTranslatePayload,
  billingFor?: JobDependencies["billingFor"],
): Promise<{ itemIds: string[]; reused: string[]; busy: boolean }> {
  const none = { itemIds: [], reused: [], busy: false };
  const shop = await client.shop.findUnique({ where: { id: payload.shopId } });
  if (!shop || shop.status !== "ACTIVE") return none;
  // Settings, consent and plan are read again: they may have changed since the webhook.
  const settings = await getShopSettings(payload.shopId, client);
  if (!settings.autoTranslateNew || !hasCurrentAiConsent(settings)) return none;
  const billing = billingFor ? await billingFor(payload.shopId) : null;
  if (billing?.configured && !billing.entitlements.bulk) return none;

  const result = { itemIds: [] as string[], reused: [] as string[], busy: false };
  for (const locale of settings.autoTranslateLocales) {
    const item = await autoItem(client, payload, locale);
    if (item === "busy") result.busy = true;
    else if (item?.reused) result.reused.push(item.itemId);
    else if (item) result.itemIds.push(item.itemId);
  }
  return result;
}

function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function autoItem(client: PrismaClient, payload: AutoTranslatePayload, locale: string) {
  return withTenant(
    payload.shopId,
    async (tx) => {
      // Same lock as bulk job creation: one active job per shop, type and language.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${payload.shopId}:${payload.resourceType}:${locale}`}, 0))`;
      const scope = { shopId: payload.shopId, resourceType: payload.resourceType, targetLocale: locale };
      let job = await tx.translationJob.findFirst({ where: { ...scope, status: { in: [...ACTIVE_JOB_STATUSES] } } });
      // Never join a job that only translates search listings or may replace protected translations.
      if (job && (job.fieldScope !== "ALL" || job.overwriteProtected)) return "busy" as const;
      if (!job) {
        // One automatic job per day, type and language keeps the job list readable.
        const today = await tx.translationJob.findFirst({
          where: { ...scope, requestedBy: AUTO_REQUESTED_BY, status: "COMPLETED", createdAt: { gte: startOfUtcDay(new Date()) } },
          orderBy: { createdAt: "desc" },
        });
        const settings = await tx.shopSettings.findUnique({ where: { shopId: payload.shopId } });
        job = today
          ? await tx.translationJob.update({
              where: { id: today.id },
              data: { status: "RUNNING", finishedAt: null, publishMode: settings?.bulkPublishMode ?? "DRAFT" },
            })
          : await tx.translationJob.create({
              data: {
                ...scope,
                requestedBy: AUTO_REQUESTED_BY,
                idempotencyKey: `auto-${randomUUID()}`,
                // Draft unless the merchant explicitly enabled automatic publishing.
                publishMode: settings?.bulkPublishMode ?? "DRAFT",
                status: "RUNNING",
                startedAt: new Date(),
                discoveryDone: true,
              },
            });
      }
      const existing = await tx.translationJobItem.findFirst({ where: { jobId: job.id, resourceGid: payload.resourceGid } });
      if (existing) {
        // Still waiting or running: it reads the latest text when it runs.
        if (existing.status === "PENDING" || existing.status === "RUNNING") return null;
        await tx.translationJobItem.update({ where: { id: existing.id }, data: { status: "PENDING", errorCode: null, finishedAt: null } });
        // The item is counted again when it finishes.
        await tx.translationJob.update({
          where: { id: job.id },
          data: {
            finishedAt: null,
            ...(existing.status === "SUCCEEDED" ? { succeededItems: { decrement: 1 } } : {}),
            ...(existing.status === "SKIPPED" || existing.status === "CANCELLED" ? { skippedItems: { decrement: 1 } } : {}),
            ...(existing.status === "FAILED" || existing.status === "DEAD" ? { failedItems: { decrement: 1 } } : {}),
          },
        });
        return { itemId: existing.id, reused: true };
      }
      const item = await tx.translationJobItem.create({
        data: { shopId: payload.shopId, jobId: job.id, resourceGid: payload.resourceGid },
      });
      await tx.translationJob.update({ where: { id: job.id }, data: { totalItems: { increment: 1 } } });
      return { itemId: item.id, reused: false };
    },
    client,
  );
}
