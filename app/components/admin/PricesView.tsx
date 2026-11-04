/**
 * Prices: the list prices the website and the app's Plan page show, the
 * two steps of a change (Partner Dashboard first: Shopify charges what it
 * says), one form for every plan with a reason and a fresh authenticator
 * code, and the history. Admins without the "prices" capability see the
 * same figures without the form. The form carries the version of every
 * plan it shows; a save after someone else's is refused and the page shows
 * the current prices. Free text (reasons, e-mails) is isolated for
 * right-to-left pages; lists are joined the way the language joins them.
 */
import { useEffect, type ReactNode } from "react";
import { Form, useNavigation } from "react-router";
import { PLAN_LABEL, PRICE_ERROR_LABEL } from "../../admin/labels";
import type { AdminLocale } from "../../admin/locale";
import type { AdminMessageKey } from "../../admin/messages";
import type { PriceChangeView, PricesPageData } from "../../.server/admin/prices";
import type { PriceWarning } from "../../lib/plan-prices";
import { useAdminI18n, useAdminSession, type AdminI18n } from "./context";
import { Icon } from "./Icon";
import { Badge, Card, describedBy, EmptyState, ErrorSummary, Field, Notice, PageHeader, Table, VisuallyHidden } from "./ui";

type Handle = PricesPageData["plans"][number]["handle"];

/** The plans saved by someone else since the form was read (the save was refused). */
export type PricesConflict = Handle[];

export type PricesActionData =
  | { ok: false; errors: Record<string, string>; values: Record<string, string>; conflict?: PricesConflict }
  | { ok: true; changed: Handle[]; savedAt: string };

export interface PricesData {
  page: PricesPageData;
  canEdit: boolean;
}

/** A price as the input shows it: "29", "9.99" (the form accepts "." and ","). */
const inputValue = (usd: number | null) => (usd === null ? "" : Number.isInteger(usd) ? String(usd) : usd.toFixed(2));

const MARGIN_FLOOR = 0.4;

/** The form's error codes (app/admin/labels.ts) and the ones only this page shows. */
const ERROR_LABEL: Record<string, AdminMessageKey> = {
  ...PRICE_ERROR_LABEL,
  MONTHLY_ONLY: "prices.error.MONTHLY_ONLY",
  REASON_INVALID: "prices.error.REASON_INVALID",
  SAVE_REFUSED: "prices.error.SAVE_REFUSED",
};

const LIST_LOCALE: Record<AdminLocale, string> = { en: "en-US", ar: "ar" };

/** "Starter, Pro and Business" / "Starter وPro وBusiness": the language's own separators. */
function listOf(locale: AdminLocale, items: readonly string[]): string {
  return new Intl.ListFormat(LIST_LOCALE[locale], { style: "long", type: "conjunction" }).format(items);
}

export function PricesView({ page, canEdit, result }: PricesData & { result?: PricesActionData | null }) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const session = useAdminSession();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const failed = result && !result.ok ? result : null;
  const conflict = failed?.conflict ?? null;
  const errors = failed?.errors ?? {};
  const values = failed?.values ?? {};
  const planName = (handle: string) => (handle in PLAN_LABEL ? t(PLAN_LABEL[handle as Handle]) : handle);

  // After a save (or a refused one), the result is announced and gets the focus.
  useEffect(() => {
    if (result) document.getElementById(result.ok ? "prices-saved" : result.conflict ? "prices-conflict" : "prices-errors")?.focus();
  }, [result]);

  // A new form (its fields show the stored prices, reason and code empty) once the prices read are new (a conflict reads them again), or after a save.
  const formKey = `${page.plans.map((plan) => `${plan.handle}:${plan.monthlyUsd}:${plan.yearlyUsd}:${plan.version}`).join("|")}|${result?.ok ? result.savedAt : ""}`;
  const fieldId = (handle: string, period: "monthly" | "yearly") => `price-${handle}-${period}`;
  const label = (code: string) => t(ERROR_LABEL[code] ?? "prices.error.NOT_A_PRICE");
  const errorFor = (name: string) => (errors[name] ? label(errors[name]!) : null);
  const firstPrice = page.plans.find((plan) => plan.handle !== "free");
  const summary = Object.entries(errors).map(([name, code]) => {
    const [handle, period] = name.split(".") as [string, "monthly" | "yearly" | undefined];
    const message = label(code);
    if (period) return { field: fieldId(handle, period), message: t("prices.errorField", { plan: planName(handle), period: t(period === "monthly" ? "prices.colMonthly" : "prices.colYearly"), message }) };
    // "prices": the database refused the table (no one field): the first price.
    if (name === "prices") return { field: firstPrice ? fieldId(firstPrice.handle, "monthly") : "list-prices", message };
    return { field: name === "reason" ? "prices-reason" : "prices-code", message };
  });

  return (
    <>
      <PageHeader title={t("prices.title")} lead={t("prices.lead")} />

      <section className="adm-steps" aria-labelledby="steps-title">
        <h2 className="adm-steps__title" id="steps-title">
          <Icon name="info" size={18} />
          {t("prices.stepsTitle")}
        </h2>
        <ol className="adm-steps__list">
          <li>
            <span className="adm-steps__num" aria-hidden="true">
              1
            </span>
            <span className="adm-steps__text">
              {t("prices.step1")}{" "}
              <a className="adm-link" href={page.partnerDashboardUrl} target="_blank" rel="noopener noreferrer">
                {t("prices.step1Link")}
                <Icon name="external" size={14} />
                <VisuallyHidden>{t("common.opensNewTab")}</VisuallyHidden>
              </a>
            </span>
          </li>
          <li>
            <span className="adm-steps__num" aria-hidden="true">
              2
            </span>
            <span className="adm-steps__text">{t("prices.step2")}</span>
          </li>
        </ol>
      </section>

      {result?.ok ? (
        <Notice tone="success" title={t("prices.savedTitle")} role="status" id="prices-saved">
          {result.changed.length > 0 ? (
            <>
              <p>{t("prices.savedChanged", { plans: listOf(i18n.locale, result.changed.map(planName)) })}</p>
              <p>{t("prices.savedReminder")}</p>
            </>
          ) : (
            <p>{t("prices.savedNothing")}</p>
          )}
        </Notice>
      ) : null}

      {conflict ? (
        <Notice tone="critical" title={t("prices.conflictTitle")} role="alert" id="prices-conflict">
          <p>{t("prices.conflictBody", { plans: listOf(i18n.locale, conflict.map(planName)) })}</p>
        </Notice>
      ) : null}

      {page.warnings.length > 0 ? (
        <Notice tone="warning" title={t("prices.warningsTitle")}>
          <ul className="adm-bullets">
            {page.warnings.map((warning) => (
              <li key={warningKey(warning)}>{warningText(warning, i18n, planName)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Card id="list-prices" icon="tag" title={t("prices.formTitle")} lead={t("prices.formLead")} flush>
        {canEdit && session ? (
          <Form method="post" action="/admin/prices" className="adm-priceform" key={formKey} noValidate>
            <input type="hidden" name="_csrf" value={session.csrfToken} />
            {page.plans.map((plan) => (
              <input key={plan.handle} type="hidden" name={`${plan.handle}.version`} value={plan.version} />
            ))}
            <div className="adm-priceform__errors">
              <ErrorSummary id="prices-errors" title={t("prices.errorsTitle")} errors={summary} />
            </div>
            <PriceGrid>
              {page.plans.map((plan) => (
                <PriceRow key={plan.handle} plan={plan} planName={planName(plan.handle)}>
                  {plan.handle === "free" ? (
                    <>
                      <div className="adm-pricegrid__cell">
                        <span className="adm-pricegrid__celllabel">{t("prices.colMonthly")}</span>
                        <span className="adm-muted">{t("prices.alwaysFree")}</span>
                      </div>
                      <div className="adm-pricegrid__cell adm-pricegrid__cell--empty">
                        <span className="adm-pricegrid__celllabel">{t("prices.colYearly")}</span>—
                      </div>
                    </>
                  ) : (
                    (["monthly", "yearly"] as const).map((period) => {
                      if (period === "yearly" && !plan.offersYearly) {
                        // Own key: monthly only (its plan in the Partner Dashboard), so no field.
                        return (
                          <div className="adm-pricegrid__cell adm-pricegrid__cell--empty" key={period}>
                            <span className="adm-pricegrid__celllabel">{t("prices.colYearly")}</span>
                            <span className="adm-muted">{t("prices.monthlyOnly")}</span>
                          </div>
                        );
                      }
                      const name = `${plan.handle}.${period}`;
                      const id = fieldId(plan.handle, period);
                      const error = errorFor(name);
                      const label = t(period === "monthly" ? "prices.monthlyLabel" : "prices.yearlyLabel", { plan: planName(plan.handle) });
                      return (
                        <div className="adm-pricegrid__cell" key={period}>
                          <label className="adm-pricegrid__label" htmlFor={id}>
                            <span className="adm-pricegrid__shortlabel" aria-hidden="true">
                              {t(period === "monthly" ? "prices.colMonthly" : "prices.colYearly")}
                            </span>
                            <span className="adm-sr">{label}</span>
                          </label>
                          <span className={`adm-money${error ? " adm-money--invalid" : ""}`}>
                            <span className="adm-money__unit" aria-hidden="true">
                              $
                            </span>
                            <input
                              className="adm-input adm-money__input"
                              id={id}
                              name={name}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              dir="ltr"
                              defaultValue={values[name] ?? inputValue(period === "monthly" ? plan.monthlyUsd : plan.yearlyUsd)}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `${id}-error` : undefined}
                            />
                          </span>
                          {error ? (
                            <p className="adm-field__error" id={`${id}-error`}>
                              <Icon name="alert" size={14} />
                              {error}
                            </p>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </PriceRow>
              ))}
            </PriceGrid>

            <div className="adm-priceform__confirm">
              <Field id="prices-reason" label={t("prices.reason")} hint={t("prices.reasonHint")} error={errorFor("reason")}>
                <textarea
                  className="adm-input adm-textarea"
                  id="prices-reason"
                  name="reason"
                  rows={2}
                  maxLength={500}
                  defaultValue={values.reason ?? ""}
                  aria-invalid={errors.reason ? true : undefined}
                  aria-describedby={describedBy("prices-reason", { hint: true, error: Boolean(errors.reason) })}
                />
              </Field>
              <Field id="prices-code" label={t("prices.code")} hint={t("prices.codeHint")} error={errorFor("code")}>
                <input
                  className="adm-input adm-input--code"
                  id="prices-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  dir="ltr"
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={describedBy("prices-code", { hint: true, error: Boolean(errors.code) })}
                />
              </Field>
              <div className="adm-priceform__submit">
                <button type="submit" className="adm-btn adm-btn--primary" disabled={saving}>
                  <Icon name="lock" size={16} />
                  {saving ? t("prices.saving") : t("prices.save")}
                </button>
              </div>
            </div>
          </Form>
        ) : (
          <>
            <div className="adm-card__notice">
              <Notice tone="info" title={t("prices.readOnly")} />
            </div>
            <PriceGrid>
              {page.plans.map((plan) => (
                <PriceRow key={plan.handle} plan={plan} planName={planName(plan.handle)}>
                  <div className="adm-pricegrid__cell">
                    <span className="adm-pricegrid__celllabel">{t("prices.colMonthly")}</span>
                    {plan.handle === "free" ? <span className="adm-muted">{t("prices.alwaysFree")}</span> : <span className="adm-num adm-strong">{i18n.usd(plan.monthlyUsd)}</span>}
                  </div>
                  <div className="adm-pricegrid__cell">
                    <span className="adm-pricegrid__celllabel">{t("prices.colYearly")}</span>
                    {plan.yearlyUsd === null ? (
                      <span className="adm-muted">{plan.handle === "free" ? "—" : t("prices.monthlyOnly")}</span>
                    ) : (
                      <span className="adm-num adm-strong">{i18n.usd(plan.yearlyUsd)}</span>
                    )}
                  </div>
                </PriceRow>
              ))}
            </PriceGrid>
          </>
        )}
      </Card>
      <p className="adm-footnote">{t("prices.marginNote")}</p>

      <Card id="history" icon="history" title={t("prices.historyTitle")} flush>
        <PriceHistory changes={page.history} />
      </Card>
    </>
  );
}

/** The column heads (shown from 960 px; on a phone every cell carries its own label). */
function PriceGrid({ children }: { children: ReactNode }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-pricegrid">
      <div className="adm-pricegrid__head" aria-hidden="true">
        <span>{t("prices.colPlan")}</span>
        <span>{t("prices.colMonthly")}</span>
        <span>{t("prices.colYearly")}</span>
        <span>{t("prices.colDefault")}</span>
        <span>{t("prices.colMargin")}</span>
        <span>{t("prices.colChanged")}</span>
      </div>
      {children}
    </div>
  );
}

function PriceRow({ plan, planName, children }: { plan: PricesPageData["plans"][number]; planName: string; children: ReactNode }) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  const nameId = `plan-${plan.handle}-name`;
  const margin = (value: number | null, period: "monthly" | "yearly") =>
    value === null ? null : (
      <span className="adm-margin">
        <span className="adm-num">{t(period === "monthly" ? "prices.perMonth" : "prices.perYear", { price: i18n.percent(value) })}</span>
        {value < MARGIN_FLOOR ? (
          <Badge tone="warning" icon="alert">
            {t("prices.marginLow")}
          </Badge>
        ) : null}
      </span>
    );
  return (
    <div className="adm-pricegrid__row" role="group" aria-labelledby={nameId}>
      <div className="adm-pricegrid__plan">
        <span className="adm-pricegrid__name" id={nameId}>
          {planName}
        </span>
        <Badge tone={plan.isDefault ? "neutral" : "accent"} icon={plan.isDefault ? "check" : "tag"}>
          {plan.isDefault ? t("prices.badgeDefault") : t("prices.badgeChanged")}
        </Badge>
      </div>
      {children}
      <div className="adm-pricegrid__cell adm-pricegrid__meta">
        <span className="adm-pricegrid__celllabel">{t("prices.colDefault")}</span>
        {plan.handle === "free" ? (
          <span className="adm-muted">{t("prices.alwaysFree")}</span>
        ) : (
          <span className="adm-stacked">
            <span className="adm-num">{t("prices.perMonth", { price: i18n.usd(plan.defaultMonthlyUsd) })}</span>
            <span className="adm-num adm-muted">{plan.defaultYearlyUsd === null ? t("prices.monthlyOnly") : t("prices.perYear", { price: i18n.usd(plan.defaultYearlyUsd) })}</span>
          </span>
        )}
      </div>
      <div className="adm-pricegrid__cell adm-pricegrid__meta">
        <span className="adm-pricegrid__celllabel">{t("prices.colMargin")}</span>
        {plan.margin.monthly === null ? (
          <span className="adm-muted">—</span>
        ) : (
          <span className="adm-stacked">
            {margin(plan.margin.monthly, "monthly")}
            {plan.margin.yearly !== null ? <span className="adm-muted">{margin(plan.margin.yearly, "yearly")}</span> : null}
          </span>
        )}
      </div>
      <div className="adm-pricegrid__cell adm-pricegrid__meta">
        <span className="adm-pricegrid__celllabel">{t("prices.colChanged")}</span>
        {plan.lastChange ? (
          <span className="adm-stacked">
            <span>{i18n.date(plan.lastChange.at)}</span>
            <bdi className="adm-muted adm-truncate">{plan.lastChange.by ?? t("common.deletedAccount")}</bdi>
          </span>
        ) : (
          <span className="adm-muted">{t("prices.neverChanged")}</span>
        )}
      </div>
    </div>
  );
}

/** Price changes as a table (Prices and Activity). */
export function PriceHistory({ changes }: { changes: PriceChangeView[] }) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  if (changes.length === 0) return <EmptyState icon="history" title={t("prices.historyEmpty")} />;
  const price = (monthly: number, yearly: number | null) => (
    <span className="adm-stacked">
      <span className="adm-num">{t("prices.perMonth", { price: i18n.usd(monthly) })}</span>
      {yearly !== null ? <span className="adm-num adm-muted">{t("prices.perYear", { price: i18n.usd(yearly) })}</span> : null}
    </span>
  );
  return (
    <Table caption={t("prices.historyCaption")}>
      <thead>
        <tr>
          <th scope="col">{t("prices.colWhen")}</th>
          <th scope="col">{t("prices.colPlan")}</th>
          <th scope="col" className="adm-num">
            {t("prices.colBefore")}
          </th>
          <th scope="col" className="adm-num">
            {t("prices.colAfter")}
          </th>
          <th scope="col">{t("prices.colReason")}</th>
          <th scope="col">{t("prices.colBy")}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr key={change.id}>
            <td className="adm-nowrap">{i18n.dateTime(change.at)}</td>
            <th scope="row" className="adm-nowrap">
              {change.handle in PLAN_LABEL ? t(PLAN_LABEL[change.handle as Handle]) : change.handle}
            </th>
            <td className="adm-num adm-muted">{price(change.oldMonthlyUsd, change.oldYearlyUsd)}</td>
            <td className="adm-num">{price(change.newMonthlyUsd, change.newYearlyUsd)}</td>
            <td className="adm-reason">
              <bdi>{change.reason}</bdi>
            </td>
            <td>
              <bdi className="adm-truncate">{change.by ?? t("common.deletedAccount")}</bdi>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function warningKey(warning: PriceWarning): string {
  return warning.code === "LADDER_NOT_RISING" ? `${warning.code}:${warning.handle}` : `${warning.code}:${warning.handle}:${warning.period}`;
}

function warningText(warning: PriceWarning, i18n: AdminI18n, planName: (handle: string) => string): string {
  if (warning.code === "LADDER_NOT_RISING") return i18n.t("prices.warnLadder", { plan: planName(warning.handle), below: planName(warning.below) });
  const period: AdminMessageKey = warning.period === "monthly" ? "period.monthly" : "period.yearly";
  return i18n.t("prices.warnMargin", { plan: planName(warning.handle), period: i18n.t(period), margin: i18n.percent(warning.margin) });
}
