import { webhookAction } from "../.server/webhooks/handle";
import { markShopUninstalled } from "../.server/tenancy/shop-service";

// Data is retained after uninstall (reinstall support) and erased on
// shop/redact. See docs/DATABASE_SCHEMA.md §4.
export const action = webhookAction(async ({ shop }) => {
  await markShopUninstalled(shop);
});
