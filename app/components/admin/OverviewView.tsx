/**
 * Overview: the KPIs, the plan mix, trials ending soon, the newest stores
 * and the subscription changes waiting, from one directory read (shown with
 * its time and a Reload link that reads the database again).
 */
import { Link } from "react-router";
import { PLAN_LABEL, PLAN_TONE, type ConsolePlan } from "../../admin/labels";
import type { OverviewSummary } from "../../.server/admin/overview";
import { useAdminI18n } from "./context";
import { Icon } from "./Icon";
import { Bar, Card, EmptyState, Kpi, KpiGrid, Notice, PageHeader, PlanBadge, StoreCell, StoreStatusBadge } from "./ui";

export interface OverviewData {
  summary: OverviewSummary;
  builtAt: string;
}

/** The plans always listed in the mix; the others only when a store has them. */
const MAIN_PLANS: readonly ConsolePlan[] = ["free", "starter", "pro", "business"];
const OTHER_PLANS: readonly ConsolePlan[] = ["own-key", "complimentary", "unknown"];

export function OverviewView({ summary, builtAt }: OverviewData) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const plans = [...MAIN_PLANS, ...OTHER_PLANS.filter((plan) => summary.plans[plan] > 0)];
  const installed = summary.stores.active;
  const largest = Math.max(1, ...plans.map((plan) => summary.plans[plan]));
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        lead={t("overview.lead")}
        actions={
          <p className="adm-freshness">
            <span>{t("overview.dataFrom", { time: i18n.time(builtAt) })}</span>
            <Link className="adm-btn adm-btn--secondary adm-btn--sm" to="/admin?refresh=1" preventScrollReset>
              <Icon name="refresh" size={16} />
              {t("overview.reload")}
            </Link>
          </p>
        }
      />

      {!summary.billingConfigured ? (
        <Notice tone="warning" title={t("overview.billingOffTitle")}>
          <p>{t("overview.billingOffBody")}</p>
        </Notice>
      ) : null}

      <KpiGrid label={t("overview.title")}>
        <Kpi
          icon="store"
          label={t("overview.kpiActive")}
          value={i18n.number(summary.stores.active)}
          context={t("overview.kpiActiveContext", { new: i18n.number(summary.stores.new30), lost: i18n.number(summary.stores.lost30) })}
        />
        <Kpi
          icon="card"
          label={t("overview.kpiPaying")}
          value={i18n.number(summary.revenue.payingStores)}
          context={t("overview.kpiPayingContext", { arpu: i18n.usd(summary.revenue.arpuUsd) })}
        />
        <Kpi icon="trend" label={t("overview.kpiMrr")} value={i18n.usd(summary.revenue.mrrUsd)} context={t("overview.kpiMrrContext", { arr: i18n.usd(summary.revenue.arrUsd) })} />
        <Kpi
          icon="clock"
          label={t("overview.kpiTrials")}
          value={i18n.number(summary.trials.count)}
          context={t("overview.kpiTrialsContext", { count: i18n.number(summary.trials.endingSoon.length) })}
        />
        <Kpi
          icon="sparkles"
          label={t("overview.kpiUsage")}
          value={i18n.compact(summary.usage.chars)}
          title={i18n.number(summary.usage.chars)}
          context={
            <>
              <span>{t("overview.kpiUsageContext", { cost: i18n.usd(summary.usage.costUsd, { cents: true }) })}</span>
              {summary.usage.ownKeyChars > 0 ? <span>{t("overview.ownKey", { chars: i18n.compact(summary.usage.ownKeyChars) })}</span> : null}
            </>
          }
        />
      </KpiGrid>
      <p className="adm-footnote">{t("overview.estimateNote")}</p>

      <div className="adm-grid adm-grid--wide-narrow">
        <div className="adm-stack">
          <Card id="plans" icon="layers" title={t("overview.plansTitle")} lead={t("overview.plansLead")}>
            <ul className="adm-dist" aria-label={t("overview.plansCaption")}>
              {plans.map((plan) => {
                const count = summary.plans[plan];
                return (
                  <li className="adm-dist__row" key={plan}>
                    <span className="adm-dist__label">
                      <span className={`adm-dot adm-dot--${PLAN_TONE[plan]}`} aria-hidden="true" />
                      {t(PLAN_LABEL[plan])}
                    </span>
                    <span className="adm-dist__bar">
                      <Bar value={count} max={largest} tone={PLAN_TONE[plan]} />
                    </span>
                    <span className="adm-dist__value">
                      <span className="adm-num">{i18n.number(count)}</span>
                      <span className="adm-dist__share">{i18n.percent(installed > 0 ? count / installed : 0)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card id="recent" icon="store" title={t("overview.recentTitle")} actions={<CardLink to="/admin/customers" />}>
            {summary.recent.length === 0 ? (
              <EmptyState icon="store" title={t("overview.recentEmpty")} />
            ) : (
              <ul className="adm-list">
                {summary.recent.map((row) => (
                  <li className="adm-list__row" key={row.id}>
                    <StoreCell id={row.id} name={row.name} domain={row.shopDomain} />
                    <span className="adm-list__end">
                      {row.status === "ACTIVE" ? <PlanBadge plan={row.plan} /> : <StoreStatusBadge status={row.status} />}
                      <span className="adm-list__meta">{t("overview.installedOn", { date: i18n.date(row.installedAt) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="adm-stack">
          <Card id="changes" icon="card" title={t("overview.changesTitle")} actions={<CardLink to="/admin/subscriptions" />}>
            <ul className="adm-statlist">
              <li>
                <span className="adm-statlist__label">
                  <Icon name="cross" size={16} />
                  {t("overview.cancelling")}
                </span>
                <span className="adm-statlist__value adm-num">{i18n.number(summary.cancelling)}</span>
              </li>
              <li>
                <span className="adm-statlist__label">
                  <Icon name="arrowRight" size={16} />
                  {t("overview.pending")}
                </span>
                <span className="adm-statlist__value adm-num">{i18n.number(summary.pendingChanges)}</span>
              </li>
            </ul>
          </Card>

          <Card id="trials" icon="clock" title={t("overview.trialsTitle")}>
            {summary.trials.endingSoon.length === 0 ? (
              <EmptyState icon="clock" title={t("overview.trialsEmpty")} />
            ) : (
              <ul className="adm-list">
                {summary.trials.endingSoon.map((row) => (
                  <li className="adm-list__row" key={row.id}>
                    <StoreCell id={row.id} name={row.name} domain={row.shopDomain} />
                    <span className="adm-list__end">
                      <PlanBadge plan={row.plan} />
                      <span className="adm-list__meta">{t("overview.endsOn", { date: i18n.date(row.subscription?.trialEndsAt ?? row.installedAt) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="adm-footnote">{t("common.utcNote")}</p>
    </>
  );
}

function CardLink({ to }: { to: string }) {
  const { t } = useAdminI18n();
  return (
    <Link className="adm-link adm-link--quiet" to={to}>
      {t("common.viewAll")}
      <Icon name="chevronRight" size={16} />
    </Link>
  );
}
