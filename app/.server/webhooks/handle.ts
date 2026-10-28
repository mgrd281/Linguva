import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../../shopify.server";
import { isShopAllowed } from "../lib/config";
import { logger } from "../lib/logger";
import {
  processWebhook,
  webhookResponse,
  type VerifiedWebhook,
} from "./process-webhook";

/**
 * Shared webhook route action: verifies the HMAC (401 on failure, via the
 * Shopify library), suppresses duplicate deliveries, runs the handler and maps
 * the outcome to an HTTP status (5xx makes Shopify retry).
 */
export function webhookAction(
  handler: (webhook: VerifiedWebhook) => Promise<void>,
) {
  return async ({ request }: ActionFunctionArgs) => {
    const context = await authenticate.webhook(request);
    // A store this deployment doesn't serve: acknowledged (so Shopify stops
    // retrying) and dropped, nothing stored. Only after the HMAC check.
    if (!isShopAllowed(context.shop)) {
      logger.warn({ shop: context.shop, topic: context.topic }, "webhook dropped: store not served by this deployment");
      return new Response(null, { status: 200 });
    }
    const webhook: VerifiedWebhook = {
      webhookId: context.webhookId,
      topic: context.topic,
      shop: context.shop,
      apiVersion: context.apiVersion,
      triggeredAt: context.triggeredAt,
      payload: context.payload,
    };
    const outcome = await processWebhook(webhook, () => handler(webhook));
    return webhookResponse(outcome);
  };
}
