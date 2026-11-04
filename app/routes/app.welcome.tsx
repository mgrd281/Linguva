import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";

/**
 * Welcome link after a merchant approves a plan (configured per plan in the
 * Partner Dashboard). The plan_handle parameter is never trusted: the
 * subscription is re-checked with the Partner API.
 *
 * An active plan goes on where the work is: the Overview, which welcomes the
 * merchant above the next step (`?welcome=1`), whose button continues. While
 * Shopify doesn't report the plan as active yet, the Plan page (which a store
 * without a plan may open) says how things stand. Shopify's redirect keeps
 * the embedded app's parameters, so the page stays inside the admin.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, redirect } = await requireShop(request);
  const billing = await shopBilling(admin, shop, { force: true });
  const active = billing.configured && billing.state === "ACTIVE";
  return redirect(active ? "/app?welcome=1" : "/app/plan?welcome=1", { target: "_self" });
};
