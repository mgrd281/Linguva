import { webhookAction } from "../.server/webhooks/handle";
import { handleCustomerPrivacyRequest } from "../.server/privacy/compliance";

export const action = webhookAction(async ({ webhookId, shop }) => {
  await handleCustomerPrivacyRequest({
    webhookId,
    shopDomain: shop,
    topic: "CUSTOMERS_REDACT",
  });
});
