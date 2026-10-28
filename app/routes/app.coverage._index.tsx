import { useEffect, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { bulkTargetOf, coverageAction, loadCoverageDashboard } from "../.server/coverage/dashboard";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage, kindLabel, kindPlural } from "../i18n/labels";
import { CoverageMeter, durationText, itemsHref, percentLabel, StateBar, StateLegend, StateSummary } from "../components/Coverage";
import { ProgressBar } from "../components/ProgressBar";
import { byFieldGroup, byType, headlineByLocale, storeWide, type Tally } from "../lib/coverage-view";
import { emptyCounts, FIELD_GROUPS, HEADLINE_EXCLUDED_TYPES, type FieldState } from "../lib/coverage-rules";
import { localeFlag } from "../lib/flags";
import { CONTENT_TYPES, isContentType, RESOURCE_KINDS, type ResourceKind } from "../lib/resource-kinds";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const data = await loadCoverageDashboard(request);
  return { ...data, bulkTypes: data.coverageTypes.filter((t) => bulkTargetOf(t) !== null) };
};

export const action = async ({ request }: ActionFunctionArgs) => coverageAction(request);

const isResourceKind = (type: string): type is ResourceKind => Object.hasOwn(RESOURCE_KINDS, type);
const EMPTY: Tally = { counts: emptyCounts(), total: 0, complete: 0, percent: null };

function errorMessage(i18n: I18n, code: string | null | undefined): string | null {
  if (code === "SHOP_AUTH") return i18n.t("common.jobError.SHOP_AUTH");
  const key = `coverage.error.${code ?? ""}`;
  return code && hasMessage(key) ? i18n.t(key) : null;
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

/** What to do first: drafts to review, then failed fields, then the biggest gap that counts. */
function nextStep(data: Data, i18n: I18n): { text: string; href: string; kind: "review" | "failed" | "missing" } | null {
  const shown = data.targets.map((l) => l.locale);
  const name = (locale: string) => i18n.language(locale, data.names[locale]);
  const sum = (locale: string, states: FieldState[]) =>
    data.counts.filter((c) => c.locale === locale && states.includes(c.state)).reduce((n, c) => n + c.count, 0);
  const drafts = shown.map((l) => ({ l, n: sum(l, ["review", "draft"]) })).sort((a, b) => b.n - a.n)[0];
  if (drafts && drafts.n > 0) return { kind: "review", text: i18n.t("coverage.next.review", { count: drafts.n, language: name(drafts.l) }), href: `/app/review?lang=${encodeURIComponent(drafts.l)}` };
  let best: { locale: string; type: string; n: number; state: "failed" | "missing" } | null = null;
  for (const state of ["failed", "missing"] as const) {
    for (const c of data.counts) {
      if (!shown.includes(c.locale) || Object.hasOwn(HEADLINE_EXCLUDED_TYPES, c.resourceType) || c.fieldGroup === "url") continue;
      if (state === "failed" ? c.state !== "failed" : c.state !== "missing" && c.state !== "outdated") continue;
      const n = data.counts
        .filter((x) => x.locale === c.locale && x.resourceType === c.resourceType && x.fieldGroup !== "url" && (state === "failed" ? x.state === "failed" : x.state === "missing" || x.state === "outdated"))
        .reduce((s, x) => s + x.count, 0);
      if (!best || n > best.n) best = { locale: c.locale, type: c.resourceType, n, state };
    }
    if (best) break;
  }
  if (!best) return null;
  const vars = { count: best.n, type: kindLabel(i18n, best.type), language: name(best.locale) };
  return best.state === "failed"
    ? { kind: "failed", text: i18n.t("coverage.next.failed", vars), href: itemsHref({ lang: best.locale, type: best.type, state: "failed" }) }
    : { kind: "missing", text: i18n.t("coverage.next.missing", vars), href: itemsHref({ lang: best.locale, type: best.type }) };
}

export default function Coverage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const runner = useFetcher<typeof action>();
  const fixer = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const scanning = data.report?.status === "QUEUED" || data.report?.status === "RUNNING";
  const live = scanning || data.jobs.length > 0;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  const headline = useMemo(() => headlineByLocale(data.counts), [data.counts]);
  const published = data.targets.filter((l) => l.published).map((l) => l.locale);
  const store = storeWide(data.counts, published);
  const scanned = data.segments.length > 0;
  const selected = data.selected;
  const selectedName = selected ? i18n.language(selected, data.names[selected]) : "";
  const types = useMemo(() => (selected ? byType(data.counts, selected) : new Map<string, Tally>()), [data.counts, selected]);
  const groups = useMemo(() => (selected ? byFieldGroup(data.counts, selected) : new Map<string, Tally>()), [data.counts, selected]);
  const segmentOf = (type: string) => data.segments.find((s) => s.locale === selected && s.resourceType === type);
  const step = scanned ? nextStep(data, i18n) : null;
  const actionError = [runner.data, fixer.data].find((d) => d && "error" in d) as { error: string } | undefined;
  const languageOf = (locale: string) => i18n.language(locale, data.names[locale]);
  const marketQuery = data.markets.selected ? `&market=${encodeURIComponent(data.markets.selected)}` : "";

  // Types with nothing to translate (scanned, no counted field) are folded away.
  const visibleTypes = data.coverageTypes.filter((type) => {
    const seg = segmentOf(type);
    return (types.get(type)?.total ?? 0) > 0 || (seg && seg.status !== "SCANNED") || (!seg && scanned);
  });
  const hiddenTypes = data.coverageTypes.length - visibleTypes.length;

  return (
    <s-page heading={t("coverage.page.heading")}>
      <s-section>
        <s-stack direction="block" gap="base">
          {actionError ? (
            <s-banner tone="critical" heading={t("coverage.startFailed.heading")}>
              <s-paragraph>{errorMessage(i18n, actionError.error) ?? t("coverage.startFailed.fallback")}</s-paragraph>
            </s-banner>
          ) : null}
          {data.report?.status === "FAILED" ? (
            <s-banner tone="warning" heading={t("coverage.lastFailed.heading")}>
              <s-paragraph>{errorMessage(i18n, data.report.errorCode) ?? t("coverage.lastFailed.fallback")}</s-paragraph>
            </s-banner>
          ) : null}
          <runner.Form method="post">
            <input type="hidden" name="intent" value="run" />
            <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small-300">
                <s-text>{t("coverage.intro")}</s-text>
                {data.report && !scanning && data.report.finishedAt ? (
                  <s-text color="subdued">{t("coverage.scan.last", { date: i18n.dateTime(data.report.finishedAt) })}</s-text>
                ) : null}
              </s-stack>
              <s-button
                type="submit"
                variant={scanned ? "secondary" : "primary"}
                disabled={!data.jobsAvailable || scanning || data.targets.length === 0}
                {...(runner.state !== "idle" ? { loading: true } : {})}
              >
                {scanned ? t("coverage.scan.again") : t("coverage.scan.first")}
              </s-button>
            </s-stack>
          </runner.Form>
          {scanning && data.report ? (
            <s-stack direction="block" gap="small-200">
              <ProgressBar value={(data.report.progress.done / Math.max(1, data.report.progress.total)) * 100} label={t("coverage.scan.progressLabel")} />
              <s-text color="subdued">
                {t("coverage.scan.running", {
                  scanning: data.report.scanning ? `${kindLabel(i18n, data.report.scanning.type)} · ${data.report.scanning.language}` : "",
                  done: data.report.progress.done,
                  total: data.report.progress.total,
                  items: data.report.resourcesScanned,
                })}
              </s-text>
            </s-stack>
          ) : null}
          {!scanned && !scanning ? <s-paragraph>{t("coverage.scan.never")}</s-paragraph> : null}
        </s-stack>
      </s-section>

      {data.markets.available && data.markets.list.length > 1 ? (
        <s-section heading={t("coverage.filter.heading")}>
          <Form method="get">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select name="market" label={t("coverage.filter.market")} value={data.markets.selected ?? "all"}>
                <s-option value="all">{t("coverage.filter.allMarkets")}</s-option>
                {data.markets.list.map((m) => (
                  <s-option key={m.id} value={m.id}>
                    {m.name}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit">{t("coverage.filter.apply")}</s-button>
            </s-stack>
          </Form>
          {data.markets.selected ? (
            <s-text color="subdued">{t("coverage.filter.marketNote", { market: data.markets.list.find((m) => m.id === data.markets.selected)?.name ?? "" })}</s-text>
          ) : null}
        </s-section>
      ) : null}

      {data.jobs.length ? (
        <s-section heading={t("coverage.jobs.heading")}>
          <s-stack direction="block" gap="base">
            {data.jobs.map((job) => {
              const vars = { type: kindLabel(i18n, job.resourceType), language: languageOf(job.locale), done: i18n.number(job.done), total: i18n.number(job.total) };
              return (
                <s-stack key={job.id} direction="block" gap="small-200">
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-text>{job.discoveryDone ? t("coverage.jobs.progress", vars) : t("coverage.jobs.finding", vars)}</s-text>
                    <s-link href={`/app/jobs/${job.id}`}>{t("coverage.jobs.open")}</s-link>
                  </s-stack>
                  {job.discoveryDone && job.total > 0 ? (
                    <>
                      <ProgressBar value={job.percent} label={t("coverage.jobs.progressLabel", vars)} tone="success" />
                      <s-text color="subdued">
                        {job.remainingMs !== null ? t("coverage.jobs.eta", { duration: durationText(i18n, job.remainingMs) }) : t("coverage.jobs.noEta")}
                      </s-text>
                    </>
                  ) : null}
                </s-stack>
              );
            })}
          </s-stack>
        </s-section>
      ) : null}

      {scanned ? (
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
            <s-section heading={t("coverage.store.heading")}>
              <s-stack direction="block" gap="small">
                <span style={{ fontSize: 32, lineHeight: "40px", fontWeight: 650, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
                  {percentLabel(i18n, store.complete, store.total)}
                </span>
                <StateBar counts={store.counts} label={t("coverage.store.percentLabel")} i18n={i18n} height={10} />
                <s-text color="subdued">
                  {store.total ? t("coverage.store.fields", { complete: i18n.number(store.complete), total: i18n.number(store.total) }) : t("coverage.store.nothing")}
                </s-text>
                <StateSummary counts={store.counts} i18n={i18n} />
                {published.length === 0 && data.targets.length > 0 ? (
                  <s-banner tone="info">
                    <s-paragraph>{t("coverage.store.noPublished")}</s-paragraph>
                  </s-banner>
                ) : null}
              </s-stack>
            </s-section>
            <s-section heading={t("coverage.next.heading")}>
              <s-stack direction="block" gap="small">
                {step ? (
                  <>
                    <s-paragraph>{step.text}</s-paragraph>
                    <s-stack direction="inline">
                      <s-button href={step.href} variant="primary">
                        {t(`coverage.next.action.${step.kind}`)}
                      </s-button>
                    </s-stack>
                  </>
                ) : (
                  <s-paragraph>{t("coverage.next.done")}</s-paragraph>
                )}
              </s-stack>
            </s-section>
          </s-grid>
        </s-query-container>
      ) : null}

      {scanned && data.targets.length ? (
        <s-section heading={t("coverage.languages.heading")}>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, (inline-size > 900px) 1fr 1fr 1fr, 1fr" gap="base">
              {data.targets.map((l) => {
                const tally = headline.get(l.locale) ?? EMPTY;
                const name = i18n.language(l.locale, l.name);
                const flag = localeFlag(l.locale);
                return (
                  <s-box key={l.locale} padding="base" border="base" borderRadius="base" background={l.locale === selected ? "subdued" : "base"}>
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {flag ? <span aria-hidden="true">{flag}</span> : null}
                        <s-heading>{name}</s-heading>
                        {l.published ? <s-badge tone="success">{t("coverage.languages.published")}</s-badge> : <s-badge tone="warning">{t("coverage.languages.unpublished")}</s-badge>}
                      </s-stack>
                      <span style={{ fontSize: 24, lineHeight: "32px", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{percentLabel(i18n, tally.complete, tally.total)}</span>
                      <StateBar counts={tally.counts} label={t("coverage.languages.progressLabel", { language: name })} i18n={i18n} />
                      <s-text color="subdued">{t("coverage.languages.fields", { complete: i18n.number(tally.complete), total: i18n.number(tally.total) })}</s-text>
                      {!l.published ? <s-text color="subdued">{t("coverage.languages.unpublishedHelp")}</s-text> : null}
                      <StateLegend counts={tally.counts} i18n={i18n} states={["review", "draft", "failed", "outdated", "missing"]} hrefFor={(state) => itemsHref({ lang: l.locale, state })} />
                      {l.locale === selected ? (
                        <s-text color="subdued">{t("coverage.languages.selected")}</s-text>
                      ) : (
                        <s-link href={`/app/coverage?lang=${encodeURIComponent(l.locale)}${marketQuery}`} accessibilityLabel={`${t("coverage.languages.details")}: ${name}`}>
                          {t("coverage.languages.details")}
                        </s-link>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-grid>
          </s-query-container>
        </s-section>
      ) : null}
      {data.markets.selected && data.targets.length === 0 ? (
        <s-section>
          <s-paragraph>{t("coverage.filter.noLanguages")}</s-paragraph>
        </s-section>
      ) : null}

      {scanned && selected ? (
        <s-section heading={t("coverage.types.heading", { language: selectedName })} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("coverage.types.type")}</s-table-header>
              <s-table-header>{t("coverage.types.coverage")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.items.fields")}</s-table-header>
              <s-table-header>{t("coverage.types.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {visibleTypes.map((type, i) => {
                const tally = types.get(type) ?? EMPTY;
                const seg = segmentOf(type);
                const excluded = HEADLINE_EXCLUDED_TYPES[type];
                const gaps = tally.counts.missing + tally.counts.outdated + tally.counts.failed;
                const status = !seg
                  ? t("coverage.types.notScanned")
                  : seg.status === "DENIED"
                    ? t("coverage.types.denied")
                    : seg.status === "FAILED"
                      ? t("coverage.types.failed")
                      : seg.status === "SCANNING"
                        ? t("coverage.types.scanning")
                        : null;
                return (
                  <s-table-row key={type}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-text>{kindLabel(i18n, type)}</s-text>
                        {excluded ? <s-text color="subdued">{t("coverage.types.excluded")}</s-text> : null}
                        {status ? <s-text color="subdued">{status}</s-text> : null}
                        {seg?.status === "DENIED" && isContentType(type) ? <s-link href={`/app/content/${CONTENT_TYPES[type].slug}`}>{t("coverage.types.allowAccess")}</s-link> : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {tally.total ? (
                        <CoverageMeter counts={tally.counts} complete={tally.complete} total={tally.total} label={kindLabel(i18n, type)} i18n={i18n} />
                      ) : (
                        <s-text color="subdued">{seg?.status === "SCANNED" ? t("coverage.types.empty") : "—"}</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>{tally.total ? t("coverage.types.fields", { complete: i18n.number(tally.complete), total: i18n.number(tally.total) }) : "—"}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {tally.total > tally.complete ? <s-link href={itemsHref({ lang: selected, type })}>{t("coverage.types.showItems")}</s-link> : null}
                        {gaps > 0 && data.bulkTypes.includes(type) ? (
                          <fixer.Form method="post">
                            <input type="hidden" name="intent" value="translate" />
                            <input type="hidden" name="idempotencyKey" value={`${data.idempotencyKey}-${i}`} />
                            <input type="hidden" name="locale" value={selected} />
                            <input type="hidden" name="resourceType" value={type} />
                            <s-button
                              type="submit"
                              variant="secondary"
                              disabled={!data.canTranslate || !data.jobsAvailable}
                              accessibilityLabel={`${t("coverage.types.translate")}: ${kindLabel(i18n, type)}, ${selectedName}`}
                            >
                              {t("coverage.types.translate")}
                            </s-button>
                          </fixer.Form>
                        ) : null}
                        {tally.counts.review + tally.counts.draft > 0 ? (
                          <s-link href={`/app/review?lang=${encodeURIComponent(selected)}${isResourceKind(type) ? `&type=${type}` : ""}`}>{t("coverage.types.reviewDrafts")}</s-link>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-stack direction="block" gap="small-200">
              {hiddenTypes > 0 ? <s-text color="subdued">{t("coverage.types.hideEmpty", { count: hiddenTypes })}</s-text> : null}
              {visibleTypes.some((type) => HEADLINE_EXCLUDED_TYPES[type] === "theme") ? <s-text color="subdued">{t("coverage.types.excludedHelp.theme")}</s-text> : null}
              {visibleTypes.some((type) => HEADLINE_EXCLUDED_TYPES[type] === "notifications") ? (
                <s-text color="subdued">{t("coverage.types.excludedHelp.notifications")}</s-text>
              ) : null}
            </s-stack>
          </s-box>
        </s-section>
      ) : null}

      {scanned && selected && groups.size ? (
        <s-section heading={t("coverage.groups.heading", { language: selectedName })} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("coverage.groups.field")}</s-table-header>
              <s-table-header>{t("coverage.types.coverage")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.items.fields")}</s-table-header>
              <s-table-header>{t("coverage.types.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {FIELD_GROUPS.filter((g) => (groups.get(g)?.total ?? 0) > 0).map((g) => {
                const tally = groups.get(g)!;
                return (
                  <s-table-row key={g}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-text>{t(`coverage.group.${g}`)}</s-text>
                        {g === "url" ? <s-text color="subdued">{t("coverage.types.excluded")}</s-text> : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <CoverageMeter counts={tally.counts} complete={tally.complete} total={tally.total} label={t(`coverage.group.${g}`)} i18n={i18n} />
                    </s-table-cell>
                    <s-table-cell>{t("coverage.types.fields", { complete: i18n.number(tally.complete), total: i18n.number(tally.total) })}</s-table-cell>
                    <s-table-cell>
                      {tally.total > tally.complete ? <s-link href={itemsHref({ lang: selected, group: g })}>{t("coverage.types.showItems")}</s-link> : null}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {groups.has("url") ? (
            <s-box padding="base">
              <s-text color="subdued">{t("coverage.groups.urlNote")}</s-text>
            </s-box>
          ) : null}
        </s-section>
      ) : null}

      {scanned ? (
        <s-section heading={t("coverage.seo.heading")}>
          <s-stack direction="block" gap="small">
            {(() => {
              const shown = new Set(data.targets.map((l) => l.locale));
              const lines = [
                ...data.seo.missingSourceTitle
                  .filter((m) => shown.has(m.locale) && m.locale === selected)
                  .map((m) =>
                    t("coverage.seo.noSourceTitle", {
                      language: languageOf(m.locale),
                      count: m.count,
                      kind: isResourceKind(m.resourceType) ? kindPlural(i18n, m.resourceType) : t("coverage.seo.items"),
                    }),
                  ),
                ...Object.entries(data.seo.duplicateTitles)
                  .filter(([locale, count]) => shown.has(locale) && count > 0)
                  .map(([locale, count]) => t("coverage.seo.duplicates", { language: languageOf(locale), count })),
                ...[...new Set(data.seo.issues.filter((s) => shown.has(s.locale)).map((s) => s.locale))].map((locale) =>
                  t("coverage.seo.toCheck", {
                    language: languageOf(locale),
                    count: data.seo.issues.filter((s) => s.locale === locale).reduce((n, s) => n + s.count, 0),
                  }),
                ),
              ];
              return lines.length ? lines.map((line) => <s-paragraph key={line}>{line}</s-paragraph>) : <s-paragraph>{t("coverage.seo.none")}</s-paragraph>;
            })()}
          </s-stack>
        </s-section>
      ) : null}

      <s-section>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 24 }}>{t("coverage.rules.heading")}</summary>
          <s-box paddingBlockStart="small">
            <s-unordered-list>
              <s-list-item>{t("coverage.scan.live")}</s-list-item>
              <s-list-item>{t("coverage.rules.fields")}</s-list-item>
              <s-list-item>{t("coverage.rules.complete")}</s-list-item>
              <s-list-item>{t("coverage.rules.percent")}</s-list-item>
              <s-list-item>{t("coverage.rules.excluded")}</s-list-item>
              <s-list-item>{t("coverage.rules.store")}</s-list-item>
            </s-unordered-list>
          </s-box>
        </details>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
