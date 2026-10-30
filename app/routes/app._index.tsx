/**
 * The Overview (`/app`): how far the store is in every language customers
 * can choose, next to the one next step (the page's only primary button) and
 * what else needs the merchant; the translations running now; then the
 * customers by country (or by language), each card the way to that
 * language's page. The page reloads itself only while a count or a
 * translation runs.
 */
import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadOverview } from "../.server/overview/overview";
import type { MeasurementState } from "../.server/overview/measurement";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import { getTranslationProvider } from "../.server/providers";
import { getQueues, getWorkerStatus } from "../.server/queue/client";
import { ProgressBar } from "../components/ProgressBar";
import { durationText, percentLabel, SURFACE_COLOUR, TRACK_COLOUR } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { CountryCards, LanguageCards } from "../components/CountryCards";
import { categoryName } from "../components/CategoryCard";
import { Flag } from "../components/Flag";
import { StateIcon, StateLines } from "../components/ItemStates";
import { BIG_HEADING, PLAIN_LIST } from "../components/LanguageLayout";
import type { MissingReason } from "../lib/country-coverage";
import { emptyCounts } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import { categoryOf, languagePath } from "../lib/language-categories";
import type { I18n, MessageKey } from "../i18n/i18n";
import { languageList, upperFirst } from "../lib/name-lists";
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
  // A count that waits or is stuck: no worker processing jobs (its heartbeat is gone) explains it.
  const waiting = overview.measurement.state === "waiting" || overview.measurement.state === "stalled";
  const workerStopped = waiting && (await getWorkerStatus()).state === "stopped";
  return { ...overview, aiProvider: provider?.id ?? null, idempotencyKey: randomUUID(), jobsAvailable, workerStopped };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Step = NonNullable<Data["next"]>;
type Attention = Data["attention"][number];
type Counter = ReturnType<typeof useFetcher<{ ok?: true; error?: string }>>;

/** How often the page reloads its data while a count is under way. */
const POLL_MS: Partial<Record<MeasurementState, number>> = { queued: 3_000, running: 3_000, waiting: 30_000 };
/** While translations run (and nothing is counted), a slower reload keeps their progress current. */
const JOBS_POLL_MS = 5_000;
const MEASURING: ReadonlySet<MeasurementState> = new Set(["queued", "waiting", "running"]);

/** Visually hidden, still read out (a live region repeating text that is on screen). */
const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

const COUNTRY_DETAIL: Record<MissingReason, MessageKey> = {
  "not-in-market": "overview.next.countries.notInMarket",
  unpublished: "overview.next.countries.unpublished",
  "not-added": "overview.next.countries.add",
};

const LANGUAGE_SETTINGS = "shopify://admin/settings/languages";
const MARKETS_SETTINGS = "shopify://admin/settings/markets";

interface StepView {
  title: string;
  detail?: string;
  icon: ReactNode;
  /** A link to an app page or to Shopify's settings (target _top), or the counting form. */
  action?: { href: string; label: string; external?: boolean; accessibilityLabel?: string } | { measure: string };
}

/** The store's original language in the admin's language, mid-sentence (Shopify names it in English). */
function primaryName(data: Data, i18n: I18n): string {
  return data.primaryLocale ? i18n.language(data.primaryLocale, data.primary) : (data.primary ?? i18n.t("overview.languages.unknown"));
}

/** A language of the store inside a sentence, by its locale. */
function namesOf(data: Data, i18n: I18n) {
  const names = new Map(data.progress.map((l) => [l.locale, l.name]));
  return (locale: string, name?: string | null) => i18n.language(locale, name ?? names.get(locale));
}

function countriesView(step: Extract<Step, { id: "countries" }>, data: Data, i18n: I18n): StepView {
  const { t } = i18n;
  const languageName = namesOf(data, i18n);
  const languages = languageList(i18n, step.locales.map((l) => languageName(l.locale, l.name)));
  const addSome = step.reason === "not-added" && step.free < step.notAdded;
  return {
    title: t("overview.next.countries.label", { count: step.countries }),
    detail: addSome ? t("overview.next.countries.addSome", { max: data.maxLocales, count: step.free, missing: step.notAdded }) : t(COUNTRY_DETAIL[step.reason], { languages }),
    icon: <s-icon type="globe" tone="caution" />,
    action:
      step.reason === "not-in-market"
        ? { href: MARKETS_SETTINGS, label: t("overview.countries.marketsSettings"), external: true }
        : { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
  };
}

function stepView(step: Step, data: Data, i18n: I18n): StepView {
  const { t } = i18n;
  const languageName = namesOf(data, i18n);
  switch (step.id) {
    case "add-language":
      return {
        title: t("overview.checklist.language.label"),
        detail: t("overview.checklist.language.detail"),
        icon: <s-icon type="language" />,
        action: { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
      };
    case "measure": {
      const m = data.measurement;
      const icon = <s-icon type="chart-donut" />;
      if (MEASURING.has(m.state)) return { title: t("overview.next.measuring.label"), icon };
      if (m.state === "stalled") {
        return {
          title: t("overview.next.stalled.label", { date: i18n.dateTime(m.since ?? "") }),
          detail: data.workerStopped ? t("overview.scan.stopped") : t("overview.next.restart.detail"),
          icon,
          action: { measure: t("overview.scan.again") },
        };
      }
      if (m.state === "failed") return { title: t("overview.next.failed.label"), detail: t("overview.next.restart.detail"), icon, action: { measure: t("overview.scan.again") } };
      return { title: t("overview.next.measure.label"), detail: t("overview.scan.hint"), icon, action: { measure: t("overview.scan.start") } };
    }
    case "review":
      return {
        title: t("language.next.review.title", { count: step.count }),
        detail:
          data.storeShare?.payoff != null
            ? t("language.next.review.detail", { percent: i18n.percent(data.storeShare.payoff) })
            : t("language.next.review.detailNoGain"),
        icon: <StateIcon state="waiting" />,
        action: { href: "/app/review", label: t("language.next.review.action") },
      };
    case "consent":
      return {
        title: t("overview.checklist.consent.label"),
        detail: t("overview.checklist.consent.detail"),
        icon: <s-icon type="settings" />,
        action: { href: "/app/settings", label: t("overview.checklist.consent.action") },
      };
    case "first-translation":
      return {
        title: t("overview.checklist.firstTranslation.label"),
        detail: t(data.aiAvailable ? "overview.checklist.firstTranslation.detail" : "overview.checklist.firstTranslation.detailManual"),
        icon: <s-icon type="product" />,
        action: { href: step.href, label: t("overview.checklist.firstTranslation.action") },
      };
    case "publish-language":
      return {
        title: t("overview.checklist.publishLanguage.label"),
        detail: t("overview.checklist.publishLanguage.detail"),
        icon: <s-icon type="view" />,
        action: { href: LANGUAGE_SETTINGS, label: t("overview.checklist.languageSettings"), external: true },
      };
    case "translate":
      return {
        title: t("overview.next.translate.label", { language: languageName(step.locale, step.name) }),
        detail: t("overview.next.translate.detail", { percent: percentLabel(i18n, step.complete, step.total), primary: primaryName(data, i18n) }),
        icon: <StateIcon state="missing" />,
        action: { href: languagePath(step.locale), label: t("coverage.next.action.missing") },
      };
    case "countries":
      return countriesView(step, data, i18n);
    case "unread":
      return {
        title: t("overview.next.unread.label"),
        detail: t("overview.next.unread.detail"),
        icon: <s-icon type="alert-triangle" tone="caution" />,
        action: { measure: t("overview.header.recount") },
      };
    case "access":
      return {
        title: t("overview.next.access.label", { count: step.types }),
        detail: t("overview.next.access.detail"),
        icon: <s-icon type="lock" />,
        action: step.href ? { href: step.href, label: t("coverage.types.allowAccess") } : { href: "/app/coverage", label: t("overview.next.access.coverage") },
      };
    case "done":
      return { title: t("overview.next.done.label"), detail: t("overview.next.done.detail"), icon: <StateIcon state="complete" /> };
  }
}

/** Outdated or failed texts across the languages, or countries without their language: a quieter row each. */
function attentionView(item: Attention, data: Data, i18n: I18n): StepView {
  const { t } = i18n;
  if (item.id === "countries") return countriesView(item, data, i18n);
  const languageName = namesOf(data, i18n);
  // The language with the most of them opens; the line names every one.
  const first = item.locales[0]!;
  const languages = t("overview.attention.in", { languages: languageList(i18n, item.locales.map((l) => languageName(l.locale, l.name))) });
  const action = {
    href: languagePath(first.locale),
    label: t("overview.attention.view"),
    accessibilityLabel: `${upperFirst(languageName(first.locale, first.name))}: ${t("overview.attention.view")}`,
  };
  return item.id === "outdated"
    ? { title: t("overview.attention.outdated", { count: item.count }), detail: `${t("language.words.outdated")} ${languages}`, icon: <StateIcon state="outdated" />, action }
    : { title: t("overview.attention.failed", { count: item.count }), detail: `${languages} ${t("overview.attention.failedDetail")}`, icon: <StateIcon state="failed" />, action };
}

/** The form that counts the store (intent "run" of the Coverage page's action). */
function CountForm({ fetcher, data, label, primary }: { fetcher: Counter; data: Data; label: string; primary: boolean }) {
  return (
    <fetcher.Form method="post" action="/app/coverage">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <s-button type="submit" variant={primary ? "primary" : "secondary"} {...(primary ? {} : { icon: "refresh" })} {...(fetcher.state !== "idle" ? { loading: true } : {})}>
        {label}
      </s-button>
    </fetcher.Form>
  );
}

/** A step's action: a link button, or the counting form. */
function StepAction({ view, primary, data, counter }: { view: StepView; primary: boolean; data: Data; counter: Counter }) {
  const action = view.action;
  if (!action) return null;
  if ("measure" in action) return <CountForm fetcher={counter} data={data} label={action.measure} primary={primary} />;
  return (
    <s-button
      variant={primary ? "primary" : "secondary"}
      href={action.href}
      {...(action.external ? { target: "_top" } : {})}
      {...(action.accessibilityLabel ? { accessibilityLabel: action.accessibilityLabel } : {})}
    >
      {action.label}
    </s-button>
  );
}

/** The one thing to do now (the page's only primary button), then up to three more, quieter. */
function NextSteps({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const counter = useFetcher<{ ok?: true; error?: string }>();
  const status = useRef<HTMLDivElement>(null);
  const step = data.next;
  const measuring = step?.id === "measure" && MEASURING.has(data.measurement.state);
  // How a count followed on this page ended (done, failed, stuck), said in the live region.
  const [wasMeasuring, setWasMeasuring] = useState(measuring);
  const [ended, setEnded] = useState<MeasurementState | null>(null);
  if (measuring !== wasMeasuring) {
    setWasMeasuring(measuring);
    setEnded(measuring ? null : data.measurement.state);
  }
  // The button that started the count is gone: keep the focus nearby.
  useEffect(() => {
    if (counter.state === "idle" && counter.data?.ok) status.current?.focus();
  }, [counter.state, counter.data]);

  const m = data.measurement;
  const view = step ? stepView(step, data, i18n) : null;
  // Changes only with the state, so screen readers hear each change once (the part count stays outside).
  const live = measuring
    ? ({ queued: t("overview.scan.queued"), waiting: data.workerStopped ? t("overview.scan.stopped") : t("overview.scan.waiting"), running: t("overview.scan.runningHint") } as Partial<Record<MeasurementState, string>>)[m.state]
    : ended === "done"
      ? t("overview.scan.done")
      : "";
  // Failed or stuck: the step's title says it; the live region repeats it for screen readers only.
  const endedQuietly = !measuring && step?.id === "measure" && (ended === "failed" || ended === "stalled") ? view?.title : null;
  const more = data.attention.map((item) => ({ key: item.id, view: attentionView(item, data, i18n) }));
  return (
    <s-section heading={t("language.next.heading")}>
      <s-stack direction="block" gap="base">
        {counter.data?.error ? <s-banner tone="critical">{t("overview.scan.startFailed")}</s-banner> : null}
        {view ? (
          <s-box padding="base" background="subdued" borderRadius="large">
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
              {view.icon}
              <s-stack direction="block" gap="small-200">
                <s-stack direction="block" gap="small-500">
                  <s-text type="strong">{view.title}</s-text>
                  {view.detail ? <s-text color="subdued">{view.detail}</s-text> : null}
                </s-stack>
                {measuring && m.state === "running" ? (
                  <s-stack direction="block" gap="small-300">
                    <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("language.hero.progressLabel")} />
                    <s-text color="subdued">{t("language.hero.progress", { done: m.done, total: m.total })}</s-text>
                  </s-stack>
                ) : null}
                <div role="status" tabIndex={-1} ref={status} style={{ outline: "none" }}>
                  {live ? <s-text color="subdued">{live}</s-text> : endedQuietly ? <span style={VISUALLY_HIDDEN}>{endedQuietly}</span> : null}
                </div>
                {view.action ? (
                  <s-stack direction="inline">
                    <StepAction view={view} primary data={data} counter={counter} />
                  </s-stack>
                ) : null}
              </s-stack>
            </s-grid>
          </s-box>
        ) : null}
        {more.length ? (
          <s-query-container>
            <ul style={{ ...PLAIN_LIST, display: "grid", gap: 12 }}>
              {more.map(({ key, view: item }, i) => (
                <li key={key}>
                  <s-stack direction="block" gap="base">
                    {i > 0 ? <s-divider /> : null}
                    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                      {item.icon}
                      <s-grid gridTemplateColumns="@container (inline-size > 480px) 1fr auto, 1fr" gap="small-200" alignItems="center" justifyItems="start">
                        <s-stack direction="block" gap="small-500">
                          <s-text type="strong">{item.title}</s-text>
                          {item.detail ? <s-text color="subdued">{item.detail}</s-text> : null}
                        </s-stack>
                        <StepAction view={item} primary={false} data={data} counter={counter} />
                      </s-grid>
                    </s-grid>
                  </s-stack>
                </li>
              ))}
            </ul>
          </s-query-container>
        ) : null}
        {!view && !more.length ? (
          <s-text color="subdued">{data.jobsAvailable || data.measuredAt ? t("language.next.empty") : t("overview.scan.unavailable")}</s-text>
        ) : null}
      </s-stack>
    </s-section>
  );
}

/**
 * Counting a store that was counted before: its figures stay while a newer
 * count runs, and this says how it goes (after the header's button).
 */
function RecountStatus({ data, i18n, statusRef }: { data: Data; i18n: I18n; statusRef: RefObject<HTMLDivElement> }) {
  const { t } = i18n;
  const m = data.measurement;
  const following = MEASURING.has(m.state);
  const [wasFollowing, setWasFollowing] = useState(following);
  const [ended, setEnded] = useState<MeasurementState | null>(null);
  if (following !== wasFollowing) {
    setWasFollowing(following);
    setEnded(following ? null : m.state);
  }
  const partial = data.progress.some((l) => l.published && l.partial);
  // Read out on change: text that changes with the state only (the part count stays outside).
  const live =
    data.workerStopped && (m.state === "waiting" || m.state === "stalled")
      ? t("overview.scan.stopped")
      : m.state === "queued"
        ? t("overview.scan.queued")
        : m.state === "waiting"
          ? t("overview.scan.waiting")
          : m.state === "running"
            ? t("overview.scan.runningAgain")
            : m.state === "failed" || m.state === "stalled"
              ? t("overview.scan.updateFailed")
              : ended === "done"
                ? t(partial ? "overview.scan.updatedPartial" : "overview.scan.updated")
                : null;
  return (
    <div>
      {m.state === "running" ? (
        <s-stack direction="block" gap="small-300">
          <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("language.hero.progressLabel")} />
          <s-text color="subdued">{t("language.hero.progress", { done: m.done, total: m.total })}</s-text>
        </s-stack>
      ) : null}
      <div role="status" tabIndex={-1} ref={statusRef} style={{ outline: "none" }}>
        {live ? (
          <div style={{ paddingTop: m.state === "running" ? 8 : 0 }}>
            <s-text color="subdued">{live}</s-text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** How far the store is in the languages customers can choose: the ring, the figure and each state. */
function StoreFigure({ data, i18n, recount }: { data: Data; i18n: I18n; recount: ReactNode }) {
  const { t } = i18n;
  const share = data.storeShare;
  const primary = primaryName(data, i18n);
  const partial = data.progress.filter((l) => l.published && l.partial);
  if (share && share.total > 0) {
    const percent = percentLabel(i18n, share.complete, share.total);
    return (
      <s-section accessibilityLabel={t("overview.store.label")}>
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="large" alignItems="center">
            <CoverageRing
              counts={share.counts}
              figure={percent}
              caption={t("language.hero.translated")}
              label={t("language.hero.ringLabel", { percent, complete: share.complete, total: share.total })}
              size={112}
            />
            <s-stack direction="block" gap="small-300">
              <s-heading>{t("overview.store.heading", { count: share.published })}</s-heading>
              <s-text color="subdued">
                {share.languages < share.published
                  ? t("overview.store.figureSome", { complete: share.complete, total: share.total, count: share.languages, published: share.published })
                  : t("overview.store.figure", { complete: share.complete, total: share.total })}
              </s-text>
            </s-stack>
          </s-grid>
          <StateLines counts={share.counts} i18n={i18n} />
          <s-text color="subdued">{t("language.hero.fallback", { primary })}</s-text>
          {share.payoff !== null ? (
            <s-stack direction="inline">
              <s-badge tone="info" icon="arrow-up-right">
                {t("language.hero.payoff", { count: share.counts.draft + share.counts.review, percent: i18n.percent(share.payoff) })}
              </s-badge>
            </s-stack>
          ) : null}
          {data.unreadable ? (
            <s-text color="subdued">
              {t("overview.languages.unreadable", { count: data.unreadable.types })}{" "}
              {data.unreadable.href ? <s-link href={data.unreadable.href}>{t("coverage.types.allowAccess")}</s-link> : null}
            </s-text>
          ) : null}
          {partial.length ? (
            <s-text color="subdued">
              {t("overview.languages.partial", { languages: languageList(i18n, partial.map((l) => i18n.language(l.locale, l.name))), count: partial.length })}
            </s-text>
          ) : null}
          {recount}
        </s-stack>
      </s-section>
    );
  }
  const published = data.progress.filter((l) => l.published);
  const [title, help] = !data.progress.length
    ? [t("overview.store.noLanguage"), t("overview.store.onlyPrimary", { primary })]
    : !published.length
      ? [t("overview.store.unpublished"), t("overview.store.unpublishedHelp")]
      : published.some((l) => l.measured)
        ? [t("language.hero.nothing"), t("overview.store.nothingHelp")]
        : MEASURING.has(data.measurement.state)
          ? [t("language.hero.counting"), t("language.hero.countingHelp")]
          : [t("language.hero.notCounted"), data.jobsAvailable ? t("overview.store.notCountedHelp") : t("overview.scan.unavailable")];
  return (
    <s-section accessibilityLabel={t("overview.store.label")}>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="large" alignItems="center">
          <CoverageRing counts={emptyCounts()} figure="—" caption={t("language.hero.translated")} label={title} size={112} />
          <s-stack direction="block" gap="small-300">
            <s-heading>{title}</s-heading>
            <s-text color="subdued">{help}</s-text>
          </s-stack>
        </s-grid>
        {published.length ? (
          <s-paragraph>
            {t("overview.store.languages", {
              count: published.length,
              languages: published.map((l) => i18n.language(l.locale, l.name)).sort((a, b) => a.localeCompare(b, i18n.locale)).join(", "),
            })}
          </s-paragraph>
        ) : null}
        {recount}
      </s-stack>
    </s-section>
  );
}

/** The area a job translates, by its content type ("Pages", "Texts of your theme"). */
function jobArea(i18n: I18n, resourceType: string): string {
  const area = categoryOf(resourceType);
  if (area === "theme" || area === "notifications") return i18n.t(`language.extra.${area}.name`);
  return area ? categoryName(i18n, area) : resourceType;
}

/** Translations running now, each with its progress and the time left once it can be told. */
function RunningJobs({ data, i18n, marketCountries }: { data: Data; i18n: I18n; marketCountries: readonly string[] }) {
  const { t } = i18n;
  if (!data.jobs.length) return null;
  const languageName = namesOf(data, i18n);
  const more = data.activeJobs - data.jobs.length;
  return (
    <s-section accessibilityLabel={t("overview.jobs.heading")}>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
          <s-heading>{t("overview.jobs.heading")}</s-heading>
          <s-link href="/app/jobs">{t("overview.jobs.all")}</s-link>
        </s-grid>
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="large">
            {data.jobs.map((job) => {
              const title = `${upperFirst(languageName(job.locale))} · ${jobArea(i18n, job.resourceType)}`;
              const after = [
                job.remainingMs !== null ? t("overview.jobs.eta", { duration: durationText(i18n, job.remainingMs) }) : t("overview.jobs.noEta"),
                job.publishMode === "DRAFT" ? t("overview.jobs.review", { review: t("common.nav.review") }) : null,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <s-stack key={job.id} direction="block" gap="small-200">
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
                    <Flag country={localeCountry(job.locale, marketCountries)} fallback={job.locale} size={20} />
                    <s-link href={`/app/jobs/${job.id}`}>{title}</s-link>
                    {/* Until every item is found the total still grows: no figure yet. */}
                    {job.discoveryDone ? <s-text color="subdued">{t("overview.jobs.progress", { done: job.done, total: job.total })}</s-text> : <span />}
                  </s-grid>
                  {job.discoveryDone ? <ProgressBar value={job.percent} label={t("language.card.jobLabel", { category: title })} /> : null}
                  <s-text color="subdued">{job.discoveryDone ? after : t("overview.jobs.finding")}</s-text>
                </s-stack>
              );
            })}
          </s-grid>
        </s-query-container>
        {more > 0 ? <s-text color="subdued">{t("overview.jobs.more", { count: more })}</s-text> : null}
      </s-stack>
    </s-section>
  );
}

type View = "countries" | "languages";

/** Countries | Languages: two toggle buttons (Polaris has none), the choice kept in the address (`?view=`). */
function ViewSwitch({ view, onChange, i18n }: { view: View; onChange: (view: View) => void; i18n: I18n }) {
  const { t } = i18n;
  const option = (value: View, label: string) => {
    const pressed = view === value;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onChange(value)}
        style={{
          minHeight: 32,
          minWidth: 44,
          padding: "4px 14px",
          border: 0,
          borderRadius: 8,
          background: pressed ? SURFACE_COLOUR : "transparent",
          boxShadow: pressed ? "0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.1)" : "none",
          color: "inherit",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t("overview.places.view.label")} style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 10, background: TRACK_COLOUR }}>
      {option("countries", t("overview.places.view.countries"))}
      {option("languages", t("overview.places.view.languages"))}
    </div>
  );
}

/** The customers by country (needs the markets) or by language: every card opens that language's page. */
function Places({ data, i18n, marketCountries }: { data: Data; i18n: I18n; marketCountries: readonly string[] }) {
  const { t } = i18n;
  const access = useFetcher();
  const [params] = useSearchParams();
  const [chosen, setChosen] = useState<View | null>(null);
  if (!data.progress.length) return null;
  const countries = data.countries;
  const rows = countries && "rows" in countries ? countries.rows : null;
  const hasCountries = Boolean(rows?.length);
  const view: View = hasCountries && (chosen ?? params.get("view")) !== "languages" ? "countries" : "languages";
  // Only the view changes: the address keeps it (for "back"), without loading the page again.
  const choose = (next: View) => {
    setChosen(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  };
  // Where customers read each language (the countries whose market offers it).
  const countriesOf = new Map<string, string[]>();
  for (const row of rows ?? []) {
    for (const language of row.languages) {
      if (language.available && !language.primary) countriesOf.set(language.locale, [...(countriesOf.get(language.locale) ?? []), i18n.country(row.code, row.name)]);
    }
  }
  const running = new Map<string, string[]>();
  for (const job of data.jobs) {
    const areas = running.get(job.locale) ?? [];
    const area = jobArea(i18n, job.resourceType);
    if (!areas.includes(area)) running.set(job.locale, [...areas, area]);
  }
  const shared = { i18n, languages: data.progress, running, primary: primaryName(data, i18n) };
  return (
    <s-query-container>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="base" alignItems="end" justifyItems="start">
          <s-stack direction="block" gap="small-500">
            <h2 style={{ ...BIG_HEADING, fontSize: 17, lineHeight: "24px", fontWeight: 650 }}>
              {view === "countries" ? t("overview.places.countries.heading") : t("overview.places.languages.heading")}
            </h2>
            <s-text color="subdued">{view === "countries" ? t("overview.places.countries.intro") : t("overview.places.languages.intro")}</s-text>
          </s-stack>
          {hasCountries ? <ViewSwitch view={view} onChange={choose} i18n={i18n} /> : null}
        </s-grid>
        {countries && !countries.access ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="globe" color="subdued" size="small" />
            <s-text color="subdued">{t("overview.places.access")}</s-text>
            <access.Form method="post" action="/app/markets">
              <s-button type="submit" {...(access.state !== "idle" ? { loading: true } : {})}>
                {t("overview.places.access.allow")}
              </s-button>
            </access.Form>
          </s-stack>
        ) : countries && "error" in countries ? (
          <s-banner tone="warning">{t("overview.countries.error")}</s-banner>
        ) : rows && !rows.length ? (
          <s-text color="subdued">{t("overview.countries.none")}</s-text>
        ) : null}
        <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="small-200" alignItems="center">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-icon type="sort" color="subdued" size="small" />
            <s-text color="subdued">{t("overview.places.sort")}</s-text>
          </s-stack>
          {view === "countries" ? <s-text color="subdued">{t("overview.places.countryNote")}</s-text> : null}
        </s-grid>
        {view === "countries" && rows ? (
          <CountryCards {...shared} countries={rows} freeLanguages={data.remainingLocales} maxLanguages={data.maxLocales} />
        ) : (
          <LanguageCards {...shared} countriesOf={countriesOf} marketCountries={marketCountries} />
        )}
      </s-stack>
    </s-query-container>
  );
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const revalidator = useRevalidator();
  const recounter = useFetcher<{ ok?: true; error?: string }>();
  const recountStatus = useRef<HTMLDivElement>(null);
  const usagePercent = data.usage.limit ? (data.usage.used / data.usage.limit) * 100 : 100;
  const m = data.measurement;
  const countryRows = data.countries && "rows" in data.countries ? data.countries.rows : null;
  const marketCountries = (countryRows ?? []).map((c) => c.code);

  // Follow a count or the running translations while they're under way; nothing to follow otherwise.
  const poll = POLL_MS[m.state] ?? (data.activeJobs > 0 ? JOBS_POLL_MS : undefined);
  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, poll);
    return () => clearInterval(timer);
  }, [poll, revalidator]);

  // The button that started the count is gone: keep the focus on what says how it goes.
  useEffect(() => {
    if (recounter.state === "idle" && recounter.data?.ok) recountStatus.current?.focus();
  }, [recounter.state, recounter.data]);

  // A store counted before counts again from the header, unless the next step already offers it.
  const counted = data.measuredAt !== null && data.next?.id !== "measure";
  const canRecount = counted && data.jobsAvailable && data.next?.id !== "unread" && !MEASURING.has(m.state);
  const subtitle = [
    data.shopName,
    data.primaryLocale ? t("overview.header.primary", { language: upperFirst(primaryName(data, i18n)) }) : null,
    countryRows?.length ? t("overview.header.countries", { count: countryRows.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <s-page heading={t("common.nav.overview")} inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="base" alignItems="center" justifyItems="start">
            <s-stack direction="block" gap="small-500">
              <h1 style={BIG_HEADING}>{t("common.nav.overview")}</h1>
              {subtitle ? <s-text color="subdued">{subtitle}</s-text> : null}
            </s-stack>
            {canRecount ? <CountForm fetcher={recounter} data={data} label={t("overview.header.recount")} primary={false} /> : null}
          </s-grid>
        </s-query-container>

        {recounter.data?.error ? <s-banner tone="critical">{t("overview.scan.startFailed")}</s-banner> : null}
        {data.aiAvailable && data.usage.level === "exhausted" ? (
          <s-banner tone="critical" heading={t(data.usage.trialEndsAt ? "overview.banner.exhausted.headingTrial" : "overview.banner.exhausted.heading")}>
            <s-paragraph>
              {data.usage.trialEndsAt ? t("overview.banner.exhausted.bodyTrial", { date: i18n.date(data.usage.trialEndsAt) }) : t("overview.banner.exhausted.body")}{" "}
              <s-link href="/app/plan">{t("common.action.changePlan")}</s-link>
            </s-paragraph>
          </s-banner>
        ) : data.aiAvailable && data.usage.level === "high" ? (
          <s-banner tone="warning" heading={t("overview.banner.high.heading", { percent: Math.floor(usagePercent) })}>
            <s-paragraph>
              {t("overview.banner.high.body")} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
            </s-paragraph>
          </s-banner>
        ) : null}

        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 760px) 1fr 1fr, 1fr" gap="base">
            <StoreFigure data={data} i18n={i18n} recount={counted ? <RecountStatus data={data} i18n={i18n} statusRef={recountStatus} /> : null} />
            <NextSteps data={data} i18n={i18n} />
          </s-grid>
        </s-query-container>

        <RunningJobs data={data} i18n={i18n} marketCountries={marketCountries} />
        <Places data={data} i18n={i18n} marketCountries={marketCountries} />

        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="small-200">
            <s-text color="subdued">{data.measuredAt ? t("overview.footer.counted", { date: i18n.dateTime(data.measuredAt) }) : null}</s-text>
            <s-text color="subdued">
              {data.aiAvailable ? t("overview.usage.characters", { used: data.usage.used, limit: data.usage.limit }) : t("overview.usage.notConfigured")}
            </s-text>
          </s-grid>
        </s-query-container>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
