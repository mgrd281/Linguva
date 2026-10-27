import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";

export interface VerifiedWebhook {
  webhookId: string;
  topic: string;
  shop: string;
  apiVersion?: string;
  triggeredAt?: string;
  payload: unknown;
}

export type WebhookOutcome = "processed" | "duplicate" | "failed";

// A delivery stuck in PROCESSING longer than this is assumed to have crashed
// and may be claimed again by a retry.
const STALE_PROCESSING_MS = 5 * 60 * 1000;

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Claims a webhook delivery so each `X-Shopify-Webhook-Id` is handled at most
 * once successfully. Returns false when the delivery was already processed
 * (or is being processed right now by another request).
 */
async function claim(
  webhook: VerifiedWebhook,
  client: PrismaClient,
): Promise<boolean> {
  try {
    await client.webhookEvent.create({
      data: {
        webhookId: webhook.webhookId,
        topic: webhook.topic,
        shopDomain: webhook.shop,
        apiVersion: webhook.apiVersion ?? null,
        triggeredAt: webhook.triggeredAt ? new Date(webhook.triggeredAt) : null,
        payloadHash: hashPayload(webhook.payload),
      },
    });
    return true;
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
  }

  // Already seen: allow a retry only after a failure or a stale attempt.
  const reclaimed = await client.webhookEvent.updateMany({
    where: {
      webhookId: webhook.webhookId,
      OR: [
        { status: "FAILED" },
        {
          status: "PROCESSING",
          receivedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      receivedAt: new Date(),
      errorCode: null,
    },
  });
  return reclaimed.count === 1;
}

export async function processWebhook(
  webhook: VerifiedWebhook,
  handler: () => Promise<void>,
  client: PrismaClient = defaultClient,
): Promise<WebhookOutcome> {
  const log = logger.child({
    webhookId: webhook.webhookId,
    topic: webhook.topic,
    shop: webhook.shop,
  });

  if (!(await claim(webhook, client))) {
    log.info("webhook duplicate ignored");
    return "duplicate";
  }

  try {
    await handler();
    await client.webhookEvent.update({
      where: { webhookId: webhook.webhookId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    log.info("webhook processed");
    return "processed";
  } catch (error) {
    const errorCode = error instanceof Error ? error.name : "UnknownError";
    await client.webhookEvent.update({
      where: { webhookId: webhook.webhookId },
      data: { status: "FAILED", errorCode },
    });
    log.error({ errorCode }, "webhook handler failed");
    return "failed";
  }
}

/** Maps an outcome to the HTTP status Shopify expects (non-2xx => retry). */
export function webhookResponse(outcome: WebhookOutcome): Response {
  return new Response(null, { status: outcome === "failed" ? 500 : 200 });
}
