/**
 * The Jobs list (Redesign 3): what needs the merchant first (the attention
 * card), then the tabs with their figures, the filters and the search; on
 * "All" the jobs running now (they update by themselves), then the history
 * by day in the store's time zone, with the jobs of one check or one click
 * together. A row says what came out in words (app/lib/job-view.ts
 * rowResult, rowMeta); pages go both ways by keyset.
 */
import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useNavigate, useRevalidator, useSubmit } from "react-router";
import type { TranslationJob } from "@prisma/client";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shopBilling } from "../.server/billing/billing";
import { getJobForShop, jobCounts, jobsAttention, listActiveJobs, listJobsPage, rowOutcomesByJob } from "../.server/jobs/bulk-jobs";
import { searchJobIds } from "../.server/jobs/job-search";
import { BackgroundJobsUnavailableError, retryBulkJob } from "../.server/jobs/start-job";
import { stopFix, stopFixContext, stopResumesAt } from "../.server/jobs/stop-fix";
import { storedShopLocales } from "../.server/locales/shop-locales";
import { peekMarketCountries } from "../.server/markets/countries";
import { backgroundJobsRunning } from "../.server/queue/client";
import { countPendingDrafts } from "../.server/review/drafts";
import { requireShop } from "../.server/shopify/require-shop";
import { shopTimeZone } from "../.server/shopify/shop-time-zone";
import { nextCheck } from "../.server/smart/config";
import { showToast } from "../components/app-bridge";
import { categoryName } from "../components/CategoryCard";
import { CARD } from "../components/ContentTiles";
import { STATE_COLOURS } from "../components/Coverage";
import { Flag } from "../components/Flag";
import { GroupBar, GroupIcon, OriginBadges, useJobWords, type JobWords } from "../components/jobs/JobLooks";
import { TintMark } from "../components/jobs/TintMark";
import { BIG_HEADING, PLAIN_LIST } from "../components/LanguageLayout";
import { InlineNotice } from "../components/SettingsParts";
import { reliableEta } from "../lib/eta";
import { localeCountry } from "../lib/flags";
import {
  attentionVerdict,
  clusters,
  dayGroups,
  filterCount,
  JOB_BY,
  JOB_PERIODS,
  JOB_TABS,
  JOB_TYPES,
  jobName,
  jobsFilter,
  jobsHref,
  jobState,
  parseJobsQuery,
  rowCounts,
  rowMeta,
  rowResult,
  stopGroup,
  type AttentionModel,
  type JobCluster,
  type JobRowView,
  type JobTab,
  type RowOutcomeCounts,
  type StopFacts,
} from "../lib/job-view";
import { CATEGORIES, CATEGORY_IDS } from "../lib/language-categories";
import { ALL } from "../lib/select-all";
import { Button } from "../components/Button";

/** Jobs per page of the history; the live group shows up to 20 (one more says there are others). */
const PAGE_SIZE = 25;
const LIVE_SHOWN = 20;
const POLL_MS = 5000;
const SMART_BUDGETS = new Set(["SMART_BUDGET_DAILY", "SMART_BUDGET_MONTHLY"]);

/** A job as the list's rows need it (JSON-safe). */
function rowJob(job: TranslationJob) {
  return {
    id: job.id,
    resourceType: job.resourceType,
    targetLocale: job.targetLocale,
    status: job.status,
    requestedBy: job.requestedBy,
    smartRunId: job.smartRunId,
    idempotencyKey: job.idempotencyKey,
    discoveryDone: job.discoveryDone,
    totalItems: job.totalItems,
    succeededItems: job.succeededItems,
    skippedItems: job.skippedItems,
    failedItems: job.failedItems,
    publishMode: job.publishMode,
    fieldScope: job.fieldScope,
    errorCode: job.errorCode,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

/** The content areas a job can belong to (each has a type a job can have). */
const AREAS = CATEGORY_IDS.filter((id) => CATEGORIES[id].types.some((type) => JOB_TYPES.includes(type)));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const query = parseJobsQuery(new URL(request.url));
  const now = new Date();
  const [timeZone, locales, billing] = await Promise.all([shopTimeZone(shop.id, admin), storedShopLocales(shop.id), shopBilling(admin, shop)]);
  // A search narrows every tab to the jobs it found (names through Shopify, references in the database).
  const search = query.q ? await searchJobIds(admin, shop.id, query.q) : null;
  const filter = { ...jobsFilter(query), timeZone, now, ids: search?.ids ?? null };
  const firstPage = !query.after && !query.before;
  // Tab All: the live group on the first page, then the history (everything that isn't active).
  const withLive = query.status === "all" && firstPage;
  // The attention card is about the whole store: not on a filtered or searched view.
  const withAttention = withLive && filterCount(query) === 0 && !query.q;
  const [counts, live, page, attention, drafts, workerRunning] = await Promise.all([
    jobCounts(shop.id, filter, now),
    withLive ? listActiveJobs(shop.id, filter, LIVE_SHOWN + 1) : Promise.resolve([]),
    listJobsPage(shop.id, { ...filter, status: query.status === "all" ? "history" : query.status, cursor: query.after, before: query.before, take: PAGE_SIZE }),
    withAttention ? jobsAttention(shop.id, now) : Promise.resolve(null),
    withAttention ? countPendingDrafts(shop.id) : Promise.resolve(0),
    backgroundJobsRunning(),
  ]);
  const shown = [...live.slice(0, LIVE_SHOWN), ...page.jobs];
  const stops = attention?.stops.jobs ?? [];
  const outcomes = await rowOutcomesByJob(shop.id, [...new Set([...shown, ...stops].map((j) => j.id))]);

  // Each stop on screen: whether its cause is fixed by now (one shared context), when it goes on by itself.
  const context = stopFixContext({ shopId: shop.id, billing, now });
  const facts: Record<string, StopFacts> = {};
  for (const job of [...shown, ...stops]) {
    if (job.status !== "FAILED" || facts[job.id]) continue;
    const group = stopGroup(job.errorCode);
    const ctx = context(job);
    const config = SMART_BUDGETS.has(group) ? await ctx.smartConfig().catch(() => null) : null;
    facts[job.id] = {
      fixed: await stopFix(group, ctx),
      resumesAt: stopResumesAt(group, now)?.toISOString() ?? null,
      nextCheckAt: config ? (nextCheck(config, now)?.toISOString() ?? null) : null,
    };
  }
  const eta = (job: TranslationJob) =>
    job.status === "RUNNING" && job.discoveryDone
      ? reliableEta({ done: job.succeededItems + job.skippedItems + job.failedItems, total: job.totalItems, startedAt: job.startedAt, now })
      : null;
  const row = (job: TranslationJob) => ({ job: rowJob(job), outcomes: outcomes[job.id] ?? null, fixed: facts[job.id]?.fixed ?? null, eta: eta(job) });

  return {
    now: now.toISOString(),
    actorId,
    query,
    names: locales.names,
    targets: locales.targets ?? [],
    marketCountries: peekMarketCountries(shop.id),
    counts,
    workerDown: !workerRunning,
    search: search ? { partial: search.partial, short: search.ids === null } : null,
    live: live.slice(0, LIVE_SHOWN).map(row),
    liveMore: live.length > LIVE_SHOWN,
    rows: page.jobs.map(row),
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
    attention: attention
      ? {
          stops: stops.map((job) => ({ job: rowJob(job), outcomes: outcomes[job.id] ?? null, facts: facts[job.id] ?? { fixed: null } })),
          stopCount: attention.stops.count,
          failed: { ...attention.failed, jobs: attention.failed.jobs.map((j) => ({ id: j.id, targetLocale: j.targetLocale, resourceType: j.resourceType })) },
          drafts,
        }
      : null,
  };
};

/** Resume a stopped job from the attention card: the same rule as its page's Resume. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const job = await getJobForShop(shop.id, String(form.get("job") ?? ""));
  if (form.get("intent") !== "resume" || !job || job.status !== "FAILED") return { ok: false, busy: null as string | null, unavailable: false };
  try {
    const { busy, busyJobId } = await retryBulkJob(shop.id, job.id);
    return { ok: !busy, busy: busy ? (busyJobId ?? job.id) : null, unavailable: false };
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { ok: false, busy: null, unavailable: true };
    throw error;
  }
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Row = Data["rows"][number];
type Resumer = ReturnType<typeof useFetcher<typeof action>>;

const STRONG = { fontWeight: 600 } as const;
const SUB_HEADING = { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 650 } as const;
const CARD_HEADING = { margin: 0, fontSize: 16, lineHeight: "24px", fontWeight: 650 } as const;
const COUNT = { fontVariantNumeric: "tabular-nums" } as const;
const LIVE_DOT = { display: "inline-block", width: 8, height: 8, borderRadius: 4, background: STATE_COLOURS.complete, flex: "none" } as const;
/** One copy of a row for each width (only one is displayed, so only one is read). */
const WIDE = "@container (inline-size > 640px) auto, none";
const NARROW = "@container (inline-size > 640px) none, auto";
const MARK_COLOUR = { critical: STATE_COLOURS.failed, warning: STATE_COLOURS.outdated, caution: STATE_COLOURS.outdated, info: STATE_COLOURS.draft } as const;

function rowView(row: Row): JobRowView {
  const groups = rowCounts(row.job, row.outcomes as RowOutcomeCounts | null);
  return { job: row.job, state: jobState(row.job, groups.counts.look, row.fixed), groups };
}

const jobHref = (id: string) => `/app/jobs/${encodeURIComponent(id)}`;

// ─── Rows ────────────────────────────────────────────────────────────────────

function Result({ view, words, workerDown }: { view: JobRowView; words: JobWords; workerDown: boolean }) {
  const result = rowResult(view, { workerDown });
  if (result.live) {
    return (
      <s-stack direction="block" gap="small-300">
        <s-text color={result.subdued ? "subdued" : "base"}>{words.say(result.text)}</s-text>
        {result.bar ? <GroupBar groups={view.groups} striped={result.bar === "striped"} /> : null}
      </s-stack>
    );
  }
  return (
    <s-stack direction="block" gap="small-500">
      {result.fragments.map((fragment, i) => (
        <s-stack key={i} direction="inline" gap="small-200" alignItems="center">
          <GroupIcon group={fragment.look} />
          <s-text color={fragment.tone === "subdued" ? "subdued" : "base"}>{words.say(fragment.text)}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

function JobRow({ row, data, words, inCluster = false }: { row: Row; data: Data; words: JobWords; inCluster?: boolean }) {
  const view = rowView(row);
  const name = jobName(words.i18n, row.job, data.names);
  const meta = (narrow: boolean) => rowMeta(view, { actorId: data.actorId, eta: row.eta, inCluster, narrow }).map(words.value).join(" · ");
  const flag = <Flag country={localeCountry(row.job.targetLocale, data.marketCountries)} fallback={row.job.targetLocale} size={28} />;
  return (
    <s-clickable href={jobHref(row.job.id)} padding="small-200 base">
      <s-box display={WIDE}>
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) minmax(0, 300px) auto" gap="base" alignItems="center">
          {flag}
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <span style={STRONG}>{name}</span>
              <OriginBadges job={row.job} words={words} skipOrigin={inCluster} />
            </s-stack>
            <s-text color="subdued">{meta(false)}</s-text>
          </s-stack>
          <Result view={view} words={words} workerDown={data.workerDown} />
          <s-icon type="chevron-right" color="subdued" size="small" />
        </s-grid>
      </s-box>
      <s-box display={NARROW}>
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="start">
          {flag}
          <s-stack direction="block" gap="small-300">
            <span style={STRONG}>{name}</span>
            <Result view={view} words={words} workerDown={data.workerDown} />
            <s-text color="subdued">{meta(true)}</s-text>
          </s-stack>
          <s-icon type="chevron-right" color="subdued" size="small" />
        </s-grid>
      </s-box>
    </s-clickable>
  );
}

function Cluster({ cluster, data, words }: { cluster: JobCluster<Row["job"] & { row: Row }>; data: Data; words: JobWords }) {
  return (
    <s-stack direction="block" gap="none">
      <s-box padding="small-200 base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={cluster.origin === "smart" ? "calendar-time" : "list-bulleted"} color="subdued" size="small" />
          <s-text color="subdued">
            {words.say(cluster.title)} · {words.say(cluster.count)}
          </s-text>
          {cluster.link ? (
            <s-box display={WIDE}>
              <s-link href={cluster.link.href}>{words.say(cluster.link.label)}</s-link>
            </s-box>
          ) : null}
        </s-stack>
      </s-box>
      <div style={{ borderInlineStart: "3px solid var(--p-color-border, #e3e3e3)", marginInlineStart: 16 }}>
        <ul style={PLAIN_LIST}>
          {cluster.rows.map((entry) => (
            <li key={entry.id}>
              <JobRow row={entry.row} data={data} words={words} inCluster />
            </li>
          ))}
        </ul>
      </div>
    </s-stack>
  );
}

/** "Today · Monday, November 2": the day's name, then its date in the subdued colour. */
function DayTitle({ id, heading }: { id: string; heading: { title: string; detail: string } }) {
  return (
    <h3 id={id} style={SUB_HEADING}>
      {heading.title}
      {heading.detail ? (
        <span style={{ fontWeight: 450, color: "var(--p-color-text-secondary, #616161)" }}>
          {" · "}
          {heading.detail}
        </span>
      ) : null}
    </h3>
  );
}

/** Rows by store-zone day, each day with its heading and its clusters. */
function Days({ rows, data, words }: { rows: Row[]; data: Data; words: JobWords }) {
  const tied = rows.map((row) => ({ ...row.job, row }));
  return (
    <s-stack direction="block" gap="base">
      {dayGroups(tied, words.i18n.timeZone, data.now).map((day) => (
        <section key={day.day} aria-labelledby={`day-${day.day}`}>
          <s-stack direction="block" gap="small-200">
            <s-box padding="none base">
              <DayTitle id={`day-${day.day}`} heading={words.i18n.dayHeading(day.at, data.now)} />
            </s-box>
            <ul style={{ ...PLAIN_LIST, display: "grid", gap: 2 }}>
              {clusters(day.rows).map((entry) =>
                entry.kind === "row" ? (
                  <li key={entry.row.id}>
                    <JobRow row={entry.row.row} data={data} words={words} />
                  </li>
                ) : (
                  <li key={entry.cluster.key}>
                    <Cluster cluster={entry.cluster} data={data} words={words} />
                  </li>
                ),
              )}
            </ul>
          </s-stack>
        </section>
      ))}
    </s-stack>
  );
}

function LiveGroup({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  if (!data.live.length) return null;
  return (
    <section aria-labelledby="jobs-live">
      <s-stack direction="block" gap="small-200">
        <s-box padding="none base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <h3 id="jobs-live" style={SUB_HEADING}>
              {t("jobs.group.live")}
            </h3>
            <span aria-hidden="true" style={LIVE_DOT} />
            <s-text color="subdued">{t("jobs.group.liveNote")}</s-text>
          </s-stack>
        </s-box>
        <ul style={{ ...PLAIN_LIST, display: "grid", gap: 2 }}>
          {data.live.map((row) => (
            <li key={row.job.id}>
              <JobRow row={row} data={data} words={words} />
            </li>
          ))}
        </ul>
        {data.liveMore ? (
          <s-box padding="none base">
            <s-link href={jobsHref(data.query, { status: "active" })}>{t("jobs.group.liveAll", { count: data.counts.active })}</s-link>
          </s-box>
        ) : null}
      </s-stack>
    </section>
  );
}

// ─── The attention card ──────────────────────────────────────────────────────

function attentionOf(data: Data): AttentionModel | null {
  const a = data.attention;
  if (!a) return null;
  return attentionVerdict({
    stops: a.stops.map((stop) => ({ job: stop.job, groups: rowCounts(stop.job, stop.outcomes as RowOutcomeCounts | null), facts: stop.facts })),
    stopCount: a.stopCount,
    failed: a.failed,
    drafts: a.drafts,
    active: data.counts.active,
    workerDown: data.workerDown && data.counts.queued > 0,
  });
}

function Attention({ model, data, words, resumer }: { model: AttentionModel; data: Data; words: JobWords; resumer: Resumer }) {
  const { t } = words.i18n;
  const featured = model.featured;
  const primary = featured?.primary ?? null;
  return (
    <s-section accessibilityLabel={t("jobs.attention.label")}>
      <s-stack direction="block" gap="base">
        <s-query-container>
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
            <TintMark icon={model.mark.icon} tone={model.mark.tone} colour={MARK_COLOUR[model.mark.tone]} size={40} />
            <s-grid gridTemplateColumns="@container (inline-size > 520px) 1fr auto, 1fr" gap="small-200 base" alignItems="center" justifyItems="start">
              <s-stack direction="block" gap="small-500">
                <h2 style={CARD_HEADING}>{words.say(model.heading)}</h2>
                {model.text.length ? <s-text color="subdued">{model.text.map(words.say).join(" ")}</s-text> : null}
              </s-stack>
              {model.headAction ? (
                <Button variant="primary" href={model.headAction.href}>
                  {words.say(model.headAction.label)}
                </Button>
              ) : null}
            </s-grid>
          </s-grid>
        </s-query-container>
        {featured ? (
          <s-box {...CARD} padding="base">
            <s-stack direction="block" gap="small-200">
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                <Flag country={localeCountry(featured.locale, data.marketCountries)} fallback={featured.locale} size={20} />
                <s-stack direction="block" gap="small-500">
                  <span style={STRONG}>{words.say(featured.title)}</span>
                  {featured.text.map((text, i) => (
                    <s-text key={i} color="subdued">
                      {words.say(text)}
                    </s-text>
                  ))}
                </s-stack>
              </s-grid>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {primary?.kind === "link" ? (
                  <Button variant="primary" href={primary.href}>
                    {words.say(primary.label)}
                  </Button>
                ) : primary?.kind === "reload" ? (
                  <Button variant="primary" onClick={() => window.location.reload()}>
                    {words.say(primary.label)}
                  </Button>
                ) : primary?.kind === "resume" ? (
                  <resumer.Form method="post">
                    <input type="hidden" name="intent" value="resume" />
                    <input type="hidden" name="job" value={primary.jobId} />
                    <Button type="submit" variant="primary" {...(resumer.state !== "idle" ? { loading: true } : {})}>
                      {words.say(primary.label)}
                    </Button>
                  </resumer.Form>
                ) : null}
                <Button variant={featured.view.variant} href={featured.view.href}>
                  {words.say(featured.view.label)}
                </Button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : null}
        {model.rows.length ? (
          <ul style={{ ...PLAIN_LIST, display: "grid", gap: 2 }}>
            {model.rows.map((row) => (
              <li key={row.href + row.title.key}>
                <s-clickable href={row.href} padding="small-200" borderRadius="base">
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
                    <s-icon type={row.mark.icon} tone={row.mark.tone} />
                    <s-stack direction="block" gap="small-500">
                      <span style={STRONG}>{words.say(row.title)}</span>
                      <s-text color="subdued">{row.text.map(words.say).join(" ")}</s-text>
                    </s-stack>
                    <s-icon type="chevron-right" color="subdued" size="small" />
                  </s-grid>
                </s-clickable>
              </li>
            ))}
          </ul>
        ) : null}
      </s-stack>
    </s-section>
  );
}

// ─── Tabs, filters and the search ────────────────────────────────────────────

const TAB_COUNT: Readonly<Record<JobTab, keyof Data["counts"]>> = { all: "all", active: "active", problems: "problems", completed: "completed", cancelled: "cancelled" };

function Tabs({ data, words }: { data: Data; words: JobWords }) {
  const { t, number } = words.i18n;
  return (
    <nav aria-label={t("jobs.tabs.label")}>
      <ul style={{ ...PLAIN_LIST, display: "flex", gap: 4, overflowX: "auto", scrollbarWidth: "none" }}>
        {JOB_TABS.map((tab) => {
          const current = data.query.status === tab;
          const count = data.counts[TAB_COUNT[tab]];
          const content = (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <span style={{ ...(current ? STRONG : {}), whiteSpace: "nowrap" }}>{t(`jobs.tab.${tab}`)}</span>
              {tab === "problems" && count > 0 ? (
                <s-badge tone="critical">{number(count)}</s-badge>
              ) : (
                <s-text color="subdued">
                  <span style={COUNT}>{number(count)}</span>
                </s-text>
              )}
            </s-stack>
          );
          return (
            <li key={tab} style={{ flex: "none" }}>
              {current ? (
                <span aria-current="page">
                  <s-box padding="small-200 base" borderRadius="base" background="strong" minBlockSize="44px">
                    {content}
                  </s-box>
                </span>
              ) : (
                <s-clickable href={jobsHref(data.query, { status: tab })} padding="small-200 base" borderRadius="base" minBlockSize="44px">
                  {content}
                </s-clickable>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Filters({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  const submit = useSubmit();
  const form = useRef<HTMLFormElement>(null);
  const q = data.query;
  const set = filterCount(q);
  const onChange = () => {
    if (form.current) void submit(form.current, { replace: true });
  };
  const languages = [...new Set([...data.targets, ...(q.lang ? [q.lang] : [])])]
    .map((code) => ({ code, name: words.i18n.language(code, data.names[code]) }))
    .sort((a, b) => a.name.localeCompare(b.name, words.i18n.locale));
  const fields = (
    <s-grid gridTemplateColumns="@container (inline-size > 300px) 1fr 1fr, (inline-size > 760px) 1fr 1fr 1fr 1fr, 1fr" gap="small-200 base">
      <s-select name="lang" label={t("common.language")} value={q.lang ?? ALL} onChange={onChange}>
        <s-option value={ALL}>{t("common.allLanguages")}</s-option>
        {languages.map((l) => (
          <s-option key={l.code} value={l.code}>
            {l.name}
          </s-option>
        ))}
      </s-select>
      <s-select name="area" label={t("jobs.filter.area")} value={q.area ?? ALL} onChange={onChange}>
        <s-option value={ALL}>{t("jobs.filter.anyArea")}</s-option>
        {AREAS.map((id) => (
          <s-option key={id} value={id}>
            {categoryName(words.i18n, id)}
          </s-option>
        ))}
      </s-select>
      <s-select name="by" label={t("jobs.filter.by")} value={q.by ?? ALL} onChange={onChange}>
        <s-option value={ALL}>{t("jobs.filter.anyone")}</s-option>
        {JOB_BY.map((by) => (
          <s-option key={by} value={by}>
            {t(`jobs.filter.by.${by}`)}
          </s-option>
        ))}
      </s-select>
      <s-select name="since" label={t("jobs.filter.period")} value={q.since ?? ALL} onChange={onChange}>
        <s-option value={ALL}>{t("jobs.filter.anyTime")}</s-option>
        {JOB_PERIODS.map((period) => (
          <s-option key={period} value={period}>
            {t(`jobs.filter.period.${period}`)}
          </s-option>
        ))}
      </s-select>
    </s-grid>
  );
  return (
    <Form method="get" ref={form} role="search" aria-label={t("jobs.search.label")}>
      {q.status !== "all" ? <input type="hidden" name="status" value={q.status} /> : null}
      {q.type && !q.area ? <input type="hidden" name="type" value={q.type} /> : null}
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="center">
          <s-search-field name="q" label={t("jobs.search.label")} labelAccessibilityVisibility="exclusive" placeholder={t("jobs.search.placeholder")} value={q.q ?? ""} />
          <Button type="submit">{t("common.action.search")}</Button>
        </s-grid>
        {fields}
        {set || q.q ? (
          <s-stack direction="inline">
            <s-link href={jobsHref({ ...q, lang: null, area: null, type: null, by: null, since: null, q: null }, { page: 1 })}>{t("jobs.filter.clear")}</s-link>
          </s-stack>
        ) : null}
      </s-stack>
    </Form>
  );
}

function Pager({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  const q = data.query;
  if (!data.nextCursor && !data.prevCursor) return null;
  return (
    <nav aria-label={t("jobs.pagination.label")}>
      <s-box padding="none base">
        <s-stack direction="inline" gap="base" alignItems="center">
          {data.prevCursor ? (
            q.page > 2 ? (
              <Button href={jobsHref(q, { before: data.prevCursor, page: q.page - 1 })}>{t("jobs.pagination.previous")}</Button>
            ) : (
              <Button href={jobsHref(q, { after: null, before: null, page: 1 })}>{t("jobs.pagination.first")}</Button>
            )
          ) : null}
          <s-text color="subdued">{t("jobs.pagination.page", { page: q.page })}</s-text>
          {data.nextCursor ? <Button href={jobsHref(q, { after: data.nextCursor, page: q.page + 1 })}>{t("jobs.pagination.next")}</Button> : null}
        </s-stack>
      </s-box>
    </nav>
  );
}

/** No job at all: where jobs start. No match: say so, with the way back. */
function Empty({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  const filtered = filterCount(data.query) > 0 || Boolean(data.query.q);
  const nothingYet = data.counts.all === 0 && !filtered;
  const text = nothingYet ? null : filtered ? t("jobs.list.noMatches") : t(`jobs.tab.empty.${data.query.status}`);
  return (
    <s-box padding="large base">
      <s-stack direction="block" gap="base" alignItems="center">
        <TintMark icon={filtered ? "search" : "check-circle"} tone={filtered ? "info" : "success"} colour={filtered ? STATE_COLOURS.draft : STATE_COLOURS.complete} size={56} />
        {nothingYet ? (
          <s-stack direction="block" gap="small-200" alignItems="center">
            <s-text color="subdued">{t("jobs.list.emptyStart")}</s-text>
            <Button href="/app">{t("jobs.list.emptyAction")}</Button>
          </s-stack>
        ) : (
          <s-text color="subdued">{text}</s-text>
        )}
      </s-stack>
    </s-box>
  );
}

export default function Jobs() {
  const data = useLoaderData<typeof loader>();
  const words = useJobWords(data.now, data.names);
  const { t } = words.i18n;
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const resumer = useFetcher<typeof action>();
  const attention = attentionOf(data);

  // Running jobs update by themselves: the page follows them.
  const live = data.counts.active > 0;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle" && document.visibilityState === "visible") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  // Jobs just started by one click: a toast, once; the address forgets it.
  const started = data.query.started;
  useEffect(() => {
    if (!started) return;
    showToast(t("jobs.list.startedToast", { count: started }));
    void navigate(jobsHref(data.query), { replace: true, preventScrollReset: true });
  }, [started, t, navigate, data.query]);

  const resumed = resumer.data;
  useEffect(() => {
    if (resumed?.ok && resumer.state === "idle") showToast(t("jobs.detail.resumed"));
  }, [resumed, resumer.state, t]);

  const rows = data.rows;
  const showsLive = data.query.status === "all" && data.live.length > 0;
  const hasRows = rows.length > 0 || showsLive;
  return (
    <s-page heading={t("jobs.list.heading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-500">
          <h1 style={BIG_HEADING}>{t("jobs.list.heading")}</h1>
          <s-text color="subdued">{t("jobs.list.subtitle")}</s-text>
        </s-stack>

        {resumed?.unavailable ? (
          <s-banner tone="critical">
            <s-paragraph>{t("jobs.detail.unavailable")}</s-paragraph>
          </s-banner>
        ) : resumed?.busy ? (
          <InlineNotice icon="info" tone="info" heading={t("jobs.detail.retryBusy")} actions={<Button href={jobHref(resumed.busy)}>{t("jobs.action.viewJob")}</Button>} />
        ) : null}

        {attention ? <Attention model={attention} data={data} words={words} resumer={resumer} /> : null}

        <s-section padding="none">
          <s-query-container>
            <s-stack direction="block" gap="base">
              <s-box padding="base base none base">
                <s-stack direction="block" gap="base">
                  <Tabs data={data} words={words} />
                  <Filters data={data} words={words} />
                  {data.search?.short ? <s-text color="subdued">{t("jobs.search.short")}</s-text> : null}
                  {data.search?.partial ? <s-banner tone="warning">{t("jobs.search.partial")}</s-banner> : null}
                </s-stack>
              </s-box>
              {hasRows ? (
                <s-stack direction="block" gap="base">
                  {showsLive ? <LiveGroup data={data} words={words} /> : null}
                  {rows.length ? <Days rows={rows} data={data} words={words} /> : null}
                </s-stack>
              ) : (
                <Empty data={data} words={words} />
              )}
              <Pager data={data} words={words} />
              <s-box padding="none none small-200" />
            </s-stack>
          </s-query-container>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
