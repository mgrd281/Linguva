/**
 * Smart Auto-Translate at a glance (Settings and its page): the effective
 * state, a preview from real values, and its actions. One primary action:
 * turn it on when it's off, check now when it's on.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import type { IconName } from "../lib/icons";
import { useI18n } from "../i18n/react";
import { languageList, upperFirst } from "../lib/name-lists";
import { formatTime } from "../lib/schedule";
import type { SmartStatus } from "../lib/smart-auto";

export interface SmartCardData {
  status: SmartStatus;
  zone: string;
  /** Stored settings, null until saved once. */
  config: { mode: string; times: readonly number[]; weekdays: readonly number[]; locales: readonly string[] } | null;
  nextChecks: readonly number[];
  lastSuccessAt: string | null;
  lastRun: { resourcesChanged: number; fieldsDetected: number } | null;
  translating: number;
  /** Characters waiting in the scope; null without a measurement (or one too old to count them: remeasure). */
  estimate: number | null;
  remeasure?: boolean;
  /** How its results go out (its own setting, not bulk translation's). */
  publishing?: "DRAFT" | "AUTO_PUBLISH" | null;
}

/** "Every day at 23:00", "Every Monday and Thursday at 09:00", … */
export function scheduleSummary(i18n: I18n, config: { mode: string; times: readonly number[]; weekdays: readonly number[] }): string {
  const { t } = i18n;
  const time = formatTime(config.times[0] ?? 0);
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
          times: languageList(i18n, config.times.map(formatTime), Infinity),
        }),
      );
    default:
      return t("automatic.schedule.manual");
  }
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
 * (Settings); without it the banner links to Settings (the smart page).
 */
export function SmartStateBanner({ status, zone, consentAction }: { status: SmartStatus; zone: string; consentAction?: ReactNode }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (status.state === "paused") {
    const date = status.until ? t("automatic.schedule.zone", { time: i18n.dateTimeIn(status.until, zone), zone }) : "";
    return (
      <s-banner tone="warning" heading={t("automatic.paused.heading")}>
        <s-paragraph>
          {t(PAUSE_TEXT[status.reason], { date })} {status.until ? t("automatic.paused.after") : null}
        </s-paragraph>
      </s-banner>
    );
  }
  if (status.state === "waiting") {
    return (
      <s-banner tone="warning" heading={t("automatic.state.waiting")}>
        <s-paragraph>
          {t(WAITING_TEXT[status.reason])}{" "}
          {status.reason === "PLAN" ? <s-link href="/app/plan">{t("automatic.upsell.cta")}</s-link> : null}
          {status.reason === "CONSENT" && !consentAction ? <s-link href="/app/settings">{t("automatic.page.back")}</s-link> : null}
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

type PreviewFact = "languages" | "schedule" | "nextCheck" | "lastSuccess" | "lastRun" | "publishing" | "waiting";

/**
 * The preview: what it does, from real values (no promises the data can't
 * back). The smart page's summary card names the schedule, the next check
 * and the languages itself (`omit`).
 */
export function SmartPreview({ data, languageNames, omit = [] }: { data: SmartCardData; languageNames: ReadonlyMap<string, string>; omit?: readonly PreviewFact[] }) {
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
          {shown("languages") ? (
            <Fact icon="language" label={t("automatic.preview.languages")}>
              {languages.length ? languageList(i18n, languages, Infinity) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {shown("schedule") ? (
            <Fact icon="calendar" label={t("automatic.preview.schedule")}>
              {config ? scheduleSummary(i18n, config) : t("automatic.preview.none")}
            </Fact>
          ) : null}
          {shown("nextCheck") ? (
            <Fact icon="calendar-time" label={t("automatic.preview.nextCheck")}>
              {data.nextChecks[0] !== undefined
                ? t("automatic.schedule.zone", { time: i18n.dateTimeIn(data.nextChecks[0], data.zone), zone: data.zone })
                : t("automatic.preview.noCheck")}
            </Fact>
          ) : null}
          {shown("lastSuccess") ? (
            <Fact icon="calendar-check" label={t("automatic.preview.lastSuccess")}>
              {data.lastSuccessAt ? t("automatic.schedule.zone", { time: i18n.dateTimeIn(data.lastSuccessAt, data.zone), zone: data.zone }) : t("automatic.preview.none")}
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
          {data.publishing && shown("publishing") ? (
            <Fact icon={data.publishing === "AUTO_PUBLISH" ? "bolt" : "eye-check-mark"} label={t("automatic.preview.publishing")}>
              {data.publishing === "AUTO_PUBLISH" ? <s-text tone="caution">{t("automatic.preview.publishAuto")}</s-text> : t("automatic.preview.publishDraft")}
            </Fact>
          ) : null}
          {data.translating > 0 ? (
            <Fact icon="in-progress" label={t("automatic.preview.translating")}>
              {t("automatic.preview.items", { count: data.translating })}
            </Fact>
          ) : null}
          {shown("waiting") ? (
            <Fact icon="clock" label={t("automatic.preview.waiting")}>
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
