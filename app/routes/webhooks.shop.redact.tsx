import { webhookAction } from "../.server/webhooks/handle";
import { handleShopRedact } from "../.server/privacy/compliance";

export const action = webhookAction(async ({ webhookId, shop }) => {
  await handleShopRedact({ webhookId, shopDomain: shop });
});
