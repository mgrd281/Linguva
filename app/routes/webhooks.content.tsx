import { webhookAction } from "../.server/webhooks/handle";
import { queueAutoTranslate } from "../.server/jobs/auto-translate";
import { getQueues } from "../.server/queue/client";

/** products/create|update, collections/create|update: automatic translation (if turned on). */
export const action = webhookAction(async ({ shop, topic, payload }) => {
  const queues = getQueues();
  await queueAutoTranslate({ shopDomain: shop, topic, payload }, { queue: queues?.auto ?? null });
});
