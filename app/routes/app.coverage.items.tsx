import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { coverageAction, loadCoverageItemsPage } from "../.server/coverage/dashboard";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage, kindLabel } from "../i18n/labels";
import { StateDot } from "../components/Coverage";
import { FIELD_GROUPS, FIELD_STATES, isFieldState, type FieldState } from "../lib/coverage-rules";
import { RESOURCE_KINDS } from "../lib/resource-kinds";

export const loader = async ({ request }: LoaderFunctionArgs) => loadCoverageItemsPage(request);
export const action = async ({ request }: ActionFunctionArgs) => coverageAction(request);

function errorMessage(i18n: I18n, code: string | null | undefined): string | null {
  const key = `coverage.error.${code ?? ""}`;
  return code && hasMessage(key) ? i18n.t(key) : null;
}

/** "Title: missing · SEO title: draft" from the item's "group:state" entries (incomplete ones, grouped). */
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
  const f = data.filter;
  const languageName = f.locale ? i18n.language(f.locale, data.targets.find((l) => l.locale === f.locale)?.name) : "";
  const typeName = f.type ? kindLabel(i18n, f.type) : "";
  const filterQuery = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const values: Record<string, string | null> = { lang: f.locale, type: f.type, group: f.fieldGroup, state: f.state === "incomplete" ? null : f.state, q: f.search || null, ...overrides };
    for (const [k, v] of Object.entries(values)) if (v) params.set(k, v);
    return `/app/coverage/items?${params.toString()}`;
  };
  const error = fixer.data && "error" in fixer.data ? fixer.data.error : null;

  return (
    <s-page heading={t("coverage.items.heading")}>
      <s-link slot="breadcrumb-actions" href={`/app/coverage${f.locale ? `?lang=${encodeURIComponent(f.locale)}` : ""}`}>
        {t("coverage.items.back")}
      </s-link>

      <s-section>
        <Form method="get">
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, (inline-size > 760px) 1fr 1fr 1fr 1fr, 1fr" gap="base" alignItems="end">
                <s-select name="lang" label={t("common.language")} value={f.locale ?? ""}>
                  {data.targets.map((l) => (
                    <s-option key={l.locale} value={l.locale}>
                      {i18n.language(l.locale, l.name)}
                    </s-option>
                  ))}
                </s-select>
                <s-select name="type" label={t("coverage.types.type")} value={f.type ?? "all"}>
                  <s-option value="all">{t("coverage.items.allTypes")}</s-option>
                  {data.coverageTypes.map((type) => (
                    <s-option key={type} value={type}>
                      {kindLabel(i18n, type)}
                    </s-option>
                  ))}
                </s-select>
                <s-select name="group" label={t("coverage.groups.field")} value={f.fieldGroup ?? "all"}>
                  <s-option value="all">{t("coverage.items.allFields")}</s-option>
                  {FIELD_GROUPS.map((g) => (
                    <s-option key={g} value={g}>
                      {t(`coverage.group.${g}`)}
                    </s-option>
                  ))}
                </s-select>
                <s-select name="state" label={t("coverage.items.state")} value={f.state}>
                  <s-option value="incomplete">{t("coverage.items.incomplete")}</s-option>
                  {FIELD_STATES.map((s) => (
                    <s-option key={s} value={s}>
                      {t(`coverage.state.${s}`)}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>
            </s-query-container>
            <s-search-field name="q" label={t("coverage.items.search")} placeholder={t("coverage.items.searchPlaceholder")} value={f.search} />
            {data.searchUnavailable || (f.search && !data.searchable) ? <s-text color="subdued">{t("coverage.items.searchUnsupported")}</s-text> : null}
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="submit">{t("coverage.filter.apply")}</s-button>
              <s-button variant="tertiary" href={f.locale ? `/app/coverage/items?lang=${encodeURIComponent(f.locale)}` : "/app/coverage/items"}>
                {t("coverage.items.clear")}
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      {f.locale ? (
        <s-section heading={t("coverage.items.bulkHeading")}>
          <s-stack direction="block" gap="small">
            {error ? (
              <s-banner tone="critical" heading={t("coverage.startFailed.heading")}>
                <s-paragraph>{errorMessage(i18n, error) ?? t("coverage.startFailed.fallback")}</s-paragraph>
              </s-banner>
            ) : null}
            {!f.type ? (
              <s-paragraph>{t("coverage.items.bulkChooseType")}</s-paragraph>
            ) : data.bulk ? (
              <>
                <s-paragraph>{t("coverage.items.bulkHelp", { type: typeName, language: languageName })}</s-paragraph>
                {!data.canTranslate ? <s-text color="subdued">{t("coverage.items.cantTranslate")}</s-text> : null}
                <s-stack direction="inline" gap="base" alignItems="center">
                  <fixer.Form method="post">
                    <input type="hidden" name="intent" value="translate" />
                    <input type="hidden" name="idempotencyKey" value={`${data.idempotencyKey}-t`} />
                    <input type="hidden" name="locale" value={f.locale} />
                    <input type="hidden" name="resourceType" value={f.type} />
                    {f.fieldGroup ? <input type="hidden" name="fieldGroup" value={f.fieldGroup} /> : null}
                    <s-button type="submit" variant="primary" disabled={!data.canTranslate || !data.jobsAvailable} {...(fixer.state !== "idle" ? { loading: true } : {})}>
                      {f.state === "failed" ? t("coverage.items.retryFailed") : t("coverage.items.translateMissing")}
                    </s-button>
                  </fixer.Form>
                  <s-link href={`/app/review?lang=${encodeURIComponent(f.locale)}${f.type in RESOURCE_KINDS ? `&type=${f.type}` : ""}`}>{t("coverage.items.reviewDrafts")}</s-link>
                  {f.state !== "outdated" ? <s-link href={filterQuery({ state: "outdated", after: null })}>{t("coverage.items.openOutdated")}</s-link> : null}
                </s-stack>
              </>
            ) : (
              <s-paragraph>{t("coverage.items.bulkNotAvailable")}</s-paragraph>
            )}
          </s-stack>
        </s-section>
      ) : null}

      <s-section padding="none">
        {data.items.length ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("coverage.items.item")}</s-table-header>
              {/* The type column only when items of several types are listed. */}
              {f.type ? null : <s-table-header>{t("coverage.items.type")}</s-table-header>}
              <s-table-header>{t("coverage.items.fields")}</s-table-header>
              <s-table-header>{t("coverage.items.checked")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.items.map((item) => {
                const name = item.title ?? t("coverage.items.untitled", { type: kindLabel(i18n, item.resourceType), reference: item.reference });
                return (
                  <s-table-row key={item.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        {item.href ? <s-link href={item.href}>{name}</s-link> : <s-text>{name}</s-text>}
                        {item.lastAttemptFailed ? <s-text color="subdued">{t("coverage.items.lastAttempt")}</s-text> : null}
                      </s-stack>
                    </s-table-cell>
                    {f.type ? null : <s-table-cell>{kindLabel(i18n, item.resourceType)}</s-table-cell>}
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        {fieldSummary(i18n, item.fields).map((field) => (
                          <s-text key={field.text}>
                            <StateDot state={field.state} />
                            {field.text}
                          </s-text>
                        ))}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{i18n.dateTime(item.syncedAt)}</s-text>
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
              {!data.isFirstPage ? <s-button href={filterQuery({ after: null })}>{t("coverage.items.first")}</s-button> : null}
              {data.nextCursor ? <s-button href={filterQuery({ after: data.nextCursor })}>{t("coverage.items.next")}</s-button> : null}
            </s-stack>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
