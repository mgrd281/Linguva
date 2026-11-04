/**
 * Subscriptions (/admin/subscriptions): the estimated revenue, the plan mix
 * per billing period, and the installed stores with an active Shopify
 * subscription, filtered by plan, trial or cancelling.
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { loadDirectory } from "../.server/admin/directory";
import { summarize } from "../.server/admin/overview";
import { adminTitle } from "../admin/meta";
import { filterSubscriptions, parseSubscriptionFilters, subscribedRows, subscriptionMix } from "../admin/subscriptions";
import { AdminPageError } from "../components/admin/AdminPageError";
import { SubscriptionsView } from "../components/admin/SubscriptionsView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  const filters = parseSubscriptionFilters(new URL(request.url).searchParams);
  const now = new Date();
  const dir = await loadDirectory({ now });
  const summary = summarize(dir, now);
  return {
    revenue: summary.revenue,
    billingConfigured: dir.billingConfigured,
    mix: subscriptionMix(dir.rows),
    rows: filterSubscriptions(dir.rows, filters),
    totalAll: subscribedRows(dir.rows).length,
    filters,
  };
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.subscriptions");

export default function AdminSubscriptions() {
  const data = useLoaderData<typeof loader>();
  return <SubscriptionsView {...data} />;
}

export const ErrorBoundary = AdminPageError;
