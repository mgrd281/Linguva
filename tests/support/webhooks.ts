import { createHmac, randomUUID } from "node:crypto";

export function signedWebhookRequest(options: {
  path: string;
  topic: string;
  shop: string;
  body: unknown;
  webhookId?: string;
  secret?: string;
  hmac?: string;
}): Request {
  const raw = JSON.stringify(options.body);
  const hmac =
    options.hmac ??
    createHmac("sha256", options.secret ?? process.env.SHOPIFY_API_SECRET!)
      .update(raw, "utf8")
      .digest("base64");
  return new Request(`https://linguva.test${options.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Topic": options.topic,
      "X-Shopify-Shop-Domain": options.shop,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": options.webhookId ?? randomUUID(),
      "X-Shopify-Triggered-At": new Date().toISOString(),
    },
    body: raw,
  });
}
