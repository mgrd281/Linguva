import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadOverview } from "../.server/overview/overview";
import type { MeasurementState } from "../.server/overview/measurement";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import { getTranslationProvider } from "../.server/providers";
import { getQueues, getWorkerStatus } from "../.server/queue/client";
import { ProgressBar } from "../components/ProgressBar";
import { CoverageMeter, itemsHref, percentLabel } from "../components/Coverage";
import { CountryStatusBar } from "../components/CountryStatus";
import type { MissingReason } from "../lib/country-coverage";
import type { I18n, MessageKey } from "../i18n/i18n";
import { gapEntry, gapLine, languageList, upperFirst } from "../lib/name-lists";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const provider = getTranslationProvider();
  const jobsAvailable = getQueues() !== null;
  const overview = await loadOverview(admin, shop, undefined, {
    aiAvailable: provider !== null,
    jobsAvailable,
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
  });
  // A measurement that waits or is stuck: no worker processing jobs (its heartbeat is gone) explains it.
  const waiting = overview.measurement.state === "waiting" || overview.measurement.state === "stalled";
  const workerStopped = waiting && (await getWorkerStatus()).state === "stopped";
  return { ...overview, aiProvider: provider?.id ?? null, idempotencyKey: randomUUID(), jobsAvailable, workerStopped };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Step = NonNullable<Data["next"]>;

/** How often the page reloads its data while a measurement is under way (never otherwise). */
const POLL_MS: Partial<Record<MeasurementState, number>> = { queued: 3_000, running: 3_000, waiting: 30_000 };
const MEASURING: ReadonlySet<MeasurementState> = new Set(["queued", "waiting", "running"]);

/** Visually hidden, still read out (a live region repeating text that is on screen). */
const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

const COUNTRY_DETAIL: Record<MissingReason, MessageKey> = {
  "not-in-market": "overview.next.countries.notInMarket",
  unpublished: "overview.next.countries.unpublished",
  "not-added": "overview.next.countries.add",
};

const GAP_LINE: Record<MissingReason, MessageKey> = {
  "not-added": "overview.countries.gap.notAdded",
  unpublished: "overview.countries.gap.unpublished",
  "not-in-market": "overview.countries.gap.notInMarket",
};

const LANGUAGE_SETTINGS = "shopify://admin/settings/languages";
const MARKETS_SETTINGS = "shopify://admin/settings/markets";

interface StepView {
  title: ReactNode;
  detail?: string;
  /** A link to an app page or to Shopify's settings (target _top), or the measuring form. */
  action?: { href: string; label: string; external?: boolean } | { measure: string };
}

/** The store's primary language in the admin's language, mid-sentence (Shopify names it in English). */
function primaryName(data: Data, i18n: I18n): string {
  return data.primaryLocale ? i18n.language(data.primaryLocale, data.primary) : (data.primary ?? i18n.t("overview.languages.unknown"));
}

function stepView(step: Step, data: Data, i18n: I18n): StepView {
  const { t, language } = i18n;
  const names = new Map(data.progress.map((l) => [l.locale, l.name]));
  // Inside sentences: as written mid-sentence.
  const languageName = (locale: string, name?: string | null) => language(locale, name ?? names.get(locale));
  switch (step.id) {
    case "add-language":
      return {
        title: t("overview.checklist.language.label"),
        detail: t("overview.checklist.language.detail"),
        action: { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
      };
    case "measure": {
      const m = data.measurement;
      if (MEASURING.has(m.state)) return { title: t("overview.next.measuring.label") };
      if (m.state === "stalled") {
        return {
          title: t("overview.next.stalled.label", { date: i18n.dateTime(m.since ?? "") }),
          detail: data.workerStopped ? t("overview.scan.stopped") : t("overview.next.restart.detail"),
          action: { measure: t("overview.scan.again") },
        };
      }
      if (m.state === "failed") return { title: t("overview.next.failed.label"), detail: t("overview.next.restart.detail"), action: { measure: t("overview.scan.again") } };
      return { title: t("overview.next.measure.label"), detail: t("overview.scan.hint"), action: { measure: t("overview.scan.start") } };
    }
    case "review":
      return {
        title: t("overview.checklist.review.labelCount", { count: step.count }),
        detail: t("overview.checklist.review.detail"),
        action: { href: "/app/review", label: t("overview.checklist.review.action") },
      };
    case "consent":
      return {
        title: t("overview.checklist.consent.label"),
        detail: t("overview.checklist.consent.detail"),
        action: { href: "/app/settings", label: t("overview.checklist.consent.action") },
      };
    case "first-translation":
      return {
        title: t("overview.checklist.firstTranslation.label"),
        detail: t(data.aiAvailable ? "overview.checklist.firstTranslation.detail" : "overview.checklist.firstTranslation.detailManual"),
        action: { href: step.href, label: t("overview.checklist.firstTranslation.action") },
      };
    case "publish-language":
      return {
        title: t("overview.checklist.publishLanguage.label"),
        detail: t("overview.checklist.publishLanguage.detail"),
        action: { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
      };
    case "translate":
      return {
        title: t("overview.next.translate.label", { language: languageName(step.locale, step.name) }),
        detail: t("overview.next.translate.detail", { percent: percentLabel(i18n, step.complete, step.total), primary: primaryName(data, i18n) }),
        action: { href: itemsHref({ lang: step.locale, state: "incomplete" }), label: t("coverage.next.action.missing") },
      };
    case "countries": {
      const languages = languageList(i18n, step.locales.map((l) => languageName(l.locale, l.name)));
      const addSome = step.reason === "not-added" && step.free < step.notAdded;
      return {
        title: t("overview.next.countries.label", { count: step.countries }),
        detail: addSome
          ? t("overview.next.countries.addSome", { max: data.maxLocales, count: step.free, missing: step.notAdded })
          : t(COUNTRY_DETAIL[step.reason], { languages }),
        action:
          step.reason === "not-in-market"
            ? { href: MARKETS_SETTINGS, label: t("overview.countries.marketsSettings"), external: true }
            : { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
      };
    }
    case "unread":
      return {
        title: t("overview.next.unread.label"),
        detail: t("overview.next.unread.detail"),
        action: { href: `/app/coverage?lang=${encodeURIComponent(step.locale)}`, label: t("overview.languages.updateCoverage") },
      };
    case "done":
      return {
        title: (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="check-circle" tone="success" />
            <s-text type="strong">{t("overview.next.done.label")}</s-text>
          </s-stack>
        ),
        detail: t("overview.next.done.detail"),
      };
  }
}

/** The one thing to do now: the page's only primary button. */
function NextStepSection({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const runner = useFetcher<{ ok?: true; error?: string }>();
  const status = useRef<HTMLDivElement>(null);
  const step = data.next;
  const measuring = step?.id === "measure" && MEASURING.has(data.measurement.state);
  // How a measurement followed on this page ended (done, failed, stuck), said in the live region.
  const [wasMeasuring, setWasMeasuring] = useState(measuring);
  const [ended, setEnded] = useState<MeasurementState | null>(null);
  if (measuring !== wasMeasuring) {
    setWasMeasuring(measuring);
    setEnded(measuring ? null : data.measurement.state);
  }

  // The button that started the measurement is gone: keep the focus nearby.
  useEffect(() => {
    if (runner.state === "idle" && runner.data?.ok) status.current?.focus();
  }, [runner.state, runner.data]);

  if (!step) {
    return data.activeJobs ? (
      <s-section heading={t("coverage.next.heading")}>
        <s-link href="/app/jobs">{t("overview.attention.jobs", { count: data.activeJobs })}</s-link>
      </s-section>
    ) : null;
  }
  const view = stepView(step, data, i18n);
  const m = data.measurement;
  // Changes only with the state, so screen readers hear each change once (the part count stays outside).
  const live = measuring
    ? ({ queued: t("overview.scan.queued"), waiting: data.workerStopped ? t("overview.scan.stopped") : t("overview.scan.waiting"), running: t("overview.scan.runningHint") } as Partial<Record<MeasurementState, string>>)[m.state]
    : ended === "done"
      ? t("overview.scan.done")
      : "";
  // Failed or stuck: the card's title says it; the live region repeats it for screen readers only.
  const endedQuietly =
    !measuring && step.id === "measure" && (ended === "failed" || ended === "stalled") && typeof view.title === "string" ? view.title : null;
  const action = view.action;
  return (
    <s-section heading={t("coverage.next.heading")}>
      <s-stack direction="block" gap="base">
        {runner.data?.error ? <s-banner tone="critical">{t("overview.scan.startFailed")}</s-banner> : null}
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 520px) 1fr auto, 1fr" alignItems="center" justifyItems="start" gap="base">
            <s-stack direction="block" gap="small-300">
              {typeof view.title === "string" ? <s-text type="strong">{view.title}</s-text> : view.title}
              {view.detail ? <s-text color="subdued">{view.detail}</s-text> : null}
              {measuring && m.state === "running" ? (
                <s-stack direction="block" gap="small-300">
                  <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("overview.scan.progressLabel")} />
                  <s-text color="subdued">{t("overview.scan.running", { done: m.done, total: m.total })}</s-text>
                </s-stack>
              ) : null}
              <div role="status" tabIndex={-1} ref={status} style={{ outline: "none" }}>
                {live ? <s-text color="subdued">{live}</s-text> : endedQuietly ? <span style={VISUALLY_HIDDEN}>{endedQuietly}</span> : null}
              </div>
            </s-stack>
            {!action ? null : "measure" in action ? (
              <runner.Form method="post" action="/app/coverage">
                <input type="hidden" name="intent" value="run" />
                <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
                <s-button type="submit" variant="primary" {...(runner.state !== "idle" ? { loading: true } : {})}>
                  {action.measure}
                </s-button>
              </runner.Form>
            ) : (
              <s-button variant="primary" href={action.href} {...(action.external ? { target: "_top" } : {})}>
                {action.label}
              </s-button>
            )}
          </s-grid>
        </s-query-container>
        {data.activeJobs ? <s-link href="/app/jobs">{t("overview.attention.jobs", { count: data.activeJobs })}</s-link> : null}
      </s-stack>
    </s-section>
  );
}

/** One line per language: its name (the way to what's missing) and the share of complete fields. */
function LanguagesSection({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t, language } = i18n;
  const remeasurer = useFetcher<{ ok?: true; error?: string }>();
  const footerStatus = useRef<HTMLDivElement>(null);
  const m = data.measurement;
  // A newer measurement on a measured store (the next step follows a first one).
  const remeasure = data.next?.id !== "measure" && data.measuredAt !== null;
  const following = remeasure && MEASURING.has(m.state);
  const [wasFollowing, setWasFollowing] = useState(following);
  const [ended, setEnded] = useState<MeasurementState | null>(null);
  if (following !== wasFollowing) {
    setWasFollowing(following);
    setEnded(following ? null : m.state);
  }
  // The button that started the measurement is gone: keep the focus nearby.
  useEffect(() => {
    if (remeasurer.state === "idle" && remeasurer.data?.ok) footerStatus.current?.focus();
  }, [remeasurer.state, remeasurer.data]);
  const rawName = (l: { locale: string; name: string | null }) => language(l.locale, l.name);
  const nameOf = (l: { locale: string; name: string | null }) => upperFirst(rawName(l));
  const share = data.storeShare;
  const anyMeasured = data.progress.some((l) => l.measured);
  // Published first (what customers see), measured before unmeasured, the least translated on top.
  const rows = [...data.progress].sort(
    (a, b) =>
      Number(b.published) - Number(a.published) ||
      Number(b.measured) - Number(a.measured) ||
      (a.percent ?? 101) - (b.percent ?? 101) ||
      nameOf(a).localeCompare(nameOf(b), i18n.locale),
  );
  const restart = remeasure && (m.state === "failed" || m.state === "stalled");
  const partial = data.progress.filter((l) => l.published && l.partial);
  // Read out on change: text that changes with the state only (the part count stays outside).
  const footerLive = !remeasure
    ? null
    : data.workerStopped && (m.state === "waiting" || m.state === "stalled")
      ? t("overview.scan.stopped")
      : m.state === "queued"
        ? t("overview.scan.queued")
        : m.state === "waiting"
          ? t("overview.scan.waiting")
          : m.state === "running"
            ? t("overview.scan.runningAgain")
            : restart
              ? t("overview.scan.updateFailed")
              : ended === "done"
                ? t(partial.length ? "overview.scan.updatedPartial" : "overview.scan.updated")
                : null;
  const footerCount = remeasure && m.state === "running" ? t("overview.scan.running", { done: m.done, total: m.total }) : null;
  const manage = <s-link href="/app/languages">{t("overview.languages.manage")}</s-link>;

  if (!data.progress.length) {
    return (
      <s-section heading={t("overview.languages.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("overview.languages.onlyPrimary", { primary: primaryName(data, i18n) })}</s-paragraph>
          {manage}
        </s-stack>
      </s-section>
    );
  }

  const alphabetical = (list: typeof data.progress) => list.map(rawName).sort((a, b) => a.localeCompare(b, i18n.locale));
  const live = alphabetical(data.progress.filter((l) => l.published));
  const hidden = alphabetical(data.progress.filter((l) => !l.published));
  return (
    <s-section heading={t("overview.languages.heading")}>
      <s-stack direction="block" gap="base">
        {share && share.total > 0 ? (
          <s-stack direction="inline" gap="small" alignItems="baseline">
            <span style={{ fontSize: 28, lineHeight: "32px", fontWeight: 650, letterSpacing: "-0.01em" }}>{percentLabel(i18n, share.complete, share.total)}</span>
            <s-text color="subdued">
              {share.languages < share.published
                ? t("overview.languages.shareSome", { count: share.languages, published: share.published })
                : t("overview.languages.share", { count: share.languages })}
            </s-text>
          </s-stack>
        ) : null}
        {anyMeasured ? (
          // A native list: Polaris' list roles fail the accessibility check.
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {rows.map((row) => {
              const name = nameOf(row);
              const counted = row.measured && row.total > 0 && row.counts;
              const complete = counted && row.complete >= row.total;
              const href = !counted
                ? `/app/products?lang=${encodeURIComponent(row.locale)}`
                : complete
                  ? `/app/coverage?lang=${encodeURIComponent(row.locale)}`
                  : itemsHref({ lang: row.locale, state: "incomplete" });
              const label = !counted
                ? t("overview.languages.translateLabel", { language: name })
                : complete
                  ? t("overview.languages.completeLabel", { language: name })
                  : t("overview.languages.missingLabel", { language: name, percent: percentLabel(i18n, row.complete, row.total) });
              return (
                <li key={row.locale}>
                  <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 3fr)" alignItems="center" columnGap="base">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-link href={href} accessibilityLabel={label}>
                        {name}
                      </s-link>
                      {row.published ? null : <s-badge>{t("overview.languages.hidden")}</s-badge>}
                    </s-stack>
                    {counted && row.counts ? (
                      <CoverageMeter counts={row.counts} complete={row.complete} total={row.total} label={t("overview.languages.progressLabel", { language: rawName(row) })} i18n={i18n} />
                    ) : (
                      <s-text color="subdued">{row.measured ? t("coverage.types.empty") : t("overview.languages.notMeasured")}</s-text>
                    )}
                  </s-grid>
                </li>
              );
            })}
          </ul>
        ) : (
          <s-stack direction="block" gap="small">
            <s-text color="subdued">{data.jobsAvailable ? t("overview.languages.pending") : t("overview.scan.unavailable")}</s-text>
            {live.length ? <s-paragraph>{t("overview.languages.live", { languages: live.join(", ") })}</s-paragraph> : null}
            {hidden.length ? <s-paragraph>{t("overview.languages.hiddenList", { languages: hidden.join(", ") })}</s-paragraph> : null}
          </s-stack>
        )}
        <s-stack direction="block" gap="small-200">
          {data.measuredAt ? (
            // One block, so an empty live region adds no gap (only measured stores measure again here).
            <div>
              <s-stack direction="block" gap="small-200">
                <s-text color="subdued">{t("overview.languages.measured", { date: i18n.dateTime(data.measuredAt) })}</s-text>
                {footerCount ? <s-text color="subdued">{footerCount}</s-text> : null}
              </s-stack>
              <div role="status" tabIndex={-1} ref={footerStatus} style={{ outline: "none" }}>
                {footerLive ? (
                  <div style={{ paddingTop: 8 }}>
                    <s-text color="subdued">{footerLive}</s-text>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {partial.length ? <s-text color="subdued">{t("overview.languages.partial", { languages: languageList(i18n, partial.map(rawName)), count: partial.length })}</s-text> : null}
          {remeasurer.data?.error ? <s-banner tone="critical">{t("overview.scan.startFailed")}</s-banner> : null}
          {restart ? (
            <remeasurer.Form method="post" action="/app/coverage">
              <input type="hidden" name="intent" value="run" />
              <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
              <s-button type="submit" {...(remeasurer.state !== "idle" ? { loading: true } : {})}>
                {t("overview.scan.again")}
              </s-button>
            </remeasurer.Form>
          ) : null}
          <s-stack direction="inline" gap="base">
            <s-link href="/app/coverage">{t("overview.languages.updateCoverage")}</s-link>
            {manage}
          </s-stack>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function CountriesSection({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t, language } = i18n;
  const access = useFetcher();
  const countries = data.countries;
  if (!countries || !data.progress.length) return null;

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

  // "In their language" only when every language a country is offered has been measured.
  const measured = countries.rows.every((c) => !c.languages.some((l) => l.available) || c.percent !== null);
  const names = new Map(data.progress.map((l) => [l.locale, l.name]));
  const nameOf = (locale: string) => language(locale, names.get(locale));
  const reasons = (["not-added", "unpublished", "not-in-market"] as const).filter((r) => countries.missing.some((m) => m.reason === r));
  const notAdded = countries.missing.filter((m) => m.reason === "not-added").length;
  const capacity =
    notAdded > 0 && data.remainingLocales === 0
      ? t("languages.limit.body", { max: data.maxLocales })
      : notAdded > data.remainingLocales
        ? t("overview.countries.capacity", { max: data.maxLocales, count: data.remainingLocales })
        : null;
  return (
    <s-section heading={t("overview.countries.heading")}>
      <s-stack direction="block" gap="base">
        <CountryStatusBar counts={countries.counts} i18n={i18n} measured={measured} />
        {reasons.length ? (
          <s-stack direction="block" gap="small-200">
            <s-heading>{t("overview.countries.missing.heading")}</s-heading>
            {reasons.map((reason) => (
              <s-paragraph key={reason}>
                {t(GAP_LINE[reason], { languages: gapLine(i18n, countries.missing.filter((m) => m.reason === reason).map((m) => gapEntry(i18n, nameOf(m.locale), m.countries))) })}
              </s-paragraph>
            ))}
            {capacity ? <s-text color="subdued">{capacity}</s-text> : null}
          </s-stack>
        ) : countries.counts.missing + countries.counts.partial + countries.counts.low === 0 ? (
          <s-paragraph>{measured ? t("overview.countries.allGood") : t("overview.countries.allOffered")}</s-paragraph>
        ) : null}
        {measured ? null : <s-text color="subdued">{t("overview.countries.notMeasured")}</s-text>}
        <s-stack direction="inline" gap="base">
          {reasons.includes("not-added") || reasons.includes("unpublished") ? (
            <s-link href={LANGUAGE_SETTINGS} target="_top">
              {t("overview.checklist.languageSettings")}
            </s-link>
          ) : null}
          {reasons.includes("not-in-market") ? (
            <s-link href={MARKETS_SETTINGS} target="_top">
              {t("overview.countries.marketsSettings")}
            </s-link>
          ) : null}
          <s-link href="/app/markets">{t("overview.countries.all")}</s-link>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const revalidator = useRevalidator();
  const usagePercent = data.usage.limit ? (data.usage.used / data.usage.limit) * 100 : 100;

  // Follow a measurement while it is under way; nothing to follow otherwise.
  const poll = POLL_MS[data.measurement.state];
  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, poll);
    return () => clearInterval(timer);
  }, [poll, revalidator]);

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

      <NextStepSection data={data} i18n={i18n} />
      <LanguagesSection data={data} i18n={i18n} />
      <CountriesSection data={data} i18n={i18n} />

      {data.progress.length ? (
        <s-section heading={t("overview.translate.heading")}>
          <s-stack direction="inline" gap="base">
            <s-link href="/app/products">{t("common.nav.products")}</s-link>
            <s-link href="/app/collections">{t("common.nav.collections")}</s-link>
            <s-link href="/app/content">{t("common.nav.content")}</s-link>
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading={t("overview.ai.heading")}>
        {data.aiAvailable ? (
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="success">{t("overview.ai.on")}</s-badge>
              {data.aiProvider === "deepl" ? <s-text color="subdued">DeepL</s-text> : null}
            </s-stack>
            <ProgressBar
              value={usagePercent}
              label={t("overview.usage.heading")}
              tone={data.usage.level === "exhausted" ? "critical" : data.usage.level === "high" ? "warning" : "success"}
            />
            <s-text>{t("overview.usage.characters", { used: data.usage.used, limit: data.usage.limit })}</s-text>
            <s-text color="subdued">{t("overview.usage.memoryFree")}</s-text>
            <s-link href="/app/languages">{t("overview.ai.languages")}</s-link>
          </s-stack>
        ) : (
          <s-paragraph>{t("overview.usage.notConfigured")}</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
