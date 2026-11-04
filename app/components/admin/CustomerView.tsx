/**
 * One store: its plan, revenue and usage at a glance, then the subscription
 * as Shopify last reported it (with "Ask Shopify again" for admins who may),
 * six months of usage, languages, complimentary access, jobs, settings and
 * installations. Figures and dates only, no merchant content.
 */
import { Form, useNavigation } from "react-router";
import { INSTALL_EVENT_LABEL, JOB_STATUS_LABEL, JOB_STATUSES, periodLabel, PLAN_LABEL, planOfHandle, REFRESH_RESULT_LABEL, SUB_STATE_LABEL } from "../../admin/labels";
import type { CustomerDetail, RefreshResult } from "../../.server/admin/customer";
import { useAdminI18n, useAdminSession } from "./context";
import { Icon } from "./Icon";
import { Badge, Bar, Card, EmptyState, Facts, Kpi, KpiGrid, Notice, PageHeader, PlanBadge, StoreStatusBadge, SubscriptionMarks, Table, VisuallyHidden } from "./ui";

export interface CustomerData {
  detail: CustomerDetail;
}

export function CustomerNotFound() {
  const { t } = useAdminI18n();
  return (
    <>
      <PageHeader title={t("customer.notFoundTitle")} back={{ to: "/admin/customers", label: t("customer.back") }} />
      <div className="adm-card">
        <EmptyState icon="search" title={t("customer.notFoundTitle")} body={t("customer.notFoundBody")} />
      </div>
    </>
  );
}

export function CustomerView({ detail, refresh }: CustomerData & { refresh?: RefreshResult | null }) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const session = useAdminSession();
  const navigation = useNavigation();
  const refreshing = navigation.state === "submitting" && navigation.formMethod?.toUpperCase() === "POST";
  const { shop } = detail;
  const sub = shop.subscription;
  const cancelling = shop.status === "ACTIVE" && sub?.state === "ACTIVE" && sub.cancelAtEndOfCycle;
  const pendingPlan = sub?.state === "ACTIVE" ? planOfHandle(sub.pendingPlanHandle) : null;
  const usageMax = Math.max(1, ...detail.usageByMonth.map((m) => m.chars + m.ownKeyChars));
  const dateOr = (iso: string | null | undefined, fallback = "—") => (iso ? i18n.dateTime(iso) : fallback);
  const yesNo = (value: boolean) => (value ? t("common.yes") : t("common.no"));
  const period = sub ? periodLabel(sub.billingPeriod) : null;
  const jobsTotal = Object.values(detail.jobs.last30).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <PageHeader
        title={shop.name ?? shop.shopDomain}
        back={{ to: "/admin/customers", label: t("customer.back") }}
        lead={
          <span className="adm-inline">
            <bdi className="adm-domain">{shop.shopDomain}</bdi>
            <StoreStatusBadge status={shop.status} />
            <span className="adm-muted">
              {shop.status === "UNINSTALLED" && shop.uninstalledAt
                ? t("customer.uninstalledOn", { date: i18n.date(shop.uninstalledAt) })
                : t("customer.installedOn", { date: i18n.date(shop.installedAt) })}
            </span>
          </span>
        }
        actions={
          detail.adminUrl ? (
            <a className="adm-btn adm-btn--secondary" href={detail.adminUrl} target="_blank" rel="noopener noreferrer">
              {t("customer.openShopify")}
              <Icon name="external" size={16} />
              <VisuallyHidden>{t("common.opensNewTab")}</VisuallyHidden>
            </a>
          ) : null
        }
      />

      <KpiGrid label={shop.name ?? shop.shopDomain}>
        <Kpi
          icon="layers"
          label={t("customer.factPlan")}
          value={t(PLAN_LABEL[shop.plan])}
          context={
            <>
              {period ? <span>{t(period)}</span> : null}
              {shop.inTrial || cancelling || pendingPlan ? (
                <span className="adm-badges">
                  <SubscriptionMarks inTrial={shop.inTrial} cancelling={cancelling} pendingPlan={pendingPlan} />
                </span>
              ) : null}
            </>
          }
        />
        <Kpi icon="trend" label={t("customer.factRevenue")} value={i18n.usd(shop.monthlyRevenueUsd)} />
        <Kpi
          icon="sparkles"
          label={t("customer.factChars")}
          value={i18n.compact(shop.usage.chars + shop.usage.ownKeyChars)}
          title={i18n.number(shop.usage.chars + shop.usage.ownKeyChars)}
          context={t("overview.kpiUsageContext", { cost: i18n.usd(shop.usage.costUsd, { cents: true }) })}
        />
        <Kpi icon="globe" label={t("customer.factLanguages")} value={i18n.number(shop.languages)} />
      </KpiGrid>

      <div className="adm-grid adm-grid--wide-narrow">
        <div className="adm-stack">
          <Card
            id="subscription"
            icon="card"
            title={t("customer.subTitle")}
            lead={t("customer.subLead")}
            actions={
              session?.can.refresh ? (
                <Form method="post" className="adm-inline-form">
                  <input type="hidden" name="_csrf" value={session.csrfToken} />
                  <button type="submit" className="adm-btn adm-btn--secondary adm-btn--sm" disabled={refreshing} aria-describedby="refresh-hint">
                    <Icon name="refresh" size={16} className={refreshing ? "adm-spin" : undefined} />
                    {refreshing ? t("customer.refreshing") : t("customer.refresh")}
                  </button>
                </Form>
              ) : null
            }
          >
            {refresh ? <Notice tone={refresh.ok ? "success" : "warning"} role="status" title={t(REFRESH_RESULT_LABEL[refresh.ok ? "OK" : refresh.reason])} /> : null}
            {sub ? (
              <Facts
                items={[
                  {
                    term: t("customer.subState"),
                    value: (
                      <Badge tone={sub.state === "ACTIVE" ? "success" : "neutral"} icon={sub.state === "ACTIVE" ? "check" : "minus"}>
                        {t(SUB_STATE_LABEL[sub.state])}
                      </Badge>
                    ),
                  },
                  { term: t("customer.subPlan"), value: sub.planHandle ? <PlanBadge plan={planOfHandle(sub.planHandle) ?? "unknown"} /> : "—" },
                  { term: t("customer.subHandle"), value: sub.planHandle ? <code className="adm-code">{sub.planHandle}</code> : "—" },
                  { term: t("customer.subPeriod"), value: period ? t(period) : (sub.billingPeriod ?? "—") },
                  { term: t("customer.subTrialEnds"), value: dateOr(sub.trialEndsAt) },
                  { term: t("customer.subPeriodEnds"), value: dateOr(sub.currentPeriodEnd) },
                  { term: t("customer.subCancels"), value: yesNo(sub.cancelAtEndOfCycle) },
                  { term: t("customer.subPending"), value: pendingPlan ? <PlanBadge plan={pendingPlan} /> : "—" },
                  { term: t("customer.subChecked"), value: i18n.dateTime(sub.checkedAt) },
                ]}
              />
            ) : (
              <EmptyState icon="card" title={t("customer.subNone")} />
            )}
            {session?.can.refresh ? (
              <p className="adm-hint" id="refresh-hint">
                {t("customer.refreshHint")}
              </p>
            ) : null}
          </Card>

          <Card id="usage" icon="sparkles" title={t("customer.usageTitle")} lead={t("customer.usageLead")} flush>
            <Table caption={t("customer.usageTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("customer.usageMonth")}</th>
                  <th scope="col" className="adm-col-bar">
                    <VisuallyHidden>{t("customer.usageTitle")}</VisuallyHidden>
                  </th>
                  <th scope="col" className="adm-num">
                    {t("customer.usageLinguva")}
                  </th>
                  <th scope="col" className="adm-num">
                    {t("customer.usageOwnKeys")}
                  </th>
                  <th scope="col" className="adm-num">
                    {t("customer.usageCost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.usageByMonth.map((month) => (
                  <tr key={month.period}>
                    <th scope="row" className="adm-nowrap">
                      {i18n.month(month.period)}
                    </th>
                    <td className="adm-col-bar">
                      <Bar value={month.chars + month.ownKeyChars} max={usageMax} />
                    </td>
                    <td className="adm-num">{i18n.number(month.chars)}</td>
                    <td className="adm-num">{i18n.number(month.ownKeyChars)}</td>
                    <td className="adm-num">{i18n.usd(month.costUsd, { cents: true })}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card id="installs" icon="history" title={t("customer.installsTitle")}>
            {detail.installations.length === 0 ? (
              <EmptyState icon="history" title={t("customer.installsEmpty")} />
            ) : (
              <ol className="adm-timeline">
                {detail.installations.map((event, index) => (
                  <li className="adm-timeline__item" key={`${event.occurredAt}-${index}`}>
                    <span className={`adm-timeline__dot adm-timeline__dot--${event.event === "UNINSTALLED" ? "neutral" : "success"}`} aria-hidden="true" />
                    <span className="adm-timeline__label">{INSTALL_EVENT_LABEL[event.event] ? t(INSTALL_EVENT_LABEL[event.event]!) : event.event}</span>
                    <span className="adm-timeline__date">{i18n.dateTime(event.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="adm-stack">
          <Card id="languages" icon="globe" title={t("customer.languagesTitle")}>
            {detail.locales.length === 0 ? (
              <EmptyState icon="globe" title={t("customer.languagesEmpty")} />
            ) : (
              <ul className="adm-list">
                {detail.locales.map((locale) => (
                  <li className="adm-list__row" key={locale.locale}>
                    <span className="adm-language">
                      <span>{i18n.language(locale.locale)}</span>
                      <code className="adm-code">{locale.locale}</code>
                    </span>
                    <span className="adm-list__end">
                      {locale.primary ? (
                        <Badge tone="accent" icon="check">
                          {t("customer.primary")}
                        </Badge>
                      ) : null}
                      <Badge tone={locale.published ? "success" : "neutral"} icon={locale.published ? "check" : "minus"}>
                        {locale.published ? t("customer.published") : t("customer.hidden")}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card id="jobs" icon="activity" title={t("customer.jobsTitle")} lead={t("customer.jobsLead")}>
            {jobsTotal === 0 && !detail.jobs.lastAt ? (
              <EmptyState icon="activity" title={t("customer.jobsNever")} />
            ) : (
              <>
                <ul className="adm-statlist">
                  {JOB_STATUSES.map((status) => (
                    <li key={status}>
                      <span className="adm-statlist__label">{t(JOB_STATUS_LABEL[status])}</span>
                      <span className="adm-statlist__value adm-num">{i18n.number(detail.jobs.last30[status] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
                {detail.jobs.lastAt ? <p className="adm-hint">{t("customer.jobsLast", { date: i18n.dateTime(detail.jobs.lastAt) })}</p> : null}
              </>
            )}
          </Card>

          <Card id="complimentary" icon="gift" title={t("customer.compTitle")}>
            {detail.complimentary ? (
              <Facts
                items={[
                  {
                    term: t("customer.compState"),
                    value: (
                      <Badge tone={detail.complimentary.active ? "success" : "neutral"} icon={detail.complimentary.active ? "check" : "minus"}>
                        {detail.complimentary.active ? t("customer.compActive") : t("customer.compInactive")}
                      </Badge>
                    ),
                  },
                  { term: t("customer.compLimit"), value: <span className="adm-num">{i18n.number(detail.complimentary.monthlyCharLimit)}</span> },
                  { term: t("customer.compGranted"), value: i18n.dateTime(detail.complimentary.grantedAt) },
                  { term: t("customer.compExpires"), value: dateOr(detail.complimentary.expiresAt, t("common.never")) },
                  ...(detail.complimentary.revokedAt ? [{ term: t("customer.compRevoked"), value: i18n.dateTime(detail.complimentary.revokedAt) }] : []),
                ]}
              />
            ) : (
              <p className="adm-muted">{t("customer.compNone")}</p>
            )}
            <p className="adm-hint">
              {t("customer.compHint")} <code className="adm-code">pnpm ops:complimentary</code>
            </p>
          </Card>

          <Card id="settings" icon="shield" title={t("customer.settingsTitle")}>
            <ul className="adm-statlist">
              <li>
                <span className="adm-statlist__label">{t("customer.settingAuto")}</span>
                <OnOff on={detail.settings.autoTranslateNew} />
              </li>
              <li>
                <span className="adm-statlist__label">{t("customer.settingSmart")}</span>
                <OnOff on={detail.settings.smartAuto} />
              </li>
            </ul>
          </Card>
        </div>
      </div>
      <p className="adm-footnote">{t("common.utcNote")}</p>
    </>
  );
}

function OnOff({ on }: { on: boolean }) {
  const { t } = useAdminI18n();
  return (
    <Badge tone={on ? "success" : "neutral"} icon={on ? "check" : "minus"}>
      {on ? t("common.on") : t("common.off")}
    </Badge>
  );
}
