import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { coverageAction, loadCoverageItemsPage } from "../.server/coverage/dashboard";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";
import { Card } from "../components/Card";
import { CoverageConfirm } from "../components/CoverageConfirm";
import { FieldStateIcon } from "../components/CoverageStates";
import { ToolHeader, ToolsBreadcrumbSlot, toolsTrail } from "../components/ToolHeader";
import { contentTypeName } from "../lib/content-type-names";
import { FIELD_GROUPS, FIELD_STATES, isFieldState, type FieldState } from "../lib/coverage-rules";
import { RESOURCE_KINDS } from "../lib/resource-kinds";
import { Button } from "../components/Button";

export const loader = async ({ request }: LoaderFunctionArgs) => loadCoverageItemsPage(request);
export const action = async ({ request }: ActionFunctionArgs) => coverageAction(request);

const CONFIRM_ID = "coverage-items-translate";
/** Plan gates of the bulk job: their message has the way to the plans beside it. */
const PLAN_ERRORS = new Set(["PLAN_BULK", "PLAN_LANGUAGE"]);

function errorMessage(i18n: I18n, code: string | null | undefined): string | null {
  const key = `coverage.error.${code ?? ""}`;
  return code && hasMessage(key) ? i18n.t(key) : null;
}

/** One line per state: "Missing: Titles and names, Descriptions (2)", in the order of FIELD_STATES. */
function fieldSummary(i18n: I18n, fields: readonly string[]) {
  const byState = new Map<FieldState, Map<string, number>>();
  for (const entry of fields) {
    const [group, state] = entry.split(":") as [string, string];
    if (!isFieldState(state) || state === "complete") continue;
    const groups = byState.get(state) ?? new Map<string, number>();
    groups.set(group, (groups.get(group) ?? 0) + 1);
    byState.set(state, groups);
  }
  return FIELD_STATES.filter((state) => byState.has(state)).map((state) => ({
    state,
    text: i18n.t("coverage.items.stateFields", {
      state: i18n.t(`coverage.state.${state}`),
      fields: [...byState.get(state)!]
        .map(([group, n]) => `${hasMessage(`coverage.group.${group}`) ? i18n.t(`coverage.group.${group}` as "coverage.group.title") : group}${n > 1 ? ` (${i18n.number(n)})` : ""}`)
        .join(", "),
    }),
  }));
}

export default function CoverageItems() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const fixer = useFetcher<typeof action>();
  const filters = useRef<HTMLFormElement>(null);
  const f = data.filter;
  const languageName = f.locale ? i18n.language(f.locale, data.targets.find((l) => l.locale === f.locale)?.name) : "";
  const typeName = f.type ? contentTypeName(i18n, f.type) : "";
  const filterQuery = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const values: Record<string, string | null> = { lang: f.locale, type: f.type, group: f.fieldGroup, state: f.state === "incomplete" ? null : f.state, q: f.search || null, ...overrides };
    for (const [k, v] of Object.entries(values)) if (v) params.set(k, v);
    return `/app/coverage/items?${params.toString()}`;
  };
  const error = fixer.data && "error" in fixer.data ? fixer.data.error : null;
  const title = t("coverage.items.heading");
  const coverageHref = `/app/coverage${f.locale ? `?lang=${encodeURIComponent(f.locale)}` : ""}`;
  const coverageName = t("settings.tools.coverage.label");
  // A choice applies at once (as on Review and the area lists): no button to press after it. After the
  // select's own events, so the form sends the value just chosen.
  const apply = () => window.setTimeout(() => filters.current?.requestSubmit(), 0);
  const confirm =
    data.target && data.confirm
      ? { resourceType: data.target.resourceType, name: contentTypeName(i18n, data.target.resourceType), includeAttached: data.target.includeAttached, open: data.confirm.open }
      : null;

  return (
    <s-page heading={title}>
      <ToolsBreadcrumbSlot i18n={i18n} href={coverageHref} label={coverageName} />
      <s-stack direction="block" gap="base">
        <ToolHeader tool="coverage" title={title} lead={t("coverage.items.lead")} i18n={i18n} trail={[...toolsTrail(i18n), { href: coverageHref, label: coverageName }]}>
          {/* When the store was last counted: once, not on every row. */}
          {data.countedAt ? <s-text color="subdued">{t("coverage.scan.last", { date: i18n.dateTime(data.countedAt) })}</s-text> : null}
        </ToolHeader>

        <Card>
          <Form method="get" ref={filters}>
            <s-stack direction="block" gap="base">
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, (inline-size > 760px) 1fr 1fr 1fr 1fr, 1fr" gap="base" alignItems="end">
                  <s-select name="lang" label={t("common.language")} value={f.locale ?? ""} onInput={apply}>
                    {data.targets.map((l) => (
                      <s-option key={l.locale} value={l.locale}>
                        {i18n.language(l.locale, l.name)}
                      </s-option>
                    ))}
                  </s-select>
                  <s-select name="type" label={t("coverage.types.type")} value={f.type ?? "all"} onInput={apply}>
                    <s-option value="all">{t("coverage.items.allTypes")}</s-option>
                    {data.coverageTypes.map((type) => (
                      <s-option key={type} value={type}>
                        {contentTypeName(i18n, type)}
                      </s-option>
                    ))}
                  </s-select>
                  <s-select name="group" label={t("coverage.groups.field")} value={f.fieldGroup ?? "all"} onInput={apply}>
                    <s-option value="all">{t("coverage.items.allFields")}</s-option>
                    {FIELD_GROUPS.map((g) => (
                      <s-option key={g} value={g}>
                        {t(`coverage.group.${g}`)}
                      </s-option>
                    ))}
                  </s-select>
                  <s-select name="state" label={t("coverage.items.state")} value={f.state} onInput={apply}>
                    <s-option value="incomplete">{t("coverage.items.incomplete")}</s-option>
                    {FIELD_STATES.map((s) => (
                      <s-option key={s} value={s}>
                        {t(`coverage.state.${s}`)}
                      </s-option>
                    ))}
                  </s-select>
                </s-grid>
              </s-query-container>
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="small-200 base" alignItems="end">
                  <s-search-field name="q" label={t("coverage.items.search")} placeholder={t("coverage.items.searchPlaceholder")} value={f.search} />
                  {/* In a stack of their own: a button's align-self (its width in a block stack) would win over the
                      row's end alignment and lift it to the field's label. */}
                  <s-stack direction="inline" gap="small-200 base" alignItems="center">
                    <Button type="submit">{t("common.action.search")}</Button>
                    <Button variant="tertiary" href={f.locale ? `/app/coverage/items?lang=${encodeURIComponent(f.locale)}` : "/app/coverage/items"}>
                      {t("coverage.items.clear")}
                    </Button>
                  </s-stack>
                </s-grid>
              </s-query-container>
              {data.searchUnavailable || (f.search && !data.searchable) ? <s-text color="subdued">{t("coverage.items.searchUnsupported")}</s-text> : null}
            </s-stack>
          </Form>
        </Card>

        {f.locale ? (
          <Card heading={t("coverage.items.bulkHeading")}>
            <s-stack direction="block" gap="small">
              {error ? (
                <s-banner tone="critical" heading={t("coverage.startFailed.heading")}>
                  <s-paragraph>
                    {errorMessage(i18n, error) ?? t("coverage.startFailed.fallback")}
                    {PLAN_ERRORS.has(error) ? (
                      <>
                        {" "}
                        <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                      </>
                    ) : null}
                  </s-paragraph>
                </s-banner>
              ) : null}
              {!f.type ? (
                <s-paragraph>{t("coverage.items.bulkChooseType")}</s-paragraph>
              ) : data.bulk ? (
                <>
                  <s-paragraph>{t("coverage.items.bulkHelp", { type: typeName, language: languageName })}</s-paragraph>
                  {/* Why the AI buttons are off, with the way to the fix: a key on the Own key plan, else the AI permission. */}
                  {!data.canTranslate ? (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text color="subdued">{t(data.ownKeyMissing ? "coverage.items.noKey" : "coverage.items.cantTranslate")}</s-text>
                      <s-link href={data.ownKeyMissing ? "/app/settings?section=keys" : "/app/settings?section=ai"}>{t(data.ownKeyMissing ? "language.unlock.keyMissing.action" : "language.unlock.consent.action")}</s-link>
                    </s-stack>
                  ) : null}
                  <s-stack direction="inline" gap="base" alignItems="center">
                    {/* Asks first, as everywhere bulk translation starts (what, approval or live, AI characters). */}
                    <Button
                      variant="primary"
                      icon="wand"
                      disabled={!data.canTranslate || !data.jobsAvailable || !confirm}
                      commandFor={CONFIRM_ID}
                      command="--show"
                      {...(fixer.state !== "idle" ? { loading: true } : {})}
                    >
                      {f.state === "failed" ? t("coverage.items.retryFailed") : t("coverage.items.translateMissing")}
                    </Button>
                    <s-link href={`/app/review?lang=${encodeURIComponent(f.locale)}${f.type in RESOURCE_KINDS ? `&type=${f.type}` : ""}`}>{t("coverage.items.reviewDrafts")}</s-link>
                    {f.state !== "outdated" ? <s-link href={filterQuery({ state: "outdated", after: null })}>{t("coverage.items.openOutdated")}</s-link> : null}
                  </s-stack>
                </>
              ) : (
                <s-paragraph>{t("coverage.items.bulkNotAvailable")}</s-paragraph>
              )}
            </s-stack>
          </Card>
        ) : null}

        <Card padding="none">
          {data.items.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("coverage.items.item")}</s-table-header>
                {/* The type column only when items of several types are listed. */}
                {f.type ? null : <s-table-header>{t("coverage.items.type")}</s-table-header>}
                <s-table-header>{t("coverage.items.fields")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.items.map((item) => {
                  const name = item.title ?? t("coverage.items.untitled", { type: contentTypeName(i18n, item.resourceType), reference: item.reference });
                  return (
                    <s-table-row key={item.id}>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-300">
                          {item.href ? <s-link href={item.href}>{name}</s-link> : <s-text>{name}</s-text>}
                          {item.lastAttemptFailed ? <s-text color="subdued">{t("coverage.items.lastAttempt")}</s-text> : null}
                          {item.smart === "translating" ? (
                            <s-badge tone="info" icon="in-progress">
                              {t("coverage.items.smart.translating")}
                            </s-badge>
                          ) : item.smart === "excluded" ? (
                            <s-badge>{t("coverage.items.smart.excluded")}</s-badge>
                          ) : item.smart === "waiting" && data.smartNextCheck && data.smartZone ? (
                            <s-text color="subdued">
                              {t("coverage.items.smart.waiting", {
                                time: t("automatic.schedule.zone", { time: i18n.dateTimeIn(data.smartNextCheck, data.smartZone), zone: data.smartZone }),
                              })}
                            </s-text>
                          ) : null}
                        </s-stack>
                      </s-table-cell>
                      {f.type ? null : <s-table-cell>{contentTypeName(i18n, item.resourceType)}</s-table-cell>}
                      <s-table-cell>
                        <s-stack direction="block" gap="small-300">
                          {fieldSummary(i18n, item.fields).map((field) => (
                            <s-grid key={field.text} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                              <FieldStateIcon state={field.state} />
                              <s-text>{field.text}</s-text>
                            </s-grid>
                          ))}
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="base">
              <s-paragraph>{t("coverage.items.none")}</s-paragraph>
            </s-box>
          )}
          {data.nextCursor || !data.isFirstPage ? (
            <s-box padding="base">
              <s-stack direction="inline" gap="base">
                {!data.isFirstPage ? <Button href={filterQuery({ after: null })}>{t("coverage.items.first")}</Button> : null}
                {data.nextCursor ? (
                  <Button href={filterQuery({ after: data.nextCursor })} icon="chevron-right">
                    {t("coverage.items.next")}
                  </Button>
                ) : null}
              </s-stack>
            </s-box>
          ) : null}
        </Card>
      </s-stack>
      {f.locale && f.type && data.confirm ? (
        <CoverageConfirm
          id={CONFIRM_ID}
          target={confirm}
          languageName={languageName}
          publishMode={data.confirm.publishMode}
          aiRemaining={data.confirm.aiRemaining}
          i18n={i18n}
          onConfirm={() =>
            fixer.submit(
              { intent: "translate", idempotencyKey: `${data.idempotencyKey}-t`, locale: f.locale!, resourceType: f.type!, ...(f.fieldGroup ? { fieldGroup: f.fieldGroup } : {}) },
              { method: "post" },
            )
          }
        />
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
