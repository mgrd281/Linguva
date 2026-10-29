import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";

/**
 * Welcome link after a merchant approves a plan (configured per plan in the
 * Partner Dashboard). The plan_handle parameter is never trusted: the
 * subscription is re-checked with the Partner API.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  await shopBilling(admin, shop, { force: true });
  return redirect("/app/plan?welcome=1");
};
