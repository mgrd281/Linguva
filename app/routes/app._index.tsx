import { randomUUID } from "node:crypto";
import { Fragment, useEffect, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadOverview } from "../.server/overview/overview";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import { getTranslationProvider } from "../.server/providers";
import { getQueues } from "../.server/queue/client";
import { ProgressBar } from "../components/ProgressBar";
import { itemsHref, percentLabel, StateBar, TRACK_COLOUR } from "../components/Coverage";
import { CountryStatusBar } from "../components/CountryStatus";
import { countryFlag, localeFlag } from "../lib/flags";
import type { CountryCoverage, MissingReason } from "../lib/country-coverage";
import type { I18n, MessageKey } from "../i18n/i18n";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const overview = await loadOverview(admin, shop, undefined, {
    aiAvailable: getTranslationProvider() !== null,
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
  });
  return { ...overview, idempotencyKey: randomUUID(), jobsAvailable: getQueues() !== null };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

/** One headline figure: label, the number large, an optional meter, and what it means. */
function Figure({ label, value, meter, children }: { label: string; value: string; meter?: ReactNode; children?: ReactNode }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <span style={{ fontSize: 28, fontWeight: 650, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{value}</span>
        {meter}
        {children}
      </s-stack>
    </s-box>
  );
}

function Flag({ value }: { value: string }) {
  return value ? (
    <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>
      {value}
    </span>
  ) : null;
}

/** What the merchant does in Shopify for each reason a language is missing. */
const FIXES = {
  "not-added": {
    href: "shopify://admin/settings/languages",
    action: "overview.countries.missing.add",
    label: "overview.countries.missing.addLabel",
    why: null,
  },
  unpublished: {
    href: "shopify://admin/settings/languages",
    action: "overview.countries.missing.publish",
    label: "overview.countries.missing.publishLabel",
    why: "overview.countries.missing.why.unpublished",
  },
  "not-in-market": {
    href: "shopify://admin/settings/markets",
    action: "overview.countries.missing.offer",
    label: "overview.countries.missing.offerLabel",
    why: "overview.countries.missing.why.notInMarket",
  },
} as const satisfies Record<MissingReason, { href: string; action: MessageKey; label: MessageKey; why: MessageKey | null }>;

/** "🇨🇿 Czechia, 🇭🇺 Hungary and 3 more". */
function countryList(i18n: I18n, countries: readonly CountryCoverage[], shown = 4): string {
  const names = countries.slice(0, shown).map((c) => `${countryFlag(c.code)} ${i18n.country(c.code, c.name)}`.trim());
  const list = names.join(", ");
  return countries.length > shown ? i18n.t("overview.countries.missing.more", { list, count: countries.length - shown }) : list;
}

function Summary({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const countries = data.countries;
  const total = countries && countries.access && "rows" in countries ? countries.rows.length : 0;
  return (
    <s-section>
      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr 1fr 1fr, 1fr 1fr" gap="base">
          <Figure label={t("overview.summary.languages.label")} value={i18n.number(data.publishedCount)}>
            <s-text color="subdued">{t("overview.summary.languages.detail", { enabled: data.enabledCount, max: data.maxLocales })}</s-text>
          </Figure>
          <Figure
            label={t("overview.summary.translated.label")}
            value={data.averagePercent === null ? "—" : i18n.percent(data.averagePercent)}
            meter={data.averagePercent === null ? null : <ProgressBar value={data.averagePercent} label={t("overview.summary.translated.label")} />}
          >
            <s-text color="subdued">
              {data.averagePercent === null
                ? t("overview.summary.translated.notMeasured")
                : t("overview.summary.translated.detail", { count: data.measuredLanguages })}
            </s-text>
          </Figure>
          <Figure
            label={t("overview.summary.countries.label")}
            value={countries && countries.access && "rows" in countries && total ? t("overview.summary.countries.value", { reached: countries.counts.ok, total }) : "—"}
            meter={
              countries && countries.access && "rows" in countries && total ? (
                <ProgressBar value={(countries.counts.ok / total) * 100} label={t("overview.summary.countries.label")} />
              ) : null
            }
          >
            <s-text color="subdued">
              {!countries || !countries.access
                ? t("overview.summary.countries.connect")
                : !("rows" in countries)
                  ? t("overview.summary.countries.unavailable")
                  : countries.counts.missing
                    ? t("overview.summary.countries.missing", { count: countries.counts.missing })
                    : t("overview.summary.countries.allReached")}
            </s-text>
          </Figure>
          <Figure label={t("overview.summary.review.label")} value={i18n.number(data.pendingDrafts)}>
            {data.pendingDrafts ? (
              <s-link href="/app/review">{t("overview.attention.drafts", { count: data.pendingDrafts })}</s-link>
            ) : (
              <s-text color="subdued">{t("overview.attention.noDrafts")}</s-text>
            )}
            {data.activeJobs ? <s-link href="/app/jobs">{t("overview.attention.jobs", { count: data.activeJobs })}</s-link> : null}
          </Figure>
        </s-grid>
      </s-query-container>
    </s-section>
  );
}

function Checklist({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t, msg } = i18n;
  const done = data.checklist.filter((s) => s.done).length;
  const next = data.checklist.find((s) => !s.done);
  if (!next) return null;
  return (
    <s-section heading={t("overview.start.heading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-text>{t("overview.start.progress", { done, total: data.checklist.length })}</s-text>
          <s-box inlineSize="200px">
            <ProgressBar value={(done / data.checklist.length) * 100} label={t("overview.start.progressLabel")} />
          </s-box>
        </s-stack>
        {/* Finished steps on one line; the open ones as cards with their action. */}
        {done > 0 ? (
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">{t("overview.start.doneLabel")}</s-text>
            {data.checklist
              .filter((step) => step.done)
              .map((step) => (
                <s-badge key={step.id} tone="success" icon="check">
                  {msg(step.label)}
                </s-badge>
              ))}
          </s-stack>
        ) : null}
        <s-stack direction="block" gap="small">
          {data.checklist
            .filter((step) => !step.done)
            .map((step) => (
              <s-box key={step.id} padding="base" borderWidth="base" borderRadius="base" background={step === next ? "subdued" : "base"}>
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-stack direction="block" gap="small-300">
                    <s-text type="strong">{msg(step.label)}</s-text>
                    <s-text color="subdued">{msg(step.detail)}</s-text>
                  </s-stack>
                  <s-button href={step.href} variant={step === next ? "primary" : "secondary"} {...(step.external ? { target: "_top" } : {})}>
                    {msg(step.action)}
                  </s-button>
                </s-stack>
              </s-box>
            ))}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

/** Start the coverage measurement from here, or follow it while it runs. */
function Measure({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const runner = useFetcher<{ ok?: true; error?: string }>();
  if (data.scan.running) {
    return (
      <s-stack direction="block" gap="small-200">
        <ProgressBar value={(data.scan.done / Math.max(1, data.scan.total)) * 100} label={t("overview.scan.progressLabel")} />
        <s-text color="subdued">{t("overview.scan.running", { done: data.scan.done, total: data.scan.total })}</s-text>
      </s-stack>
    );
  }
  if (data.coverageCheckedAt && !data.scan.failed) {
    return (
      <s-paragraph>
        {t("overview.languages.measured", { date: i18n.dateTime(data.coverageCheckedAt) })}{" "}
        <s-link href="/app/coverage">{t("overview.languages.updateCoverage")}</s-link>
      </s-paragraph>
    );
  }
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small">
        {runner.data?.error ? <s-banner tone="critical">{t("overview.scan.startFailed")}</s-banner> : null}
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">{data.scan.failed ? t("overview.scan.failed") : t("overview.languages.runCoverage")}</s-text>
            <s-text color="subdued">{data.jobsAvailable ? t("overview.scan.hint") : t("overview.scan.unavailable")}</s-text>
          </s-stack>
          <runner.Form method="post" action="/app/coverage">
            <input type="hidden" name="intent" value="run" />
            <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
            <s-button type="submit" variant="primary" disabled={!data.jobsAvailable} {...(runner.state !== "idle" ? { loading: true } : {})}>
              {t("overview.scan.start")}
            </s-button>
          </runner.Form>
        </s-stack>
        <s-link href="/app/coverage">{t("overview.languages.openCoverage")}</s-link>
      </s-stack>
    </s-box>
  );
}

/**
 * One language: name and storefront state, the translated share large, the
 * bar of field states, and the way to the missing texts. Same layout on a
 * phone, so the percentage never drops out of view.
 */
function LanguageRow({ row, i18n }: { row: Data["progress"][number]; i18n: I18n }) {
  const { t, language } = i18n;
  const name = language(row.locale, row.name);
  const counts = row.percent === null ? null : row.counts;
  return (
    <s-box paddingBlock="base">
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns="1fr auto" alignItems="center" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">
              <Flag value={localeFlag(row.locale)} />
              {name}
            </s-text>
            {row.published ? <s-badge tone="success">{t("common.state.published")}</s-badge> : <s-badge>{t("overview.languages.hidden")}</s-badge>}
          </s-stack>
          <span style={{ fontSize: 20, fontWeight: 650, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{counts ? percentLabel(i18n, row.complete, row.total) : "—"}</span>
        </s-grid>
        {counts ? (
          <StateBar counts={counts} label={t("overview.languages.progressLabel", { language: name })} i18n={i18n} />
        ) : (
          <div aria-hidden="true" style={{ background: TRACK_COLOUR, borderRadius: 4, height: 8 }} />
        )}
        <s-grid gridTemplateColumns="1fr auto" alignItems="center" gap="base">
          <s-text color="subdued">{counts ? t("coverage.languages.fields", { complete: row.complete, total: row.total }) : t("overview.languages.notMeasured")}</s-text>
          <s-link
            href={counts ? itemsHref({ lang: row.locale, state: "incomplete" }) : `/app/products?lang=${encodeURIComponent(row.locale)}`}
            accessibilityLabel={t("overview.languages.translateLabel", { language: name })}
          >
            {t("overview.languages.translate")}
          </s-link>
        </s-grid>
      </s-stack>
    </s-box>
  );
}

function Languages({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t, language } = i18n;
  // Published languages first (what customers see), the least translated on top.
  const rows = [...data.progress].sort(
    (a, b) => Number(b.published) - Number(a.published) || (a.percent ?? 101) - (b.percent ?? 101) || language(a.locale, a.name).localeCompare(language(b.locale, b.name)),
  );
  return (
    <s-section heading={t("overview.languages.heading")}>
      {data.progress.length === 0 ? (
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("overview.languages.onlyPrimary", { primary: data.primary ?? t("overview.languages.unknown") })}</s-paragraph>
          <s-button href="shopify://admin/settings/languages" target="_top">
            {t("overview.checklist.languageSettings")}
          </s-button>
        </s-stack>
      ) : (
        <s-stack direction="block" gap="small">
          <Measure data={data} i18n={i18n} />
          <s-stack direction="block">
            {rows.map((row, index) => (
              <Fragment key={row.locale}>
                {index > 0 ? <s-divider /> : null}
                <LanguageRow row={row} i18n={i18n} />
              </Fragment>
            ))}
          </s-stack>
        </s-stack>
      )}
    </s-section>
  );
}

function Countries({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t, language } = i18n;
  const access = useFetcher();
  const countries = data.countries;
  if (!countries || data.progress.length === 0) return null;

  if (!countries.access) {
    return (
      <s-section heading={t("overview.countries.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("overview.countries.access.body")}</s-paragraph>
          <access.Form method="post" action="/app/markets">
            <s-button type="submit" {...(access.state !== "idle" ? { loading: true } : {})}>
              {t("overview.countries.access.allow")}
            </s-button>
          </access.Form>
        </s-stack>
      </s-section>
    );
  }
  if (!("rows" in countries)) {
    return (
      <s-section heading={t("overview.countries.heading")}>
        <s-banner tone="warning">{t("overview.countries.error")}</s-banner>
      </s-section>
    );
  }
  if (!countries.rows.length) {
    return (
      <s-section heading={t("overview.countries.heading")}>
        <s-paragraph>{t("overview.countries.none")}</s-paragraph>
      </s-section>
    );
  }

  const SHOWN = 5;
  const missing = countries.missing.slice(0, SHOWN);
  const names = new Map(data.progress.map((l) => [l.locale, l.name]));
  const low = countries.rows.filter((c) => c.status === "low");
  return (
    <s-section heading={t("overview.countries.heading")}>
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{t("overview.countries.intro")}</s-text>
        <CountryStatusBar counts={countries.counts} i18n={i18n} />

        {missing.length ? (
          <s-query-container>
            <s-stack direction="block" gap="small">
              <s-heading>{t("overview.countries.missing.heading")}</s-heading>
              {missing.map((m) => {
                const name = language(m.locale, names.get(m.locale));
                const fix = FIXES[m.reason];
                return (
                  <s-box key={m.locale} padding="base" borderWidth="base" borderRadius="base">
                    {/* The action beside the text, or under it on a phone: the same place on every card. */}
                    <s-grid gridTemplateColumns="@container (inline-size > 480px) 1fr auto, 1fr" alignItems="center" justifyItems="start" gap="base">
                      <s-stack direction="block" gap="small-300">
                        <s-text type="strong">
                          <Flag value={localeFlag(m.locale)} />
                          {name}
                        </s-text>
                        <s-text color="subdued">{t("overview.countries.missing.reach", { count: m.countries.length, countries: countryList(i18n, m.countries) })}</s-text>
                        {fix.why ? <s-text color="subdued">{t(fix.why)}</s-text> : null}
                      </s-stack>
                      <s-button href={fix.href} target="_top" accessibilityLabel={t(fix.label, { language: name })}>
                        {t(fix.action)}
                      </s-button>
                    </s-grid>
                  </s-box>
                );
              })}
              {countries.missing.length > SHOWN ? (
                <s-link href="/app/markets">{t("overview.countries.missing.others", { count: countries.missing.length - SHOWN })}</s-link>
              ) : null}
            </s-stack>
          </s-query-container>
        ) : null}

        {low.length ? (
          <s-stack direction="block" gap="small">
            <s-heading>{t("overview.countries.low.heading")}</s-heading>
            {groupByLanguage(low).map(({ locale, list, percent }) => (
              <s-grid key={locale} gridTemplateColumns="1fr auto" alignItems="center" gap="base">
                <s-text>{t("overview.countries.low.row", { countries: countryList(i18n, list), language: language(locale), percent: i18n.percent(percent) })}</s-text>
                <s-link href={itemsHref({ lang: locale, state: "incomplete" })} accessibilityLabel={t("overview.languages.translateLabel", { language: language(locale) })}>
                  {t("overview.languages.translate")}
                </s-link>
              </s-grid>
            ))}
          </s-stack>
        ) : null}

        {!countries.counts.missing && !countries.counts.partial && !countries.counts.low ? <s-paragraph>{t("overview.countries.allGood")}</s-paragraph> : null}
        {data.averagePercent === null ? <s-text color="subdued">{t("overview.countries.notMeasured")}</s-text> : null}
        <s-link href="/app/markets">{t("overview.countries.all")}</s-link>
      </s-stack>
    </s-section>
  );
}

/** Countries with too little translated, by the language they read (lowest first). */
function groupByLanguage(rows: readonly CountryCoverage[]) {
  const groups = new Map<string, { list: CountryCoverage[]; percent: number }>();
  for (const row of rows) {
    const language = row.languages.find((l) => l.available && !l.primary && l.percent !== null && row.percent !== null && l.percent === row.percent);
    if (!language) continue;
    const group = groups.get(language.locale) ?? { list: [], percent: language.percent! };
    group.list.push(row);
    groups.set(language.locale, group);
  }
  return [...groups].map(([locale, g]) => ({ locale, ...g })).sort((a, b) => a.percent - b.percent);
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t, date } = i18n;
  const revalidator = useRevalidator();
  const usagePercent = data.usage.limit ? (data.usage.used / data.usage.limit) * 100 : 100;

  // Follow a running measurement.
  useEffect(() => {
    if (!data.scan.running) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [data.scan.running, revalidator]);

  return (
    <s-page heading={t("common.nav.overview")}>
      {data.aiAvailable && data.usage.level === "exhausted" ? (
        <s-banner tone="critical" heading={t("overview.banner.exhausted.heading")}>
          <s-paragraph>
            {t("overview.banner.exhausted.body")} <s-link href="/app/plan">{t("common.action.changePlan")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : data.aiAvailable && data.usage.level === "high" ? (
        <s-banner tone="warning" heading={t("overview.banner.high.heading", { percent: Math.floor(usagePercent) })}>
          <s-paragraph>
            {t("overview.banner.high.body")} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      <Summary data={data} i18n={i18n} />
      <Checklist data={data} i18n={i18n} />
      <Languages data={data} i18n={i18n} />
      <Countries data={data} i18n={i18n} />

      <s-section heading={t("overview.translate.heading")}>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">{t("common.nav.products")}</s-button>
          <s-button href="/app/collections">{t("common.nav.collections")}</s-button>
          <s-button href="/app/content">{t("overview.translate.content")}</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={t("overview.usage.heading")}>
        {data.aiAvailable ? (
          <s-stack direction="block" gap="small">
            <ProgressBar
              value={usagePercent}
              label={t("overview.usage.heading")}
              tone={data.usage.level === "exhausted" ? "critical" : data.usage.level === "high" ? "warning" : "success"}
            />
            <s-text>{t("overview.usage.characters", { used: data.usage.used, limit: data.usage.limit })}</s-text>
            <s-text color="subdued">{t("overview.usage.memoryFree")}</s-text>
          </s-stack>
        ) : (
          <s-paragraph>{t("overview.usage.notConfigured")}</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading={data.shopName}>
        <s-paragraph>
          {t("overview.store.languages", { enabled: data.enabledCount, max: data.maxLocales, published: data.publishedCount })}{" "}
          <s-link href="/app/languages">{t("common.languages")}</s-link>
        </s-paragraph>
        <s-paragraph>{t("overview.store.installed", { date: date(data.installedAt, "long") })}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
