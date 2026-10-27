import { prisma } from "../.server/lib/db";
import { webhookAction } from "../.server/webhooks/handle";
import { recordScopesUpdate } from "../.server/tenancy/shop-service";

export const action = webhookAction(async ({ shop, payload }) => {
  const current = (payload as { current?: unknown }).current;
  const scopes = Array.isArray(current) ? current.map(String).join(",") : "";
  await prisma.session.updateMany({
    where: { shop, isOnline: false },
    data: { scope: scopes },
  });
  await recordScopesUpdate(shop, scopes);
});
