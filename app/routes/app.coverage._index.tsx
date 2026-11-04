import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { bulkTargetOf, coverageAction, loadCoverageDashboard } from "../.server/coverage/dashboard";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage, kindPlural } from "../i18n/labels";
import { Card } from "../components/Card";
import { CoverageMeter, durationText, itemsHref, percentLabel, StateBar } from "../components/Coverage";
import { CoverageConfirm, type CoverageConfirmTarget } from "../components/CoverageConfirm";
import { FieldStateLinks, FieldStateList } from "../components/CoverageStates";
import { Disclosure } from "../components/Disclosure";
import { Flag } from "../components/Flag";
import { ProgressBar } from "../components/ProgressBar";
import { SmartStateBadge, SmartStateBanner } from "../components/SmartAutoCard";
import { ToolHeader, ToolsBreadcrumbSlot } from "../components/ToolHeader";
import { Strong } from "../components/Type";
import { bulkTypes, openTexts, type BulkTarget } from "../lib/coverage-bulk";
import { byFieldGroup, byTypeCounted, coverageNextStep, headlineByLocale, storeWide, unreadableTypes, urlsByType, type CoverageNextStep, type Tally } from "../lib/coverage-view";
import { contentTypeName } from "../lib/content-type-names";
import { chipName, chipOrder, switcherKind } from "../lib/content-language";
import { inParentheses, languageList, upperFirst } from "../lib/name-lists";
import { languagePath } from "../lib/language-categories";
import { emptyCounts, FIELD_GROUPS, HEADLINE_EXCLUDED_TYPES } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import { CONTENT_TYPES, isContentType, RESOURCE_KINDS, type ResourceKind } from "../lib/resource-kinds";
import { ALL } from "../lib/select-all";
import { Button } from "../components/Button";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const data = await loadCoverageDashboard(request);
  // The job each row's "Translate" starts (none: the type is translated item by item).
  const bulkTargets: Record<string, BulkTarget> = {};
  for (const type of data.coverageTypes) {
    const target = bulkTargetOf(type);
    if (target) bulkTargets[type] = target;
  }
  return { ...data, bulkTargets };
};

export const action = async ({ request }: ActionFunctionArgs) => coverageAction(request);

const isResourceKind = (type: string): type is ResourceKind => Object.hasOwn(RESOURCE_KINDS, type);
const EMPTY: Tally = { counts: emptyCounts(), total: 0, complete: 0, percent: null };
/** Plan gates of the actions: their message has the way to the plans beside it. */
const PLAN_ERRORS = new Set(["PLAN_BULK", "PLAN_LANGUAGE"]);
const CONFIRM_ID = "coverage-translate";

function errorMessage(i18n: I18n, code: string | null | undefined): string | null {
  if (code === "SHOP_AUTH") return i18n.t("common.jobError.SHOP_AUTH");
  const key = `coverage.error.${code ?? ""}`;
  return code && hasMessage(key) ? i18n.t(key) : null;
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Step = CoverageNextStep<Data["segments"][number]>;

/** Where the merchant allows access to the first of these types (its content page asks for the scope). */
function accessHref(types: readonly string[]): string | null {
  const type = types.find(isContentType);
  return type ? `/app/content/${CONTENT_TYPES[type].slug}` : null;
}

/** The next step in words, and its action (none: counting again is the page's own button, or there's nothing to do). */
function stepView(step: Step, data: Data, i18n: I18n): { text: string; action: { href: string; label: string } | null } {
  const { t } = i18n;
  const name = (locale: string) => i18n.language(locale, data.names[locale]);
  switch (step.kind) {
    case "review":
      return {
        text: t("coverage.next.review", { count: step.count, language: name(step.locale) }),
        action: { href: `/app/review?lang=${encodeURIComponent(step.locale)}`, label: t("coverage.next.action.review") },
      };
    case "failed":
    case "missing": {
      // Said as the state of the type's texts, not as an order: its button opens them ("Show what's missing").
      const vars = { count: step.count, type: contentTypeName(i18n, step.type), language: name(step.locale) };
      return step.kind === "failed"
        ? { text: t("coverage.next.failed", vars), action: { href: itemsHref({ lang: step.locale, type: step.type, state: "failed" }), label: t("coverage.next.action.failed") } }
        : { text: t("coverage.next.missing", vars), action: { href: itemsHref({ lang: step.locale, type: step.type }), label: t("coverage.next.action.missing") } };
    }
    case "unread":
      return { text: t(step.message, { type: contentTypeName(i18n, step.segment.resourceType), language: inParentheses(name(step.segment.locale)) }), action: null };
    case "unmeasured":
      return { text: t(step.message, { language: name(step.locale) }), action: null };
    case "denied": {
      const href = accessHref(step.types);
      const types = inParentheses(languageList(i18n, step.types.map((type) => contentTypeName(i18n, type))));
      return { text: t("coverage.next.denied", { count: step.types.length, types }), action: href ? { href, label: t("coverage.next.action.denied") } : null };
    }
    case "scanning":
      return { text: t("coverage.next.scanning"), action: null };
  }
}

/**
 * The languages as the Content page's chips: flag, name and figure, visible languages first, the shown
 * one in the chosen look; more than six: one select that opens the chosen language at once.
 */
function LanguageChips({ data, i18n, measured, headline, hrefFor }: { data: Data; i18n: I18n; measured: ReadonlySet<string>; headline: Map<string, Tally>; hrefFor: (locale: string) => string }) {
  const { t } = i18n;
  const navigate = useNavigate();
  const ordered = chipOrder(i18n, data.targets);
  const figure = (locale: string) => {
    const tally = headline.get(locale) ?? EMPTY;
    return measured.has(locale) ? percentLabel(i18n, tally.complete, tally.total) : "—";
  };
  const label = (l: Data["targets"][number]) => {
    const name = chipName(i18n, l);
    const shown = l.published ? name : t("resources.hiddenLanguage", { language: name });
    const tally = headline.get(l.locale) ?? EMPTY;
    return measured.has(l.locale) ? t("content.language.chip", { language: shown, percent: percentLabel(i18n, tally.complete, tally.total) }) : t("content.language.chipNotCounted", { language: shown });
  };
  if (switcherKind(ordered.length) === "select") {
    return (
      <s-select label={t("content.language.label")} value={data.selected ?? ""} onInput={(e) => void navigate(hrefFor(e.currentTarget.value))}>
        {ordered.map((l) => (
          <s-option key={l.locale} value={l.locale}>
            {label(l)}
          </s-option>
        ))}
      </s-select>
    );
  }
  return (
    <nav aria-label={t("content.language.label")}>
      <ul className="lv-langs">
        {ordered.map((l) => {
          const current = l.locale === data.selected;
          const body = (
            <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
              <Flag country={localeCountry(l.locale, data.marketCountries)} fallback={l.locale} size={20} />
              <s-stack direction="block">
                <span>{current ? <Strong>{chipName(i18n, l)}</Strong> : <s-text>{chipName(i18n, l)}</s-text>}</span>
                {l.published ? null : (
                  <s-stack direction="inline" gap="small-400" alignItems="center">
                    <s-icon type="hide" size="small" color="subdued" />
                    <s-text color="subdued">{t("content.language.hidden")}</s-text>
                  </s-stack>
                )}
              </s-stack>
              <span className={current ? "lv-figure-row" : undefined}>{current ? figure(l.locale) : <s-text color="subdued">{figure(l.locale)}</s-text>}</span>
            </s-grid>
          );
          return (
            <li key={l.locale} className="lv-langs__item">
              {current ? (
                <span className="lv-lang" aria-current="page">
                  {body}
                </span>
              ) : (
                // The link's own text is its name for screen readers; the words inside are hidden from them (nothing read twice).
                <Link className="lv-lang" to={hrefFor(l.locale)}>
                  <span className="lv-sr">{label(l)}</span>
                  <span aria-hidden="true">{body}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Coverage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const runner = useFetcher<typeof action>();
  const fixer = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ type: string; index: number; view: CoverageConfirmTarget } | null>(null);
  // A measurement that stopped moving can be started again; nothing to follow then.
  const scanning = (data.report?.status === "QUEUED" || data.report?.status === "RUNNING") && !data.report.stalled;
  const live = scanning || data.jobs.length > 0;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  const headline = useMemo(() => headlineByLocale(data.counts), [data.counts]);
  const measured = useMemo(() => new Set(data.measured), [data.measured]);
  const published = data.targets.filter((l) => l.published).map((l) => l.locale);
  // As on the Overview: only published languages read in full make up the figure.
  const counted = published.filter((l) => measured.has(l));
  const store = storeWide(data.counts, counted);
  const scanned = data.segments.length > 0;
  const selected = data.selected;
  const selectedTarget = data.targets.find((l) => l.locale === selected) ?? null;
  const selectedName = selected ? i18n.language(selected, data.names[selected]) : "";
  // A type's row counts what the figures count (no web addresses: they are optional and have a row of their
  // own below), so it says what its next step, its Translate and the Content page say.
  const types = useMemo(() => (selected ? byTypeCounted(data.counts, selected) : new Map<string, Tally>()), [data.counts, selected]);
  const urls = useMemo(() => (selected ? urlsByType(data.counts, selected) : new Map<string, Tally>()), [data.counts, selected]);
  const groups = useMemo(() => (selected ? byFieldGroup(data.counts, selected) : new Map<string, Tally>()), [data.counts, selected]);
  const segmentOf = (type: string) => data.segments.find((s) => s.locale === selected && s.resourceType === type);
  // Types the figures count that Linguva can't read: named beside the figure, never "all done".
  const unreadable = unreadableTypes(data.segments, { locales: data.targets.map((l) => l.locale), types: data.coverageTypes });
  const next = scanned
    ? coverageNextStep({
        counts: data.counts,
        segments: data.segments,
        targets: data.targets,
        measured,
        types: data.coverageTypes,
        selected,
        scan: { scanning, locales: scanning ? (data.report?.locales ?? []) : [] },
      })
    : null;
  const step = next ? stepView(next, data, i18n) : null;
  const actionError = ([runner.data, fixer.data].find((d) => d && "error" in d) as { error: string } | undefined)?.error ?? null;
  const languageOf = (locale: string) => i18n.language(locale, data.names[locale]);
  const marketQuery = data.markets.selected ? `&market=${encodeURIComponent(data.markets.selected)}` : "";
  const languageHref = (locale: string) => `/app/coverage?lang=${encodeURIComponent(locale)}${marketQuery}`;
  const title = t("settings.tools.coverage.label");

  // Types with nothing to translate (counted, no text) are folded away.
  const visibleTypes = data.coverageTypes.filter((type) => {
    const seg = segmentOf(type);
    return (types.get(type)?.total ?? 0) > 0 || (seg && seg.status !== "SCANNED") || (!seg && scanned);
  });
  const hiddenTypes = data.coverageTypes.length - visibleTypes.length;
  const selectedTally = selected ? (headline.get(selected) ?? EMPTY) : EMPTY;

  /** What a row's "Translate" asks before its job starts. */
  const confirmFor = (type: string): CoverageConfirmTarget | null => {
    const target = data.bulkTargets[type];
    if (!target || !selected) return null;
    return { resourceType: target.resourceType, name: contentTypeName(i18n, target.resourceType), includeAttached: target.includeAttached, open: openTexts(data.counts, selected, bulkTypes(target)) };
  };

  // Counting: the same form and button wherever they are shown.
  const stalled = Boolean(data.report?.stalled);
  const countOnTop = !scanned || scanning || stalled || data.report?.status === "FAILED";
  const countForm = (children: ReactNode) => (
    <runner.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      {children}
    </runner.Form>
  );
  const countButton = (
    <Button
      type="submit"
      variant={scanned ? "secondary" : "primary"}
      icon="chart-donut"
      disabled={!data.jobsAvailable || scanning || data.targets.length === 0}
      {...(runner.state !== "idle" ? { loading: true } : {})}
    >
      {scanned ? t("coverage.scan.again") : t("coverage.scan.first")}
    </Button>
  );
  const lastCounted = data.lastFullScan ? t("coverage.scan.last", { date: i18n.dateTime(data.lastFullScan) }) : null;
  // The card's first line names what needs the merchant; when the figures are from, quietly under it.
  const countState = scanning
    ? t("coverage.scan.counting")
    : stalled && data.report
      ? t("coverage.scan.stalled", { date: i18n.dateTime(data.report.updatedAt) })
      : !scanned
        ? t("coverage.scan.notYet")
        : null;
  const countDetail = lastCounted ?? (!scanned && !scanning ? t("coverage.scan.never") : null);

  return (
    <s-page heading={title}>
      <ToolsBreadcrumbSlot i18n={i18n} />
      <s-stack direction="block" gap="base">
        <ToolHeader tool="coverage" title={title} lead={t("coverage.intro")} i18n={i18n} />

        {actionError ? (
          <s-banner tone="critical" heading={t("coverage.startFailed.heading")}>
            <s-paragraph>
              {errorMessage(i18n, actionError) ?? t("coverage.startFailed.fallback")}
              {PLAN_ERRORS.has(actionError) ? (
                <>
                  {" "}
                  <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                </>
              ) : null}
            </s-paragraph>
          </s-banner>
        ) : null}
        {data.report?.status === "FAILED" ? (
          <s-banner tone="warning" heading={t("coverage.lastFailed.heading")}>
            <s-paragraph>{errorMessage(i18n, data.report.errorCode) ?? t("coverage.lastFailed.fallback")}</s-paragraph>
          </s-banner>
        ) : null}

        {/* Counting has a card of its own while it needs the merchant (never counted, counting, stuck, failed);
            once counted, its date and button sit at the foot of "Whole store", as on the Overview. */}
        {countOnTop ? (
          <Card>
            <s-stack direction="block" gap="base">
              {countForm(
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="base" alignItems="center">
                    <s-stack direction="block" gap="small-500">
                      {countState ? <Strong>{countState}</Strong> : null}
                      {countDetail ? <s-text color="subdued">{countDetail}</s-text> : null}
                    </s-stack>
                    <s-stack direction="inline">{countButton}</s-stack>
                  </s-grid>
                </s-query-container>,
              )}
              {scanning && data.report ? (
                <s-stack direction="block" gap="small-200">
                  <ProgressBar value={(data.report.progress.done / Math.max(1, data.report.progress.total)) * 100} label={t("coverage.scan.progressLabel")} />
                  <s-text color="subdued">
                    {t("coverage.scan.running", {
                      scanning: data.report.scanning ? `${contentTypeName(i18n, data.report.scanning.type)} · ${data.report.scanning.language}` : "",
                      done: data.report.progress.done,
                      total: data.report.progress.total,
                      items: data.report.resourcesScanned,
                    })}
                  </s-text>
                </s-stack>
              ) : null}
            </s-stack>
          </Card>
        ) : null}

        {data.markets.available && data.markets.list.length > 1 ? (
          <Card>
            <s-stack direction="block" gap="small-200">
              {/* Opens the market's languages at once: no extra button. */}
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 560px) 320px 1fr, 1fr" gap="base">
                  <s-select
                    label={t("coverage.filter.market")}
                    value={data.markets.selected ?? ALL}
                    onInput={(e) => {
                      const market = e.currentTarget.value;
                      void navigate(market && market !== ALL ? `/app/coverage?market=${encodeURIComponent(market)}` : "/app/coverage");
                    }}
                  >
                    <s-option value={ALL}>{t("coverage.filter.allMarkets")}</s-option>
                    {data.markets.list.map((m) => (
                      <s-option key={m.id} value={m.id}>
                        {m.name}
                      </s-option>
                    ))}
                  </s-select>
                </s-grid>
              </s-query-container>
              {data.markets.selected ? (
                <s-text color="subdued">{t("coverage.filter.marketNote", { market: data.markets.list.find((m) => m.id === data.markets.selected)?.name ?? "" })}</s-text>
              ) : null}
            </s-stack>
          </Card>
        ) : null}

        {data.jobs.length ? (
          <Card heading={t("coverage.jobs.heading")}>
            <s-stack direction="block" gap="base">
              {data.jobs.map((job) => {
                const vars = { type: contentTypeName(i18n, job.resourceType), language: languageOf(job.locale), done: i18n.number(job.done), total: i18n.number(job.total) };
                return (
                  <s-stack key={job.id} direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon type="in-progress" color="subdued" size="small" />
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
          </Card>
        ) : null}

        {data.smart ? (
          <Card heading={t("automatic.name")}>
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <SmartStateBadge status={data.smart.status} />
                <s-text>
                  {[
                    !data.smart.inSchedule
                      ? t("coverage.smart.notThisLanguage")
                      : data.smart.status.state !== "on"
                        ? null
                        : data.smart.nextCheck
                          ? t("coverage.smart.next", { time: t("automatic.schedule.zone", { time: i18n.dateTimeIn(data.smart.nextCheck, data.smart.zone), zone: data.smart.zone }) })
                          : data.smart.mode === "manual"
                            ? t("coverage.smart.manual")
                            : null,
                    data.smart.inSchedule && data.smart.mode === "realtime" && data.smart.status.state === "on" ? t("coverage.smart.realtime") : null,
                    data.smart.translating ? t("coverage.smart.translating", { count: data.smart.translating }) : null,
                    data.smart.excluded ? t("coverage.smart.excluded", { count: data.smart.excluded }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </s-text>
                <s-link href="/app/settings/automatic">{t("automatic.action.options")}</s-link>
              </s-stack>
              <SmartStateBanner status={data.smart.status} zone={data.smart.zone} />
            </s-stack>
          </Card>
        ) : null}

        {scanned ? (
          <s-query-container>
            {/* Next first: on the left on a wide page, on top on a phone, as on the Overview. */}
            <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base" alignItems="stretch">
              <Card heading={t("coverage.next.heading")} fill>
                <s-stack direction="block" gap="small">
                  {step ? (
                    <>
                      <s-paragraph>{step.text}</s-paragraph>
                      {/* Counting again is the page's own button. */}
                      {step.action ? (
                        <s-stack direction="inline">
                          <Button href={step.action.href} variant="primary">
                            {step.action.label}
                          </Button>
                        </s-stack>
                      ) : null}
                    </>
                  ) : (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon type="check-circle-filled" tone="success" size="small" />
                      <s-text>{t("coverage.next.done")}</s-text>
                    </s-stack>
                  )}
                </s-stack>
              </Card>
              <Card heading={t("coverage.store.heading")} fill>
                <s-stack direction="block" gap="small">
                  <span className="lv-figure">{percentLabel(i18n, store.complete, store.total)}</span>
                  {/* No bar before a language is read in full: an empty one would read "nothing to translate". */}
                  {published.length > 0 && counted.length === 0 ? null : (
                    <StateBar counts={store.counts} label={t("coverage.store.percentLabel")} i18n={i18n} height={10} />
                  )}
                  <s-text color="subdued">
                    {published.length > 0 && counted.length === 0
                      ? t("coverage.store.notMeasured")
                      : !store.total
                        ? t("coverage.store.nothing")
                        : counted.length < published.length
                          ? t("coverage.store.fieldsSome", { complete: i18n.number(store.complete), total: i18n.number(store.total), count: counted.length, published: published.length })
                          : t("coverage.store.fields", { complete: i18n.number(store.complete), total: i18n.number(store.total) })}
                  </s-text>
                  <FieldStateList counts={store.counts} i18n={i18n} />
                  {unreadable.length ? (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon type="lock" color="subdued" size="small" />
                      <s-text color="subdued">{t("coverage.store.denied", { count: unreadable.length })}</s-text>
                      {accessHref(unreadable) ? <s-link href={accessHref(unreadable)!}>{t("coverage.types.allowAccess")}</s-link> : null}
                    </s-stack>
                  ) : null}
                  {published.length === 0 && data.targets.length > 0 ? (
                    <s-banner tone="info">
                      <s-paragraph>{t("coverage.store.noPublished")}</s-paragraph>
                    </s-banner>
                  ) : null}
                  {countOnTop ? null : (
                    // When the figures are from, quiet, beside the way to count again.
                    <s-stack direction="block" gap="base">
                      <s-divider />
                      {countForm(
                        <s-query-container>
                          <s-grid gridTemplateColumns="@container (inline-size > 520px) 1fr auto, 1fr" gap="small-200 base" alignItems="center" justifyItems="start">
                            {lastCounted ? <s-text color="subdued">{lastCounted}</s-text> : null}
                            <s-stack direction="inline">{countButton}</s-stack>
                          </s-grid>
                        </s-query-container>,
                      )}
                    </s-stack>
                  )}
                </s-stack>
              </Card>
            </s-grid>
          </s-query-container>
        ) : null}

        {/* One language at a time, as on the Content page: its chip, then its figure and states (each opening its texts). */}
        {scanned && data.targets.length && selectedTarget ? (
          <Card heading={t("coverage.languages.heading")}>
            <s-stack direction="block" gap="base">
              <LanguageChips data={data} i18n={i18n} measured={measured} headline={headline} hrefFor={languageHref} />
              <s-box padding="base" border="base" borderRadius="large-100">
                <s-stack direction="block" gap="small">
                  {/* The chip above shows the language, whether it's hidden and its figure: the box names it for
                      screen readers only. A select (more than six languages) is less plain, so there it stays. */}
                  {switcherKind(data.targets.length) === "select" ? (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <Flag country={localeCountry(selectedTarget.locale, data.marketCountries)} fallback={selectedTarget.locale} size={20} />
                      <h3 className="lv-h3">{upperFirst(selectedName)}</h3>
                      {selectedTarget.published ? (
                        <s-badge tone="success">{t("coverage.languages.published")}</s-badge>
                      ) : (
                        <s-badge tone="warning" icon="hide">
                          {t("coverage.languages.unpublished")}
                        </s-badge>
                      )}
                    </s-stack>
                  ) : (
                    <h3 className="lv-sr">{upperFirst(selectedName)}</h3>
                  )}
                  {measured.has(selectedTarget.locale) ? (
                    <>
                      <StateBar counts={selectedTally.counts} label={t("coverage.languages.progressLabel", { language: selectedName })} i18n={i18n} />
                      <s-text color="subdued">{t("coverage.languages.fields", { complete: i18n.number(selectedTally.complete), total: i18n.number(selectedTally.total) })}</s-text>
                    </>
                  ) : (
                    // A share of what was read so far could read as 100 %: no figure until every type is read.
                    <s-text color="subdued">{t("coverage.languages.notMeasured")}</s-text>
                  )}
                  {!selectedTarget.published ? <s-text color="subdued">{t("coverage.languages.unpublishedHelp")}</s-text> : null}
                  <FieldStateLinks counts={selectedTally.counts} i18n={i18n} states={["review", "draft", "failed", "outdated", "missing"]} hrefFor={(state) => itemsHref({ lang: selectedTarget.locale, state })} />
                  <span>
                    <s-link href={languagePath(selectedTarget.locale)}>{t("content.language.next", { language: selectedName })}</s-link>
                  </span>
                </s-stack>
              </s-box>
            </s-stack>
          </Card>
        ) : null}
        {data.markets.selected && data.targets.length === 0 ? (
          <Card>
            <s-paragraph>{t("coverage.filter.noLanguages")}</s-paragraph>
          </Card>
        ) : null}

        {scanned && selected ? (
          <Card heading={t("coverage.types.heading", { language: selectedName })} padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("coverage.types.type")}</s-table-header>
                <s-table-header>{t("coverage.types.coverage")}</s-table-header>
                <s-table-header format="numeric">{t("coverage.items.fields")}</s-table-header>
                <s-table-header>{t("coverage.types.actions")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {visibleTypes.map((type) => {
                  const tally = types.get(type) ?? EMPTY;
                  const seg = segmentOf(type);
                  const excluded = HEADLINE_EXCLUDED_TYPES[type];
                  const gaps = tally.counts.missing + tally.counts.outdated + tally.counts.failed;
                  const name = contentTypeName(i18n, type);
                  const status = !seg
                    ? t("coverage.types.notScanned")
                    : seg.status === "DENIED"
                      ? t("coverage.types.denied")
                      : seg.status === "FAILED" || (seg.status === "SCANNING" && !scanning)
                        ? t("coverage.types.failed")
                        : seg.status === "SCANNING"
                          ? t("coverage.types.scanning")
                          : null;
                  const confirm = gaps > 0 ? confirmFor(type) : null;
                  const addresses = urls.get(type)?.total ?? 0;
                  return (
                    <s-table-row key={type}>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-300">
                          <s-text>{name}</s-text>
                          {excluded ? <s-text color="subdued">{t("coverage.types.excluded")}</s-text> : null}
                          {/* Counted on their own row below, so the row's figure is the one the totals use. */}
                          {addresses ? <s-text color="subdued">{t("coverage.types.urls", { count: addresses })}</s-text> : null}
                          {status ? <s-text color="subdued">{status}</s-text> : null}
                          {seg?.status === "DENIED" && isContentType(type) ? <s-link href={`/app/content/${CONTENT_TYPES[type].slug}`}>{t("coverage.types.allowAccess")}</s-link> : null}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {tally.total ? (
                          <CoverageMeter counts={tally.counts} complete={tally.complete} total={tally.total} label={name} i18n={i18n} />
                        ) : (
                          <s-text color="subdued">{seg?.status === "SCANNED" ? t("coverage.types.empty") : "—"}</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>{tally.total ? t("coverage.types.fields", { complete: i18n.number(tally.complete), total: i18n.number(tally.total) }) : "—"}</s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small" alignItems="center">
                          {tally.total > tally.complete ? <s-link href={itemsHref({ lang: selected, type })}>{t("coverage.types.showItems")}</s-link> : null}
                          {confirm ? (
                            // Asks first, as everywhere bulk translation starts (what, approval or live, AI characters).
                            <Button
                              variant="tertiary"
                              icon="wand"
                              disabled={!data.canTranslate || !data.jobsAvailable}
                              commandFor={CONFIRM_ID}
                              command="--show"
                              accessibilityLabel={`${t("coverage.types.translate")}: ${name}, ${selectedName}`}
                              onClick={() => setPending({ type, index: data.coverageTypes.indexOf(type), view: confirm })}
                            >
                              {t("coverage.types.translate")}
                            </Button>
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
                {/* Why the AI buttons are off, with the way to the fix: a key on the Own key plan, else the AI permission. */}
                {!data.canTranslate ? (
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text color="subdued">{t(data.ownKeyMissing ? "coverage.items.noKey" : "coverage.items.cantTranslate")}</s-text>
                    <s-link href={data.ownKeyMissing ? "/app/settings?section=keys" : "/app/settings?section=ai"}>{t(data.ownKeyMissing ? "language.unlock.keyMissing.action" : "language.unlock.consent.action")}</s-link>
                  </s-stack>
                ) : null}
                {hiddenTypes > 0 ? <s-text color="subdued">{t("coverage.types.hideEmpty", { count: hiddenTypes })}</s-text> : null}
                {visibleTypes.some((type) => HEADLINE_EXCLUDED_TYPES[type] === "theme") ? <s-text color="subdued">{t("coverage.types.excludedHelp.theme")}</s-text> : null}
                {visibleTypes.some((type) => HEADLINE_EXCLUDED_TYPES[type] === "notifications") ? (
                  <s-text color="subdued">{t("coverage.types.excludedHelp.notifications")}</s-text>
                ) : null}
              </s-stack>
            </s-box>
          </Card>
        ) : null}

        {/* Field groups add up every type: only for a language read in full. */}
        {scanned && selected && measured.has(selected) && groups.size ? (
          <Card heading={t("coverage.groups.heading", { language: selectedName })} padding="none">
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
          </Card>
        ) : null}

        {scanned ? (
          <Card heading={t("coverage.seo.heading")}>
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
                return lines.length ? (
                  lines.map((line) => (
                    <s-grid key={line} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                      <s-icon type="alert-triangle" tone="caution" size="small" />
                      <s-text>{line}</s-text>
                    </s-grid>
                  ))
                ) : (
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="check-circle-filled" tone="success" size="small" />
                    <s-text>{t("coverage.seo.none")}</s-text>
                  </s-stack>
                );
              })()}
            </s-stack>
          </Card>
        ) : null}

        <Card>
          <Disclosure summary={t("coverage.rules.heading")}>
            <s-unordered-list>
              <s-list-item>{t("coverage.scan.live")}</s-list-item>
              <s-list-item>{t("coverage.rules.fields")}</s-list-item>
              <s-list-item>{t("coverage.rules.complete")}</s-list-item>
              <s-list-item>{t("coverage.rules.percent")}</s-list-item>
              <s-list-item>{t("coverage.rules.excluded")}</s-list-item>
              <s-list-item>{t("coverage.rules.store")}</s-list-item>
            </s-unordered-list>
          </Disclosure>
        </Card>
      </s-stack>
      <CoverageConfirm
        id={CONFIRM_ID}
        target={pending?.view ?? null}
        languageName={selectedName}
        publishMode={data.bulk.publishMode}
        aiRemaining={data.bulk.aiRemaining}
        i18n={i18n}
        onConfirm={() =>
          pending &&
          selected &&
          fixer.submit(
            { intent: "translate", idempotencyKey: `${data.idempotencyKey}-${pending.index}`, locale: selected, resourceType: pending.type },
            { method: "post" },
          )
        }
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
