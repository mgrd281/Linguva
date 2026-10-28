import { webhookAction } from "../.server/webhooks/handle";
import { queueAutoTranslate } from "../.server/jobs/auto-translate";
import { queueCoverageRefresh } from "../.server/coverage/refresh";
import { getQueues } from "../.server/queue/client";

/**
 * products/create|update, collections/create|update: automatic translation
 * (if turned on), and the coverage of the resource is read again.
 */
export const action = webhookAction(async ({ shop, topic, payload }) => {
  const queues = getQueues();
  await queueAutoTranslate({ shopDomain: shop, topic, payload }, { queue: queues?.auto ?? null });
  await queueCoverageRefresh({ shopDomain: shop, payload }, { queue: queues?.coverage ?? null });
});
