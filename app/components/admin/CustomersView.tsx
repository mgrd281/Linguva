/**
 * Customers: every store, searchable (name or domain), filtered by status
 * and plan, sorted, 50 a page. A plain GET form: the filters are the URL,
 * so a view can be bookmarked or shared and works without JavaScript.
 */
import { Form, Link, useSubmit } from "react-router";
import { CONSOLE_PLANS, PLAN_LABEL, type ConsolePlan } from "../../admin/labels";
import type { ShopRow } from "../../.server/admin/directory";
import { useAdminI18n } from "./context";
import { Icon } from "./Icon";
import { Card, EmptyState, PageHeader, PlanBadge, StoreCell, StoreStatusBadge, SubscriptionMarks, Table } from "./ui";

export const CUSTOMER_SORTS = ["newest", "oldest", "usage", "revenue", "name"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export const PAGE_SIZE = 50;
const CUSTOMERS_PATH = "/admin/customers";

export interface CustomerFilters {
  q: string;
  status: "ACTIVE" | "UNINSTALLED" | "all";
  plan: ConsolePlan | "all";
  sort: CustomerSort;
}

export interface CustomersData {
  rows: ShopRow[];
  /** Stores matching the filters. */
  total: number;
  /** All stores (an empty directory is a different state from no match). */
  totalAll: number;
  page: number;
  pages: number;
  filters: CustomerFilters;
}

const SORT_LABEL = {
  newest: "customers.sortNewest",
  oldest: "customers.sortOldest",
  usage: "customers.sortUsage",
  revenue: "customers.sortRevenue",
  name: "customers.sortName",
} as const;

/** The URL of another page of the same view. */
function pageHref(filters: CustomerFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.plan !== "all") params.set("plan", filters.plan);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${CUSTOMERS_PATH}?${query}` : CUSTOMERS_PATH;
}

export function CustomersView({ rows, total, totalAll, page, pages, filters }: CustomersData) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const submit = useSubmit();
  const filtered = filters.q !== "" || filters.status !== "all" || filters.plan !== "all";
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  // With JavaScript a changed filter applies at once; without it, the Apply button sends the form.
  const autoSubmit = (event: { currentTarget: HTMLSelectElement }) => submit(event.currentTarget.form, { replace: true });
  return (
    <>
      <PageHeader title={t("customers.title")} lead={t("customers.lead")} />
      <Card
        id="stores"
        icon="store"
        title={t("customers.caption")}
        lead={totalAll > 0 ? <span className="adm-num">{t("customers.range", { from: i18n.number(from), to: i18n.number(to), total: i18n.number(total) })}</span> : undefined}
        flush
      >
        <Form method="get" action={CUSTOMERS_PATH} className="adm-toolbar" role="search">
          <div className="adm-toolbar__search">
            <label className="adm-sr" htmlFor="q">
              {t("customers.search")}
            </label>
            <Icon name="search" size={16} className="adm-toolbar__searchicon" />
            <input
              className="adm-input adm-input--search"
              id="q"
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder={t("customers.searchPlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="adm-toolbar__filters">
            <label className="adm-select-label">
              <span className="adm-sr">{t("customers.status")}</span>
              <select className="adm-select" name="status" defaultValue={filters.status} onChange={autoSubmit}>
                <option value="all">{t("customers.allStatuses")}</option>
                <option value="ACTIVE">{t("status.ACTIVE")}</option>
                <option value="UNINSTALLED">{t("status.UNINSTALLED")}</option>
              </select>
            </label>
            <label className="adm-select-label">
              <span className="adm-sr">{t("customers.plan")}</span>
              <select className="adm-select" name="plan" defaultValue={filters.plan} onChange={autoSubmit}>
                <option value="all">{t("customers.allPlans")}</option>
                {CONSOLE_PLANS.map((plan) => (
                  <option key={plan} value={plan}>
                    {t(PLAN_LABEL[plan])}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-select-label">
              <span className="adm-sr">{t("customers.sort")}</span>
              <select className="adm-select" name="sort" defaultValue={filters.sort} onChange={autoSubmit}>
                {CUSTOMER_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {t(SORT_LABEL[sort])}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="adm-btn adm-btn--secondary">
              {t("customers.apply")}
            </button>
            {filtered ? (
              <Link className="adm-link adm-link--quiet" to={CUSTOMERS_PATH}>
                {t("customers.clear")}
              </Link>
            ) : null}
          </div>
        </Form>

        {totalAll === 0 ? (
          <EmptyState icon="store" title={t("customers.emptyTitle")} body={t("customers.emptyBody")} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="search"
            title={t("customers.noMatchTitle")}
            body={t("customers.noMatchBody")}
            action={
              <Link className="adm-btn adm-btn--secondary" to={CUSTOMERS_PATH}>
                {t("customers.clear")}
              </Link>
            }
          />
        ) : (
          <Table caption={t("customers.caption")}>
            <thead>
              <tr>
                <th scope="col">{t("customers.colStore")}</th>
                <th scope="col">{t("customers.colPlan")}</th>
                <th scope="col">{t("customers.colStatus")}</th>
                <th scope="col">{t("customers.colInstalled")}</th>
                <th scope="col" className="adm-num">
                  {t("customers.colLanguages")}
                </th>
                <th scope="col" className="adm-num">
                  {t("customers.colChars")}
                </th>
                <th scope="col" className="adm-num">
                  {t("customers.colRevenue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <StoreCell id={row.id} name={row.name} domain={row.shopDomain} />
                  </th>
                  <td>
                    <span className="adm-badges">
                      <PlanBadge plan={row.plan} />
                      <SubscriptionMarks
                        inTrial={row.inTrial}
                        cancelling={row.status === "ACTIVE" && row.subscription?.state === "ACTIVE" && row.subscription.cancelAtEndOfCycle}
                      />
                    </span>
                  </td>
                  <td>
                    <StoreStatusBadge status={row.status} />
                  </td>
                  <td className="adm-nowrap">{i18n.date(row.installedAt)}</td>
                  <td className="adm-num">{i18n.number(row.languages)}</td>
                  <td className="adm-num" title={i18n.number(row.usage.chars + row.usage.ownKeyChars)}>
                    {i18n.number(row.usage.chars + row.usage.ownKeyChars)}
                  </td>
                  <td className="adm-num">{row.monthlyRevenueUsd > 0 ? i18n.usd(row.monthlyRevenueUsd, { cents: true }) : <span className="adm-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {pages > 1 ? (
          <nav className="adm-pager" aria-label={t("customers.pages")}>
            {page > 1 ? (
              <Link className="adm-btn adm-btn--secondary adm-btn--sm" to={pageHref(filters, page - 1)} rel="prev">
                <Icon name="chevronLeft" size={16} />
                {t("customers.previous")}
              </Link>
            ) : (
              <span className="adm-pager__spacer" />
            )}
            <span className="adm-pager__label">{t("customers.page", { page: i18n.number(page), pages: i18n.number(pages) })}</span>
            {page < pages ? (
              <Link className="adm-btn adm-btn--secondary adm-btn--sm" to={pageHref(filters, page + 1)} rel="next">
                {t("customers.next")}
                <Icon name="chevronRight" size={16} />
              </Link>
            ) : (
              <span className="adm-pager__spacer" />
            )}
          </nav>
        ) : null}
      </Card>
      <p className="adm-footnote">{t("common.utcNote")}</p>
    </>
  );
}
