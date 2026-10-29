import { webhookAction } from "../.server/webhooks/handle";
import { dropDeletedFromCoverage } from "../.server/coverage/refresh";

/**
 * products/delete, collections/delete: the resource and its custom fields
 * leave the coverage report right away, in every language.
 */
export const action = webhookAction(async ({ shop, topic, payload }) => {
  await dropDeletedFromCoverage({ shopDomain: shop, topic, payload });
});
