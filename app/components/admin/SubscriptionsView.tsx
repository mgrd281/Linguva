/**
 * Subscriptions: the estimated revenue, the plan mix per billing period, and
 * every installed store with an active Shopify subscription (filtered by
 * plan, trial or cancelling), as Shopify last reported them; on a phone each
 * store is a card.
 */
import { useRef } from "react";
import { Form, Link, useSubmit } from "react-router";
import { CONSOLE_PLANS, PLAN_LABEL, periodLabel, planOfHandle } from "../../admin/labels";
import type { MixRow, SubscriptionFilters } from "../../admin/subscriptions";
import type { ShopRow } from "../../.server/admin/directory";
import type { OverviewSummary } from "../../.server/admin/overview";
import { useAdminI18n } from "./context";
import { Card, EmptyState, Kpi, KpiGrid, Notice, PageHeader, PlanBadge, StoreCell, SubscriptionMarks, Table, useFormValues } from "./ui";

export interface SubscriptionsData {
  revenue: OverviewSummary["revenue"];
  billingConfigured: boolean;
  mix: { rows: MixRow[]; total: Omit<MixRow, "plan"> };
  rows: ShopRow[];
  /** Installed stores with an active subscription, before the filters. */
  totalAll: number;
  filters: SubscriptionFilters;
}

const PATH = "/admin/subscriptions";

export function SubscriptionsView({ revenue, billingConfigured, mix, rows, totalAll, filters }: SubscriptionsData) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const submit = useSubmit();
  const form = useRef<HTMLFormElement>(null);
  // The fields follow the URL (Clear filters, Back, Forward), not only their first value.
  useFormValues(form, { plan: filters.plan, trial: filters.trial, cancelling: filters.cancelling });
  const filtered = filters.plan !== "all" || filters.trial || filters.cancelling;
  const autoSubmit = (event: { currentTarget: HTMLInputElement | HTMLSelectElement }) => submit(event.currentTarget.form, { replace: true });
  const dateOr = (iso: string | null | undefined) => (iso ? i18n.date(iso) : "—");
  return (
    <>
      <PageHeader title={t("subs.title")} lead={t("subs.lead")} />
      {!billingConfigured ? (
        <Notice tone="warning" title={t("overview.billingOffTitle")}>
          <p>{t("overview.billingOffBody")}</p>
        </Notice>
      ) : null}

      <KpiGrid label={t("subs.title")}>
        <Kpi icon="trend" label={t("subs.kpiMrr")} value={i18n.usd(revenue.mrrUsd)} />
        <Kpi icon="calendar" label={t("subs.kpiArr")} value={i18n.usd(revenue.arrUsd)} />
        <Kpi icon="card" label={t("subs.kpiPaying")} value={i18n.number(revenue.payingStores)} />
        <Kpi icon="store" label={t("subs.kpiArpu")} value={i18n.usd(revenue.arpuUsd)} />
      </KpiGrid>
      <p className="adm-footnote">{t("overview.estimateNote")}</p>

      <Card id="mix" icon="layers" title={t("subs.mixTitle")} flush>
        {mix.rows.length === 0 ? (
          <EmptyState icon="card" title={t("subs.emptyTitle")} body={t("subs.emptyBody")} />
        ) : (
          // Five short columns fit a phone: a table there too.
          <Table caption={t("subs.mixCaption")} cards={false}>
            <thead>
              <tr>
                <th scope="col">{t("customers.colPlan")}</th>
                <th scope="col" className="adm-num">
                  {t("period.monthly")}
                </th>
                <th scope="col" className="adm-num">
                  {t("period.yearly")}
                </th>
                <th scope="col" className="adm-num">
                  {t("subs.colTrial")}
                </th>
                <th scope="col" className="adm-num">
                  {t("subs.colTotal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {mix.rows.map((row) => (
                <tr key={row.plan}>
                  <th scope="row">
                    <PlanBadge plan={row.plan} />
                  </th>
                  <td className="adm-num">{i18n.number(row.monthly)}</td>
                  <td className="adm-num">{i18n.number(row.yearly)}</td>
                  <td className="adm-num">{i18n.number(row.trial)}</td>
                  <td className="adm-num adm-strong">{i18n.number(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("subs.colTotal")}</th>
                <td className="adm-num">{i18n.number(mix.total.monthly)}</td>
                <td className="adm-num">{i18n.number(mix.total.yearly)}</td>
                <td className="adm-num">{i18n.number(mix.total.trial)}</td>
                <td className="adm-num adm-strong">{i18n.number(mix.total.total)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <Card id="subscribed" icon="card" title={t("subs.listTitle")} count={totalAll > 0 ? i18n.number(rows.length) : undefined} flush>
        <Form ref={form} method="get" action={PATH} className="adm-toolbar" aria-label={t("subs.filters")}>
          <div className="adm-toolbar__filters">
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
            <label className="adm-check">
              <input type="checkbox" name="trial" value="1" defaultChecked={filters.trial} onChange={autoSubmit} />
              <span>{t("subs.onlyTrial")}</span>
            </label>
            <label className="adm-check">
              <input type="checkbox" name="cancelling" value="1" defaultChecked={filters.cancelling} onChange={autoSubmit} />
              <span>{t("subs.onlyCancelling")}</span>
            </label>
            <button type="submit" className="adm-btn adm-btn--secondary">
              {t("customers.apply")}
            </button>
            {filtered ? (
              <Link className="adm-link adm-link--quiet" to={PATH}>
                {t("customers.clear")}
              </Link>
            ) : null}
          </div>
        </Form>
        {totalAll === 0 ? (
          <EmptyState icon="card" title={t("subs.emptyTitle")} body={t("subs.emptyBody")} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="search"
            title={t("customers.noMatchTitle")}
            body={t("customers.noMatchBody")}
            action={
              <Link className="adm-btn adm-btn--secondary" to={PATH}>
                {t("customers.clear")}
              </Link>
            }
          />
        ) : (
          <Table caption={t("subs.listTitle")} cards={2}>
            <thead>
              <tr>
                <th scope="col">{t("customers.colStore")}</th>
                <th scope="col">{t("customers.colPlan")}</th>
                <th scope="col">{t("subs.colPeriod")}</th>
                <th scope="col">{t("subs.colTrialEnds")}</th>
                <th scope="col">{t("subs.colRenews")}</th>
                <th scope="col">{t("subs.colPending")}</th>
                <th scope="col">{t("subs.colChecked")}</th>
                <th scope="col" className="adm-num">
                  {t("customers.colRevenue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const sub = row.subscription!;
                const period = periodLabel(sub.billingPeriod);
                const pending = planOfHandle(sub.pendingPlanHandle);
                return (
                  <tr key={row.id}>
                    <th scope="row">
                      <StoreCell id={row.id} name={row.name} domain={row.shopDomain} />
                    </th>
                    <td className="adm-cell--plain adm-cell--wide">
                      <span className="adm-badges">
                        <PlanBadge plan={row.plan} />
                        <SubscriptionMarks inTrial={row.inTrial} cancelling={row.cancelling} notChecked={sub.checkedAt === null} />
                      </span>
                    </td>
                    <td className="adm-nowrap">{period ? t(period) : (sub.billingPeriod ?? "—")}</td>
                    <td className="adm-nowrap">{dateOr(sub.trialEndsAt)}</td>
                    <td className="adm-nowrap">{dateOr(sub.currentPeriodEnd)}</td>
                    <td>{pending ? <PlanBadge plan={pending} /> : "—"}</td>
                    {/* Null: not asked since the store was (re)installed (only a reset answer has none; this list shows active ones). */}
                    <td className="adm-nowrap adm-muted" title={sub.checkedAt ? i18n.dateTime(sub.checkedAt) : undefined}>
                      {sub.checkedAt ? i18n.shortDateTime(sub.checkedAt) : t("mark.notChecked")}
                    </td>
                    <td className="adm-num">{row.monthlyRevenueUsd > 0 ? i18n.usd(row.monthlyRevenueUsd, { cents: true }) : <span className="adm-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="adm-footnote">
        {t("subs.cacheNote")} {t("common.utcNote")}
      </p>
    </>
  );
}
