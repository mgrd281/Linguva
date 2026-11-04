/**
 * Customers (/admin/customers): every store, searched, filtered and sorted
 * on the server from the directory, 50 a page.
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { filterRows, loadDirectory } from "../.server/admin/directory";
import { CONSOLE_PLANS, type ConsolePlan } from "../admin/labels";
import { adminTitle } from "../admin/meta";
import { AdminPageError } from "../components/admin/AdminPageError";
import { CUSTOMER_SORTS, CustomersView, PAGE_SIZE, type CustomerFilters, type CustomerSort } from "../components/admin/CustomersView";

function filtersOf(params: URLSearchParams): CustomerFilters {
  const status = params.get("status");
  const plan = params.get("plan");
  const sort = params.get("sort");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    status: status === "ACTIVE" || status === "UNINSTALLED" ? status : "all",
    plan: plan && (CONSOLE_PLANS as readonly string[]).includes(plan) ? (plan as ConsolePlan) : "all",
    sort: sort && (CUSTOMER_SORTS as readonly string[]).includes(sort) ? (sort as CustomerSort) : "newest",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  const params = new URL(request.url).searchParams;
  const filters = filtersOf(params);
  const dir = await loadDirectory();
  const matches = filterRows(dir.rows, filters);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  return {
    rows: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: matches.length,
    totalAll: dir.rows.length,
    page,
    pages,
    filters,
  };
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.customers");

export default function AdminCustomers() {
  const data = useLoaderData<typeof loader>();
  return <CustomersView {...data} />;
}

export const ErrorBoundary = AdminPageError;
