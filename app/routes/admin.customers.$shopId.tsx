/**
 * One customer (/admin/customers/<shop id>): the store's subscription,
 * usage, languages, complimentary access, jobs, settings and installations.
 * Its action is "Ask Shopify again" (the "refresh" capability: Owner,
 * Finance, Support), audited by refreshCustomerSubscription.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { loadCustomer, refreshCustomerSubscription } from "../.server/admin/customer";
import { adminTitle, metaLocale } from "../admin/meta";
import { adminT } from "../admin/messages";
import { AdminPageError } from "../components/admin/AdminPageError";
import { CustomerNotFound, CustomerView } from "../components/admin/CustomerView";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  const detail = await loadCustomer(params.shopId ?? "");
  if (!detail) return data({ detail: null }, { status: 404 });
  return { detail };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await requireAdmin(request, "refresh");
  return { refresh: await refreshCustomerSubscription(params.shopId ?? "", { userId: ctx.user.id }) };
};

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) => {
  const shop = loaderData?.detail?.shop;
  if (!shop) return adminTitle(matches, "customer.notFoundTitle");
  return [{ title: `${shop.name ?? shop.shopDomain} · ${adminT(metaLocale(matches), "nav.customers")} · Linguva Admin` }];
};

export default function AdminCustomer() {
  const { detail } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (!detail) return <CustomerNotFound />;
  return <CustomerView detail={detail} refresh={result?.refresh ?? null} />;
}

export const ErrorBoundary = AdminPageError;
