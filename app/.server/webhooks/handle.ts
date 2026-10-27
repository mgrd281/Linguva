import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../../shopify.server";
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
