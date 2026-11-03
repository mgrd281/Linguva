/**
 * Smart Auto-Translate at a glance (Settings and its page): the effective
 * state, a preview from real values, and its actions. One primary action:
 * turn it on when it's off, check now when it's on.
 *
 * The smart page's own controls are here too, with their styles in the smart
 * schedule's section of app/styles/ui.css: a choice as square tiles with
 * native radio buttons (how often, outdated translations), the weekdays as a
 * row of square toggles, and a budget's meter.
 */
import { useId, type ReactNode } from "react";
import type { I18n, Instant } from "../i18n/i18n";
import { kindLabel } from "../i18n/labels";
import type { IconName } from "../lib/icons";
import { useI18n } from "../i18n/react";
import { languageList, upperFirst } from "../lib/name-lists";
import type { SmartStatus } from "../lib/smart-auto";
import { usagePercent } from "../lib/plan-view";
import { usageLevel } from "../lib/usage";
import { IconSquare, type Tint } from "./IconSquare";
import { ProgressBar } from "./ProgressBar";

export interface SmartCardData {
  status: SmartStatus;
  zone: string;
  /** Stored settings, null until saved once (before setup: the suggestion the form holds now). */
  config: { mode: string; times: readonly number[]; weekdays: readonly number[]; locales: readonly string[] } | null;
  nextChecks: readonly number[];
  lastSuccessAt: string | null;
  lastRun: { resourcesChanged: number; fieldsDetected: number } | null;
  translating: number;
  /** Characters waiting in the scope; null without a count (or one too old to count them: count again). */
  estimate: number | null;
  remeasure?: boolean;
  /** How its results go out (its own setting, not bulk translation's). */
  publishing?: "DRAFT" | "AUTO_PUBLISH" | null;
  /** The content types it translates (shown before setup, as the suggestion). */
  types?: readonly string[];
  /** Before setup: why the form's schedule can't be saved, shown in its place. */
  scheduleNote?: string | null;
}

/**
 * "Every day at 11:00 PM", "Every Monday and Thursday at 9:00 AM", "Jeden Tag um 23:00", "Cada día a la
 * 1:00", …: the times in the interface language's clock, as the next checks and every other time in the app.
 */
export function scheduleSummary(i18n: I18n, config: { mode: string; times: readonly number[]; weekdays: readonly number[] }): string {
  const { t } = i18n;
  const time = i18n.clockRef(config.times[0] ?? 0);
  const days = (style: "long" | "short") => languageList(i18n, config.weekdays.map((d) => i18n.weekday(d, style)), Infinity);
  switch (config.mode) {
    case "realtime":
      return t("automatic.schedule.realtime", { time });
    case "daily":
      return t("automatic.schedule.daily", { time });
    case "weekly":
      return config.weekdays.length === 7 ? t("automatic.schedule.daily", { time }) : t("automatic.schedule.weekly", { days: days("long"), time });
    case "custom":
      return upperFirst(
        t("automatic.schedule.custom", {
          days: config.weekdays.length === 7 ? t("automatic.schedule.everyDay") : days("short"),
          times: languageList(i18n, config.times.map((minute) => i18n.clockRef(minute)), Infinity),
        }),
      );
    default:
      return t("automatic.schedule.manual");
  }
}

/**
 * When a check was or will be, in the schedule's zone: "today, 11:00 PM" (`sentence`) or "Yesterday,
 * 12:06 AM". The zone is named only where it isn't the store's own ("… (America/New_York)"): every
 * other time in the admin is the store's.
 */
export function whenIn(i18n: I18n, at: Instant, zone: string, now: Instant, shopZone: string | null, sentence = false): string {
  const time = i18n.dayTimeIn(at, zone, now, { sentence });
  return zone === shopZone ? time : i18n.t("automatic.schedule.zone", { time, zone });
}

/** A weekday on a square toggle: "Mon", "Di", "Lun", "Mié" (the long name is its accessible name). */
export function shortWeekday(i18n: I18n, isoWeekday: number): string {
  return upperFirst(i18n.weekday(isoWeekday, "short").replace(/\.$/, ""));
}

/** What a check's failed items offer: Retry for those a new try can fix, else the job, where the editor fixes them. */
export function failedAction(run: { failed: number; retryable: number; jobs: ReadonlyArray<{ id: string; failed: number }> }): { retry: number; job: string | null } {
  const retry = Math.max(0, Math.min(run.retryable, run.failed));
  // Failures Retry can't fix: their job lists them, each with the way to the editor.
  const job = run.failed > retry ? (run.jobs.find((j) => j.failed > 0)?.id ?? run.jobs[0]?.id ?? null) : null;
  return { retry, job };
}

/** A budget's meter: how much of it the smart schedule used, in the Plan page's tones (none without a budget). */
export function budgetMeter(used: number, budget: number | null): { percent: number; tone: "success" | "warning" | "critical" } | null {
  if (!budget || budget <= 0) return null;
  const level = usageLevel(used, budget);
  return { percent: usagePercent(used, budget).percent, tone: level === "exhausted" ? "critical" : level === "high" ? "warning" : "success" };
}

const PAUSE_TEXT = {
  MANUAL: "automatic.paused.MANUAL",
  BUDGET_DAILY: "automatic.paused.BUDGET_DAILY",
  BUDGET_MONTHLY: "automatic.paused.BUDGET_MONTHLY",
  PLAN_ALLOWANCE: "automatic.paused.PLAN_ALLOWANCE",
  DAILY_CAP: "automatic.paused.DAILY_CAP",
  PROVIDER: "automatic.paused.PROVIDER",
  PLAN: "automatic.paused.PLAN",
  CONSENT: "automatic.paused.CONSENT",
  PRIMARY_LANGUAGE: "automatic.paused.PRIMARY_LANGUAGE",
} as const;

const WAITING_TEXT = {
  PLAN: "automatic.blocked.PLAN",
  CONSENT: "automatic.blocked.CONSENT",
  UNAVAILABLE: "automatic.blocked.UNAVAILABLE",
  WORKER: "automatic.blocked.WORKER",
  NO_LANGUAGE: "automatic.blocked.NO_LANGUAGE",
} as const;

export function SmartStateBadge({ status }: { status: SmartStatus }) {
  const { t } = useI18n();
  if (status.state === "on") return <s-badge tone="success" icon="check-circle">{t("automatic.state.on")}</s-badge>;
  if (status.state === "paused") return <s-badge tone="warning" icon="pause-circle">{t("automatic.state.paused")}</s-badge>;
  if (status.state === "waiting") return <s-badge tone="warning" icon="clock">{t("automatic.state.waiting")}</s-badge>;
  return <s-badge icon="minus-circle">{t("automatic.state.off")}</s-badge>;
}

/**
 * Why it is paused or waiting, and what happens next; nothing while on or
 * off. Waiting for the permission: `consentAction` grants it in place
 * (Settings); without it the banner links to Settings (the smart page). On
 * the smart page (`onChooseLanguages`), a missing or changed language leads
 * to the page's own language choice instead of Settings' button.
 */
export function SmartStateBanner({
  status,
  zone,
  consentAction,
  onChooseLanguages,
}: {
  status: SmartStatus;
  zone: string;
  consentAction?: ReactNode;
  onChooseLanguages?: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const chooseLanguages = onChooseLanguages ? (
    <s-link
      href="#smart-scope"
      onClick={(event) => {
        event.preventDefault();
        onChooseLanguages();
      }}
    >
      {t("automatic.blocked.chooseLanguages")}
    </s-link>
  ) : null;
  if (status.state === "paused") {
    const date = status.until ? t("automatic.schedule.zone", { time: i18n.dateTimeIn(status.until, zone), zone }) : "";
    return (
      <s-banner tone="warning" heading={t("automatic.paused.heading")}>
        <s-paragraph>
          {t(PAUSE_TEXT[status.reason], { date })} {status.until ? t("automatic.paused.after") : null}
          {status.reason === "PRIMARY_LANGUAGE" && chooseLanguages ? <> {chooseLanguages}</> : null}
        </s-paragraph>
      </s-banner>
    );
  }
  if (status.state === "waiting") {
    const here = status.reason === "NO_LANGUAGE" && chooseLanguages;
    return (
      <s-banner tone="warning" heading={t("automatic.waiting.heading")}>
        <s-paragraph>
          {here ? t("automatic.blocked.noLanguageHere", { scope: t("automatic.section.scope") }) : t(WAITING_TEXT[status.reason])}{" "}
          {here ? chooseLanguages : null}
          {status.reason === "PLAN" ? <s-link href="/app/plan">{t("automatic.upsell.cta")}</s-link> : null}
          {status.reason === "CONSENT" && !consentAction ? <s-link href="/app/settings?section=ai">{t("automatic.page.back")}</s-link> : null}
        </s-paragraph>
        {status.reason === "CONSENT" && consentAction ? consentAction : null}
      </s-banner>
    );
  }
  return null;
}

/** One fact of the preview: its icon, its name (subdued) and its value (semibold, like the Content page's names). */
function Fact({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
      <s-icon type={icon} color="subdued" />
      <s-stack direction="block" gap="small-500">
        <s-text color="subdued">{label}</s-text>
        <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{children}</span>
      </s-stack>
    </s-grid>
  );
}

type PreviewFact = "languages" | "schedule" | "content" | "nextCheck" | "lastSuccess" | "lastRun" | "publishing" | "waiting";

/**
 * The preview: what it does, from real values (no promises the data can't
 * back). The smart page's summary card names the schedule, the next check
 * and the languages itself once it is set up (`omit`); before that it shows
 * the suggestion the form holds, and what the first check may use
 * (`firstCheck`). Times are the schedule zone's, named only where it isn't
 * the store's (`shopZone`), with today and yesterday as words (`now`).
 */
export function SmartPreview({
  data,
  languageNames,
  omit = [],
  now,
  shopZone,
  firstCheck = false,
}: {
  data: SmartCardData;
  languageNames: ReadonlyMap<string, string>;
  omit?: readonly PreviewFact[];
  now: Instant;
  shopZone: string | null;
  firstCheck?: boolean;
}) {
  const i18n = useI18n();
  const { t, number } = i18n;
  const config = data.config;
  const languages = config ? config.locales.map((l) => languageNames.get(l) ?? l) : [];
  const shown = (fact: PreviewFact) => !omit.includes(fact);
  return (
    <s-box padding="base" background="subdued" borderRadius="large-100">
      <s-query-container>
        {/* Polaris writes each condition as its own rule: the wider one comes last so it wins. */}
        <s-grid gridTemplateColumns="@container (inline-size > 520px) 1fr 1fr, (inline-size > 860px) 1fr 1fr 1fr, 1fr" gap="base">
          {shown("schedule") ? (
            <Fact icon="calendar-time" label={t("automatic.preview.schedule")}>
              {data.scheduleNote ? <s-text tone="caution">{data.scheduleNote}</s-text> : config ? scheduleSummary(i18n, config) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {shown("languages") ? (
            <Fact icon="language" label={t("automatic.preview.languages")}>
              {languages.length ? languageList(i18n, languages, Infinity) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {data.types && shown("content") ? (
            <Fact icon="content" label={t("automatic.types.label")}>
              {data.types.length ? languageList(i18n, data.types.map((type) => kindLabel(i18n, type)), Infinity) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {shown("nextCheck") ? (
            <Fact icon="clock" label={t("automatic.preview.nextCheck")}>
              {data.nextChecks[0] !== undefined ? whenIn(i18n, data.nextChecks[0], data.zone, now, shopZone) : t("automatic.preview.noCheck")}
            </Fact>
          ) : null}
          {shown("lastSuccess") ? (
            <Fact icon="calendar-check" label={t("automatic.preview.lastSuccess")}>
              {data.lastSuccessAt ? whenIn(i18n, data.lastSuccessAt, data.zone, now, shopZone) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {shown("lastRun") ? (
            <Fact icon="search" label={t("automatic.preview.lastRun")}>
              {data.lastRun
                ? t("automatic.preview.found", {
                    count: data.lastRun.resourcesChanged,
                    fields: t("automatic.preview.fields", { count: data.lastRun.fieldsDetected }),
                  })
                : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {/* Publishing in the option's own words ("Review first"), with its icon. */}
          {data.publishing && shown("publishing") ? (
            <Fact icon={data.publishing === "AUTO_PUBLISH" ? "send" : "eye-check-mark"} label={t("automatic.preview.publishing")}>
              {data.publishing === "AUTO_PUBLISH" ? <s-text tone="caution">{t("settings.publish.auto.title")}</s-text> : t("settings.publish.review.title")}
            </Fact>
          ) : null}
          {data.translating > 0 ? (
            <Fact icon="in-progress" label={t("automatic.preview.translating")}>
              {t("automatic.preview.items", { count: data.translating })}
            </Fact>
          ) : null}
          {shown("waiting") ? (
            <Fact icon="clock" label={firstCheck ? t("automatic.preview.firstCheck") : t("automatic.preview.waiting")}>
              {data.estimate !== null ? (
                t("automatic.preview.chars", { chars: number(data.estimate) })
              ) : (
                <>
                  {t(data.remeasure ? "automatic.preview.measureAgain" : "automatic.preview.notMeasured")}{" "}
                  {/* The link stays in one piece. */}
                  <span style={{ fontWeight: 400, whiteSpace: "nowrap" }}>
                    <s-link href="/app/coverage">{t("automatic.preview.measure")}</s-link>
                  </span>
                </>
              )}
            </Fact>
          ) : null}
        </s-grid>
      </s-query-container>
    </s-box>
  );
}

/** One choice of a set of tiles. */
export interface ChoiceTile {
  value: string;
  name: string;
  /** One short line under the name. */
  line: string;
  icon?: IconName;
  tint?: Tint;
}

/**
 * A choice as square tiles (the smart page's "How often", its outdated
 * translations): native radio buttons in a fieldset, so the form posts the
 * chosen value, the arrow keys move between the tiles and a screen reader
 * hears the group's name with each one. Each tile is one label: its icon in
 * a tinted square, a radio mark, its name and one line (the radio's
 * accessible name is the name, its description the line). The chosen one is framed in blue
 * like the current section's tile. Uncontrolled (defaultValue): the form's
 * change event says a choice was made, as for the Segmented control. Five
 * in a row on a wide card, three on a tablet, two on a phone; tiles without
 * an icon show their radio mark beside the name.
 */
export function ChoiceTiles({
  name,
  legend,
  legendHidden = false,
  options,
  defaultValue,
  disabled = false,
}: {
  name: string;
  /** The group's name ("How often"), visible unless a heading above says it (`legendHidden`). */
  legend: string;
  legendHidden?: boolean;
  options: readonly ChoiceTile[];
  defaultValue: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="lv-smart-choice" disabled={disabled}>
      <legend className={legendHidden ? "lv-sr" : "lv-smart-choice__legend"}>{legend}</legend>
      <div className="lv-smart-choice__wrap">
        <div className="lv-smart-choice__grid" data-count={options.length}>
          {options.map((option) => {
            // The radio is named by the tile's name; its line is the description (read after the name).
            const lineId = `${id}-${option.value}`;
            const line = (
              <span id={lineId} className="lv-smart-tile__line" aria-hidden="true">
                {option.line}
              </span>
            );
            return (
              <label key={option.value} className="lv-smart-tile" data-choice={option.value}>
                <input
                  type="radio"
                  className="lv-smart-tile__input"
                  name={name}
                  value={option.value}
                  defaultChecked={option.value === defaultValue}
                  disabled={disabled}
                  aria-describedby={lineId}
                />
                {option.icon ? (
                  <span className="lv-smart-tile__face">
                    <span className="lv-smart-tile__top" aria-hidden="true">
                      <IconSquare icon={option.icon} tint={option.tint ?? "grey"} size={36} />
                      <span className="lv-smart-tile__radio" />
                    </span>
                    <span className="lv-smart-tile__name">{option.name}</span>
                    {line}
                  </span>
                ) : (
                  <span className="lv-smart-tile__face lv-smart-tile__face--plain">
                    <span className="lv-smart-tile__radio" aria-hidden="true" />
                    <span className="lv-smart-tile__text">
                      <span className="lv-smart-tile__name">{option.name}</span>
                      {line}
                    </span>
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * The weekdays as one row of square toggles ("Mon … Sun"): native
 * checkboxes named `name`, each with the full day as its accessible name
 * ("Tuesday"), the chosen ones in the blue chosen look. 40 px high, 44 px on
 * a touch screen. Uncontrolled: `checked` is what they show when they appear.
 */
export function DayToggles({
  name,
  legend,
  checked,
  disabled = false,
  errorId,
}: {
  name: string;
  legend: string;
  checked: readonly number[];
  disabled?: boolean;
  /** The id of the error under the row, while there is one. */
  errorId?: string;
}) {
  const i18n = useI18n();
  return (
    <fieldset className="lv-smart-days" disabled={disabled} {...(errorId ? { "aria-describedby": errorId } : {})}>
      <legend className="lv-smart-days__legend">{legend}</legend>
      <div className="lv-smart-days__row">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <label key={day} className="lv-smart-day">
            <input
              type="checkbox"
              className="lv-smart-day__input"
              name={name}
              value={String(day)}
              aria-label={i18n.weekday(day)}
              defaultChecked={checked.includes(day)}
              disabled={disabled}
            />
            <span className="lv-smart-day__face">{shortWeekday(i18n, day)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * How much of a budget the smart schedule used ("Used today · 12,400 of 50,000"), with the Plan page's
 * meter; without a budget the figure alone and that none is set.
 */
export function BudgetMeter({ label, used, budget }: { label: string; used: number; budget: number | null }) {
  const { t, number } = useI18n();
  const meter = budgetMeter(used, budget);
  const of = budget ? t("automatic.budget.ofBudget", { budget: number(budget) }) : `· ${t("automatic.budget.noLimit")}`;
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" justifyContent="space-between" alignItems="baseline" gap="small-200">
        <span className="lv-strong">{label}</span>
        <span>
          <span className="lv-figure-row">{number(used)}</span> <s-text color="subdued">{of}</s-text>
        </span>
      </s-stack>
      {meter ? <ProgressBar value={meter.percent} label={`${label}: ${number(used)} ${of}`} tone={meter.tone} /> : null}
    </s-stack>
  );
}

/** The text for a refused smart action or form (the same on Settings and the smart page). */
export function smartErrorText(i18n: I18n, error: string): string {
  const { t } = i18n;
  if (error === "PLAN") return t("automatic.blocked.PLAN");
  if (error === "CONSENT") return t("automatic.blocked.CONSENT");
  if (error === "UNAVAILABLE") return t("automatic.blocked.UNAVAILABLE");
  if (error === "PRIMARY_LANGUAGE") return t("automatic.paused.PRIMARY_LANGUAGE");
  if (error === "INVALID") return t("automatic.error.CHANGED");
  return t(`automatic.error.${error}` as "automatic.error.CHANGED");
}

/** The confirmation toast for a smart action's result (problems stay on the page). */
export function smartToast(t: I18n["t"], result: { ok: boolean; done?: string; count?: number } | undefined): string | null {
  if (!result?.ok || !result.done) return null;
  switch (result.done) {
    case "saved":
      return t("automatic.toast.saved");
    case "savedOn":
      return t("automatic.toast.savedOn");
    case "on":
      return t("automatic.toast.on");
    case "off":
      return t("automatic.toast.off");
    case "paused":
      return t("automatic.toast.paused");
    case "resumed":
      return t("automatic.toast.resumed");
    case "started":
      return t("automatic.toast.started");
    case "waiting":
      return t("automatic.toast.waiting");
    case "active":
      return t("automatic.toast.active");
    case "removed":
      return t("automatic.toast.removed");
    case "retried":
      return t("automatic.toast.retried", { count: result.count ?? 0 });
    default:
      return null;
  }
}
