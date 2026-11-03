/**
 * A job's page (Redesign 3, Redesign 4): the hero by state (the ring with
 * what ended well, or a queued job's clock), its title and lines, the
 * legend, and the Next panel with at most three numbered steps
 * (app/lib/job-view.ts heroModel); then the items that need the merchant
 * (the hero's "listed below" and its button lead there), the stats with
 * their icons, and the results in detail: the table folded, the CSV report
 * and the support reference always in view. While the job runs (or a
 * cancelled job's items still settle) the page refreshes itself; a stop that
 * waits for the daily reset is looked at again once it has passed. Styles in
 * app/styles/ui.css (the Jobs section).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shopBilling } from "../.server/billing/billing";
import { cancelJob, getJobForShop, jobOutcomes, jobPendingDrafts, listProblemItems } from "../.server/jobs/bulk-jobs";
import { BackgroundJobsUnavailableError, retryBulkJob } from "../.server/jobs/start-job";
import { stopFix, stopFixContext, stopResumesAt } from "../.server/jobs/stop-fix";
import { storedLocaleNames } from "../.server/locales/shop-locales";
import { backgroundJobsRunning } from "../.server/queue/client";
import { settle } from "../.server/shopify/preview-images";
import { PREVIEW_NODE_TYPES, readPreviewNodes } from "../.server/shopify/preview-nodes";
import { requireShop } from "../.server/shopify/require-shop";
import { nextCheck } from "../.server/smart/config";
import { showToast } from "../components/app-bridge";
import { Button } from "../components/Button";
import { ConfirmModal } from "../components/ConfirmModal";
import { STATE_COLOURS } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { IconSquare } from "../components/IconSquare";
import { GroupIcon, groupSegments, Legend, OriginBadges, StateBadge, useJobWords, type JobWords } from "../components/jobs/JobLooks";
import { TintMark } from "../components/jobs/TintMark";
import { Breadcrumbs, NumberedSteps } from "../components/LanguageLayout";
import { InlineNotice, More } from "../components/SettingsParts";
import { Strong } from "../components/Type";
import { itemOutcome, jobErrorMessage } from "../i18n/labels";
import { reliableEta } from "../lib/eta";
import {
  cancelBody,
  finishTarget,
  heroModel,
  itemName,
  jobKindLabel,
  jobName,
  jobOrigin,
  outcomeGroups,
  problemsHeading,
  resumeCheckDelay,
  ringFigure,
  startedText,
  stopGroup,
  visibleStats,
  type HeroLine,
  type HeroModel,
  type HeroStrip,
  type JobGroups,
  type NextPanel,
  type PanelFoot,
  type Step,
  type StopFacts,
} from "../lib/job-view";
import { usesOwnKeys } from "../lib/plans";
import { editorPathFor, numericId } from "../lib/resource-kinds";

const ACTIVE = new Set(["PENDING", "DISCOVERING", "RUNNING"]);
const CANCEL_MODAL = "job-cancel";
const POLL_MS = 3000;
const SMART_BUDGETS = new Set(["SMART_BUDGET_DAILY", "SMART_BUDGET_MONTHLY"]);
/** The report's address stays usable this long after its download starts. */
const REPORT_URL_MS = 10_000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const now = new Date();
  const [outcomes, pending, problems, names, billing, workerRunning] = await Promise.all([
    jobOutcomes(shop.id, job.id),
    jobPendingDrafts(shop.id, job.id),
    listProblemItems(shop.id, job.id),
    storedLocaleNames(shop.id),
    shopBilling(admin, shop),
    // Only a queued job waits for background jobs.
    job.status === "PENDING" ? backgroundJobsRunning() : Promise.resolve(true),
  ]);

  // A stop: whether its cause is fixed by now, when a limit goes on by itself, a smart budget's next check.
  let stop: { fixed: boolean | null; resumesAt: string | null; nextCheckAt: string | null } | null = null;
  if (job.status === "FAILED") {
    const group = stopGroup(job.errorCode);
    const context = stopFixContext({ shopId: shop.id, billing, now })(job);
    const fixed = await stopFix(group, context);
    const config = SMART_BUDGETS.has(group) ? await context.smartConfig().catch(() => null) : null;
    stop = {
      fixed,
      resumesAt: stopResumesAt(group, now)?.toISOString() ?? null,
      nextCheckAt: config ? (nextCheck(config, now)?.toISOString() ?? null) : null,
    };
  }

  // The problem items' names and pictures, read live (Linguva stores no merchant text); ids when Shopify can't be read.
  const readable = PREVIEW_NODE_TYPES.has(job.resourceType) ? problems.map((p) => p.resourceGid) : [];
  const nodes = readable.length ? await settle(shop.id, "job problems", readPreviewNodes(admin, [...new Set(readable)], job.targetLocale)) : null;

  const done = job.succeededItems + job.skippedItems + job.failedItems;
  const eta = ACTIVE.has(job.status) && job.discoveryDone ? reliableEta({ done, total: job.totalItems, startedAt: job.startedAt, now }) : null;
  // A cancelled or stopped job whose items still settle: the figures still move.
  const settling = !ACTIVE.has(job.status) && outcomes.some((o) => o.status === "PENDING" || o.status === "RUNNING");

  return {
    now: now.toISOString(),
    actorId,
    names,
    job: {
      id: job.id,
      resourceType: job.resourceType,
      targetLocale: job.targetLocale,
      status: job.status,
      requestedBy: job.requestedBy,
      smartRunId: job.smartRunId,
      discoveryDone: job.discoveryDone,
      failedItems: job.failedItems,
      errorCode: job.errorCode,
      publishMode: job.publishMode,
      fieldScope: job.fieldScope,
      charsBilled: job.charsBilled,
      charsSaved: job.charsSaved,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      updatedAt: job.updatedAt.toISOString(),
    },
    outcomes,
    pending,
    stop,
    eta,
    settling,
    workerDown: !workerRunning,
    ownKeyPlan: usesOwnKeys(billing.entitlements),
    problems: problems.map((p) => {
      const node = nodes?.get(p.resourceGid) ?? null;
      return {
        id: p.id,
        href: editorPathFor(p.resourceGid, job.targetLocale, job.resourceType),
        name: node?.text ?? node?.label ?? null,
        image: node?.image?.url ?? null,
        number: numericId(p.resourceGid),
        status: p.status,
        errorCode: p.errorCode,
        attempts: p.attempts,
        // Short item reference; the worker logs carry the full item id.
        reference: p.id.slice(0, 8),
      };
    }),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const intent = (await request.formData()).get("intent");
  if (intent === "cancel") return { intent: "cancel" as const, ok: await cancelJob(shop.id, job.id) };
  if (intent === "retry") {
    try {
      const { retried, busy, busyJobId } = await retryBulkJob(shop.id, job.id);
      // The job that holds the same content and language: named in the notice, with its start.
      const other = busy && busyJobId ? await getJobForShop(shop.id, busyJobId) : null;
      return {
        intent: "retry" as const,
        ok: !busy,
        retried,
        resumed: job.status === "FAILED",
        busy: busy ? { id: other?.id ?? null, targetLocale: other?.targetLocale ?? job.targetLocale, resourceType: other?.resourceType ?? job.resourceType, since: (other?.createdAt ?? null)?.toISOString() ?? null } : null,
      };
    } catch (error) {
      if (error instanceof BackgroundJobsUnavailableError) return { intent: "retry" as const, ok: false, unavailable: true };
      throw error;
    }
  }
  return { intent: null, ok: false };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type ActionData = Awaited<ReturnType<typeof action>>;
type Fetcher = ReturnType<typeof useFetcher<typeof action>>;

/**
 * The CSV report as a file (fetch() inside the embedded app carries the session token, a plain link
 * wouldn't); false when it couldn't be loaded. Its address stays usable while the download starts.
 */
async function downloadReport(jobId: string, locale: string): Promise<boolean> {
  const response = await fetch(`/app/jobs/${jobId}/report?ui=${encodeURIComponent(locale)}`);
  if (!response.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `linguva-job-${jobId.slice(0, 8)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REPORT_URL_MS);
  return true;
}

const LIVE_DOT = { display: "inline-block", width: 8, height: 8, borderRadius: 4, background: STATE_COLOURS.complete, flex: "none" } as const;
const THUMB = { width: 40, height: 40, borderRadius: 8, objectFit: "cover", flex: "none", display: "block" } as const;

function Header({ data, words, name }: { data: Data; words: JobWords; name: string }) {
  const { t } = words.i18n;
  const { job } = data;
  const origin = jobOrigin(job, data.actorId);
  const by = origin === "you" ? t("jobs.meta.byYou") : origin === "team" ? t("jobs.meta.byTeam") : null;
  return (
    <s-query-container>
      <s-stack direction="block" gap="small-200">
        <Breadcrumbs i18n={words.i18n} trail={[{ href: "/app/jobs", label: t("jobs.detail.breadcrumb") }]} current={name} touch />
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <h1 className="lv-h1">{name}</h1>
            <StateBadge state={heroState(data)} words={words} />
            <OriginBadges job={job} words={words} />
          </s-stack>
          <s-text color="subdued">{[words.say(startedText(job)), by].filter(Boolean).join(" · ")}</s-text>
        </s-stack>
      </s-stack>
    </s-query-container>
  );
}

function groupsOf(data: Data): JobGroups {
  return outcomeGroups(data.outcomes, data.pending.items, data.job);
}

function stopFacts(data: Data): StopFacts | null {
  return data.stop ? { fixed: data.stop.fixed, resumesAt: data.stop.resumesAt, nextCheckAt: data.stop.nextCheckAt } : null;
}

function heroOf(data: Data): HeroModel {
  return heroModel(data.job, groupsOf(data), data.pending, stopFacts(data), {
    eta: data.eta,
    workerDown: data.workerDown,
    settling: data.settling,
    ownKeyPlan: data.ownKeyPlan,
    finishHref: finishTarget(data.job, data.problems),
  });
}

function heroState(data: Data) {
  return heroOf(data).state;
}

/** The ring (dashed while finding) or a queued job's clock, in the ring's place. */
function Mark({ hero, groups, words }: { hero: HeroModel; groups: JobGroups; words: JobWords }) {
  if (hero.mark.kind === "clock") {
    const caution = hero.mark.tone === "caution";
    return <TintMark icon="clock" tone={caution ? "caution" : "info"} colour={caution ? STATE_COLOURS.outdated : STATE_COLOURS.draft} size={112} />;
  }
  const figure = ringFigure(words.i18n, groups, { finding: hero.mark.dashed });
  return <CoverageRing segments={groupSegments(groups)} dashed={hero.mark.dashed} figure={figure.figure} caption={words.i18n.t(hero.mark.caption)} label={words.say(hero.mark.label)} size={112} />;
}

function Line({ line, words }: { line: HeroLine; words: JobWords }) {
  const text = line.text.map(words.say).join(" ");
  if (line.live) {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <span aria-hidden="true" style={LIVE_DOT} />
        <s-text color="subdued">{text}</s-text>
      </s-stack>
    );
  }
  if (line.tone && line.icon) {
    return (
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
        <s-icon type={line.icon} tone={line.tone} size="small" />
        <s-text>{text}</s-text>
      </s-grid>
    );
  }
  return <s-text color="subdued">{text}</s-text>;
}

/** The hero's left half: the mark, the title and its lines, then the legend. */
function Figure({ hero, groups, words }: { hero: HeroModel; groups: JobGroups; words: JobWords }) {
  return (
    <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="large" alignItems="center">
        <Mark hero={hero} groups={groups} words={words} />
        <s-stack direction="block" gap="small-300">
          <h2 className="lv-h2">{words.say(hero.title)}</h2>
          {hero.lines.map((line, i) => (
            <Line key={i} line={line} words={words} />
          ))}
        </s-stack>
      </s-grid>
      <Legend lines={hero.legend} words={words} label={words.i18n.t("jobs.legend.label")} />
    </s-stack>
  );
}

/** Retry and Resume post the same intent: only what a new try can fix goes again. */
function RetryButton({ fetcher, label, accessibilityLabel, primary }: { fetcher: Fetcher; label: string; accessibilityLabel?: string; primary: boolean }) {
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="retry" />
      <Button type="submit" variant={primary ? "primary" : "secondary"} {...(accessibilityLabel ? { accessibilityLabel } : {})} {...(busy ? { loading: true } : {})}>
        {label}
      </Button>
    </fetcher.Form>
  );
}

function stepAction(step: Step, words: JobWords, fetcher: Fetcher): ReactNode {
  const action = step.action;
  if (!action) return undefined;
  const variant = step.primary ? "primary" : "secondary";
  switch (action.kind) {
    case "link":
      return (
        <Button variant={variant} href={action.href} {...(action.icon ? { icon: action.icon } : {})}>
          {words.say(action.label)}
        </Button>
      );
    case "retry":
      return <RetryButton fetcher={fetcher} label={words.say(action.label)} accessibilityLabel={words.say(action.accessibilityLabel)} primary={step.primary} />;
    case "resume":
      return <RetryButton fetcher={fetcher} label={words.say(action.label)} primary={step.primary} />;
    case "reload":
      return (
        <Button variant={variant} onClick={() => window.location.reload()}>
          {words.say(action.label)}
        </Button>
      );
  }
}

/** A foot's quiet button: Cancel (opens the dialog) or a link. */
function FootAction({ action, words }: { action: PanelFoot["action"]; words: JobWords }) {
  if (action.kind === "cancel") {
    return (
      <Button variant="tertiary" tone="critical" commandFor={CANCEL_MODAL} command="--show">
        {words.say(action.label)}
      </Button>
    );
  }
  return (
    <Button variant="secondary" href={action.href}>
      {words.say(action.label)}
    </Button>
  );
}

function Foot({ foot, words }: { foot: PanelFoot; words: JobWords }) {
  return (
    <s-query-container>
      <s-grid gridTemplateColumns={`@container (inline-size > ${foot.wide}px) 1fr auto, 1fr`} gap="small-200 base" alignItems="center" justifyItems="start">
        <s-text color="subdued">{words.say(foot.text)}</s-text>
        <FootAction action={foot.action} words={words} />
      </s-grid>
    </s-query-container>
  );
}

function Panel({ panel, words, fetcher }: { panel: NextPanel; words: JobWords; fetcher: Fetcher }) {
  const { t } = words.i18n;
  return (
    <s-stack direction="block" gap="base">
      <s-heading>{t(panel.heading)}</s-heading>
      <NumberedSteps
        steps={panel.steps.map((step) => ({ key: step.id, title: words.say(step.title), detail: step.text.map(words.say).join(" ") || undefined, action: stepAction(step, words, fetcher) }))}
      />
      {panel.fold ? <More summary={t(panel.fold.summary)}>{<s-text color="subdued">{jobErrorMessage(words.i18n, panel.fold.code) ?? t("jobs.stop.UNKNOWN.help")}</s-text>}</More> : null}
      {panel.foot ? (
        <>
          <s-divider />
          <Foot foot={panel.foot} words={words} />
        </>
      ) : null}
    </s-stack>
  );
}

function Strip({ strip, words }: { strip: HeroStrip; words: JobWords }) {
  if (strip.kind === "foot") return <Foot foot={strip.foot} words={words} />;
  return (
    <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
        {strip.icon === "done" ? <s-icon type="check-circle" tone="success" /> : <s-icon type="info" color="subdued" />}
        <s-stack direction="block" gap="small-500">
          <Strong>{words.say(strip.title)}</Strong>
          <s-text color="subdued">{words.say(strip.text)}</s-text>
        </s-stack>
      </s-grid>
      {strip.action ? (
        <s-stack direction="inline">
          <FootAction action={strip.action} words={words} />
        </s-stack>
      ) : null}
    </s-stack>
  );
}

/** The stats, each with its icon in a grey square; the ones there are share the row (two to a row on a phone). */
function Stats({ data, words }: { data: Data; words: JobWords }) {
  const stats = visibleStats(data.job, { now: data.now, ownKeyPlan: data.ownKeyPlan });
  if (!stats) return null;
  return (
    <s-section accessibilityLabel={words.i18n.t("jobs.stats.label")}>
      <div className="lv-jobstats">
        {stats.map((stat) => (
          <div key={stat.name.key} className="lv-jobstats__item">
            <IconSquare icon={stat.icon} size={36} />
            <s-stack direction="block" gap="small-500">
              <s-text color="subdued">{words.say(stat.name)}</s-text>
              <span className="lv-jobstats__value">{words.value(stat.value)}</span>
              {stat.note ? <span className="lv-caption">{words.say(stat.note)}</span> : null}
            </s-stack>
          </div>
        ))}
      </div>
    </s-section>
  );
}

/** The items left for the merchant: each opens in the editor. */
function Problems({ data, groups, words }: { data: Data; groups: JobGroups; words: JobWords }) {
  const { t } = words.i18n;
  const head = problemsHeading(data.job, groups);
  if (!head || !data.problems.length) return null;
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-500">
          <h2 id="problems-heading" tabIndex={-1} className="lv-h2 lv-jobs-anchor">
            {words.say(head.heading)}
          </h2>
          <s-text color="subdued">{head.text.map(words.say).join(" ")}</s-text>
        </s-stack>
        <ul aria-labelledby="problems-heading" className="lv-jobs-rows">
          {data.problems.map((p) => {
            const name = p.name ?? itemName(words.i18n, data.job.resourceType, p.number);
            const outcome = itemOutcome(words.i18n, p.status, p.errorCode) || t("jobs.detail.failed.unknown");
            const failed = p.status === "FAILED" || p.status === "DEAD";
            const row = (
              <s-grid gridTemplateColumns={p.image ? "auto auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr) auto"} gap="small-200" alignItems="center">
                <GroupIcon group={failed ? "failed" : "look"} />
                {p.image ? <img src={p.image} alt="" style={THUMB} loading="lazy" /> : null}
                <s-stack direction="block" gap="small-500">
                  <span className="lv-strong lv-jobs-name">{name}</span>
                  <s-text color="subdued">{[outcome, p.attempts > 1 ? t("jobs.problems.attempts", { count: p.attempts }) : null].filter(Boolean).join(" · ")}</s-text>
                </s-stack>
                {p.href ? <s-icon type="chevron-right" color="subdued" size="small" /> : <span />}
              </s-grid>
            );
            return (
              <li key={p.id}>
                {p.href ? (
                  <s-clickable href={p.href} padding="small-200" borderRadius="base">
                    {row}
                  </s-clickable>
                ) : (
                  <s-box padding="small-200">{row}</s-box>
                )}
              </li>
            );
          })}
        </ul>
        {data.problems.length >= 50 ? <s-text color="subdued">{t("jobs.problems.first", { count: data.problems.length })}</s-text> : null}
      </s-stack>
    </s-section>
  );
}

/** The CSV report: a spinner while it is built, an error toast when it couldn't be loaded. */
function ReportButton({ data, words }: { data: Data; words: JobWords }) {
  const { t, locale } = words.i18n;
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    const ok = await downloadReport(data.job.id, locale).catch(() => false);
    setLoading(false);
    if (!ok) showToast(t("jobs.detail.reportFailed"), { isError: true });
  };
  return (
    <Button icon="download" onClick={() => void download()} {...(loading ? { loading: true } : {})}>
      {t("jobs.detail.outcomes.download")}
    </Button>
  );
}

/** Where a text's placeholder stands (never a character of a message). */
const SLOT = "\u0001";

/** The support reference (the start of the job's id, which the list's search finds too), with a copy button. */
function Reference({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  const reference = data.job.id.slice(0, 8);
  // The sentence around the reference, wherever the language puts it: the reference alone is what gets selected.
  const [before = "", after = ""] = t("jobs.detail.reference", { id: SLOT }).split(SLOT);
  const shown = useRef<HTMLSpanElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      showToast(t("jobs.detail.reference.copied"));
    } catch {
      // The admin's frame may refuse the clipboard: the reference is selected, ready to copy.
      const node = shown.current;
      const selection = typeof window === "undefined" ? null : window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  return (
    <span className="lv-jobreport__reference">
      <s-text color="subdued">
        {before}
        <span ref={shown}>{reference}</span>
        {after}
      </s-text>
      <Button variant="tertiary" icon="clipboard" accessibilityLabel={t("jobs.detail.reference.copy")} tooltip={t("jobs.detail.reference.copy")} onClick={() => void copy()} />
    </span>
  );
}

/** Every outcome by reason, folded (the table is drawn once opened); the CSV report and the support reference in view under it. */
function Details({ data, words }: { data: Data; words: JobWords }) {
  const { t } = words.i18n;
  const kind = jobKindLabel(words.i18n, data.job.resourceType);
  const [open, setOpen] = useState(false);
  return (
    <s-section>
      <s-stack direction="block" gap="small-200">
        <More summary={t("jobs.detail.outcomes.heading")} onToggle={setOpen}>
          {!open ? null : data.outcomes.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("jobs.report.reason")}</s-table-header>
                <s-table-header format="numeric">{kind}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.outcomes.map((o) => (
                  <s-table-row key={`${o.status}:${o.code ?? ""}`}>
                    <s-table-cell>{itemOutcome(words.i18n, o.status, o.code)}</s-table-cell>
                    <s-table-cell>{words.i18n.number(o.count)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-text color="subdued">{t("jobs.detail.outcomes.empty")}</s-text>
          )}
        </More>
        <div className="lv-jobreport">
          {data.outcomes.length ? <ReportButton data={data} words={words} /> : null}
          <Reference data={data} words={words} />
        </div>
      </s-stack>
    </s-section>
  );
}

/** What an action said, where it matters: another job holds the same content, or background jobs are missing. */
function ActionNotice({ result, data, words }: { result: ActionData | undefined; data: Data; words: JobWords }) {
  const { t } = words.i18n;
  if (!result || result.intent !== "retry") return null;
  if ("unavailable" in result && result.unavailable) {
    return (
      <s-banner tone="critical">
        <s-paragraph>{t("jobs.detail.unavailable")}</s-paragraph>
      </s-banner>
    );
  }
  if ("busy" in result && result.busy) {
    const busy = result.busy;
    const name = jobName(words.i18n, busy, data.names);
    const heading = busy.since ? t("jobs.detail.busy.heading", { name, time: words.i18n.timeRef(busy.since) }) : t("jobs.detail.retryBusy");
    return (
      <InlineNotice
        icon="info"
        tone="info"
        heading={heading}
        actions={
          busy.id ? (
            <Button href={`/app/jobs/${encodeURIComponent(busy.id)}`} accessibilityLabel={t("jobs.detail.busy.label", { name })}>
              {t("jobs.action.viewJob")}
            </Button>
          ) : null
        }
      >
        {t("jobs.detail.busy.text")}
      </InlineNotice>
    );
  }
  return null;
}

export default function JobDetail() {
  const data = useLoaderData<typeof loader>();
  const words = useJobWords(data.now, data.names);
  const { i18n } = words;
  const { t } = i18n;
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const groups = groupsOf(data);
  const hero = heroOf(data);
  const name = jobName(i18n, data.job, data.names);
  const live = ACTIVE.has(data.job.status) || data.settling;

  // Follow the job while it runs, and a cancel until its items have settled.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle" && document.visibilityState === "visible") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  // A stop waiting for the daily reset: once it has passed, look again (the resume button then appears by
  // itself), also when the page comes back into view.
  const resetAt = hero.panel?.steps.some((step) => step.id === "wait") ? (data.stop?.resumesAt ?? null) : null;
  useEffect(() => {
    if (!resetAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      if (document.visibilityState === "visible" && Date.now() >= Date.parse(resetAt)) revalidator.revalidate();
    };
    const arm = () => {
      timer = setTimeout(() => {
        look();
        arm();
      }, resumeCheckDelay(resetAt, Date.now()));
    };
    arm();
    document.addEventListener("visibilitychange", look);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, [resetAt, revalidator]);

  // Confirmations: a toast for what happened; a busy or missing worker stays on the page.
  const result = fetcher.data;
  useEffect(() => {
    if (!result || fetcher.state !== "idle") return;
    if (result.intent === "cancel" && result.ok) showToast(t("jobs.detail.cancelled"));
    if (result.intent === "retry" && result.ok && "retried" in result) {
      showToast(result.resumed ? t("jobs.detail.resumed") : t("jobs.detail.retried", { count: result.retried ?? 0 }));
    }
  }, [result, fetcher.state, t]);

  return (
    <s-page heading={name}>
      <s-link slot="breadcrumb-actions" href="/app/jobs">
        {t("jobs.detail.breadcrumb")}
      </s-link>
      <s-stack direction="block" gap="base">
        <Header data={data} words={words} name={name} />
        <ActionNotice result={fetcher.data} data={data} words={words} />

        <s-section padding="none" accessibilityLabel={t("jobs.hero.label", { name })}>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr, 1fr">
              <s-box padding="large">
                <Figure hero={hero} groups={groups} words={words} />
              </s-box>
              <s-box padding="large" background="subdued">
                {hero.panel ? <Panel panel={hero.panel} words={words} fetcher={fetcher} /> : hero.strip ? <Strip strip={hero.strip} words={words} /> : null}
              </s-box>
            </s-grid>
          </s-query-container>
        </s-section>

        {/* What the hero says is "listed below" comes right after it. */}
        <Problems data={data} groups={groups} words={words} />
        <Stats data={data} words={words} />
        <Details data={data} words={words} />
      </s-stack>

      {ACTIVE.has(data.job.status) ? (
        <ConfirmModal
          id={CANCEL_MODAL}
          heading={t("jobs.cancel.heading")}
          body={
            <s-stack direction="block" gap="small-200">
              {cancelBody(data.job, groups).map((text, i) => (
                <s-paragraph key={i}>{words.say(text)}</s-paragraph>
              ))}
            </s-stack>
          }
          confirmLabel={t("jobs.detail.cancel")}
          dismissLabel={t("jobs.cancel.keep")}
          onConfirm={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}
        />
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
