/**
 * Smart Auto-Translate (Business): when the store is checked, what is
 * translated, publishing, budgets, exclusions and recent checks. Every
 * value is validated again on the server (smart/validate.ts); the plan is
 * checked in every action, also for a form posted without this page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { aiLimitsFor, shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { enqueueCoveragePage, enqueueItems } from "../.server/jobs/queues";
import { getConfig } from "../.server/lib/config";
import { prisma } from "../.server/lib/db";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { getTranslationProvider } from "../.server/providers";
import { getQueues } from "../.server/queue/client";
import { getShopSettings, hasCurrentAiConsent } from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchShopTimeZone } from "../.server/shopify/shop-time-zone";
import { getSmartConfig, pauseSmart, removeSmartExclusion, resumeSmart, saveSmartSettings, setSmartEnabled } from "../.server/smart/config";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { requestSmartRun, retrySmartRun } from "../.server/smart/runs";
import { normaliseSmartSettings, type SmartSettingsProblem } from "../.server/smart/validate";
import { useResultToast, useSaveBar } from "../components/app-bridge";
import { scheduleSummary, smartErrorText, SmartPreview, SmartStateBadge, SmartStateBanner, smartToast } from "../components/SmartAutoCard";
import { categoryName, IconTile } from "../components/CategoryCard";
import { CARD } from "../components/ContentTiles";
import { BIG_HEADING, Breadcrumbs, PLAIN_LIST } from "../components/LanguageLayout";
import { SUB_HEADING } from "../components/plan/styles";
import { FactList, InlineNotice, SETTING_NAME, SettingCard } from "../components/SettingsParts";
import type { IconName } from "../lib/icons";
import { CATEGORIES, categoryOf, isCategoryId, TIERS, type CategoryId } from "../lib/language-categories";
import { groupLabel, itemKindLabel, jobErrorMessage, kindLabel } from "../i18n/labels";
import { useI18n } from "../i18n/react";
import { languageList } from "../lib/name-lists";
import { entitlementsFor } from "../lib/plans";
import { CONTENT_TYPES, isContentType, stillWithoutAccess } from "../lib/resource-kinds";
import { formatTime, MAX_TIMES_PER_DAY, nextOccurrence, normaliseSchedule, parseTime, WEEKDAYS } from "../lib/schedule";
import { checkSpec, REALTIME_CHECK_MINUTE, SMART_DEFAULT_TYPES, SMART_FIELD_GROUPS, SMART_PERSONAL_DATA_TYPES, SMART_TYPES, type SmartType } from "../lib/smart-auto";

const SAVE_BAR = "smart-auto-save-bar";
const MODES = ["realtime", "daily", "weekly", "custom", "manual"] as const;
/** Times offered in the selects: every 15 minutes. */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => formatTime(i * 15));
/** The summary card's schedule ("Every day at 23:00"): smaller than the Plan page's plan name, as it can be a sentence. */
const HERO_NAME = { margin: 0, fontSize: 20, lineHeight: "26px", fontWeight: 700, letterSpacing: "-0.01em" } as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const [settings, locales, billing, shopTimeZone] = await Promise.all([
    getShopSettings(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
    shopBilling(admin, shop),
    fetchShopTimeZone(admin),
  ]);
  const targets = locales.locales.filter((l) => !l.primary);
  const context = await smartContext(billing, settings, targets.map((l) => l.locale));
  const allowed = context.allowed;
  const measured = await loadSmartPanel(shop.id, { ...context, shopTimeZone });
  // Access allowed since the last check: the next one reads the type, there is nothing left to do.
  const granted = measured.noAccess.length ? (await scopes.query()).granted : [];
  const panel = { ...measured, noAccess: stillWithoutAccess(measured.noAccess, granted) };
  // The shop's zone first (Shopify may spell it differently from Intl), then Intl's list.
  const zones = [...new Set([...(panel.config ? [panel.config.timeZone] : []), ...(shopTimeZone ? [shopTimeZone] : []), "UTC", ...Intl.supportedValuesOf("timeZone")])];
  return {
    entitled: billing.entitlements.smartAuto,
    // Turning on needs both: the page says so instead of a button that is refused.
    consent: context.consent,
    available: context.available,
    autoPublishInPlan: billing.entitlements.autoPublish,
    allowance: aiLimitsFor(getConfig(), billing).limit,
    // While a Shopify trial runs, the allowance (and so every budget) is the trial's; afterwards the plan's.
    trial: billing.trialEndsAt ? { endsAt: billing.trialEndsAt.toISOString(), limit: entitlementsFor(billing.subscription?.planHandle).monthlyChars } : null,
    languages: targets.map((l) => ({ locale: l.locale, name: l.name, inPlan: allowed.includes(l.locale) })),
    shopTimeZone,
    zones,
    panel,
    // One Check now per page view (a double click is one check).
    checkKey: crypto.randomUUID(),
    // The next checks are computed from the page's time, the same on the server and in the browser.
    now: Date.now(),
  };
};

type ActionResult =
  | { ok: true; done: string; count?: number }
  | {
      ok: false;
      error: SmartSettingsProblem | "PLAN" | "CHANGED" | "NOT_CONFIGURED" | "COOLDOWN" | "CONSENT" | "UNAVAILABLE" | "INVALID" | "NOT_ON" | "PAUSED" | "PRIMARY_LANGUAGE";
    };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const billing = await shopBilling(admin, shop);
  // Turning off, pausing and removing exclusions stay possible after a downgrade.
  if (!billing.entitlements.smartAuto && !["turn-off", "pause", "remove-exclusion"].includes(intent)) return { ok: false, error: "PLAN" };

  if (intent === "save") {
    const locales = await fetchAndSyncShopLocales(admin, shop.id);
    const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
    const existing = await getSmartConfig(shop.id);
    const mode = form.get("mode");
    const parsed = normaliseSmartSettings(
      {
        mode,
        timeZone: form.get("timeZone"),
        times: mode === "custom" ? form.getAll("customTime").filter((v) => v !== "none") : [form.get("time")],
        weekdays: form.getAll("weekday"),
        locales: form.getAll("locale"),
        resourceTypes: form.getAll("type"),
        fieldGroups: form.get("fields") === "chosen" ? form.getAll("group") : "all",
        includeAttached: form.get("attached") === "on",
        publishMode: form.get("publishMode"),
        confirmPublish: form.get("confirmPublish") === "on",
        replaceOutdatedMachine: form.get("outdated") !== "keep",
        dailyBudget: form.get("dailyBudget"),
        monthlyBudget: form.get("monthlyBudget"),
      },
      {
        targets,
        allowed: allowedTargetLocales(billing.entitlements, targets),
        shopTimeZone: await fetchShopTimeZone(admin),
        entitlements: billing.entitlements,
        currentPublishMode: existing?.publishMode ?? "DRAFT",
      },
    );
    if (!parsed.ok) return { ok: false, error: parsed.problem };
    const version = Number(form.get("version"));
    if (!Number.isInteger(version) || version < 0) return { ok: false, error: "CHANGED" };
    const saved = await saveSmartSettings({ shopId: shop.id, actorId, value: parsed.value, version, primaryLocale: locales.primary?.locale ?? null });
    return saved ? { ok: true, done: "saved" } : { ok: false, error: "CHANGED" };
  }
  if (intent === "turn-on") {
    if (!hasCurrentAiConsent(await getShopSettings(shop.id))) return { ok: false, error: "CONSENT" };
    if (!getTranslationProvider() || !getQueues()) return { ok: false, error: "UNAVAILABLE" };
    const result = await setSmartEnabled({ shopId: shop.id, actorId, enabled: true });
    return result.ok ? { ok: true, done: "on" } : { ok: false, error: result.problem };
  }
  if (intent === "turn-off") {
    await setSmartEnabled({ shopId: shop.id, actorId, enabled: false });
    return { ok: true, done: "off" };
  }
  if (intent === "pause") {
    await pauseSmart({ shopId: shop.id, actorId });
    return { ok: true, done: "paused" };
  }
  if (intent === "resume") {
    await resumeSmart({ shopId: shop.id, actorId });
    return { ok: true, done: "resumed" };
  }
  if (intent === "check-now") {
    const queues = getQueues();
    const result = await requestSmartRun(
      {
        prisma,
        adminFor: async () => admin,
        billingFor: async () => billing,
        aiAvailable: getTranslationProvider() !== null,
        ...(queues ? { enqueueCoveragePage: (payload) => enqueueCoveragePage(queues, payload) } : {}),
      },
      { shop, actorId, idempotencyKey: String(form.get("key") ?? "") },
    );
    if (result.status === "started" || result.status === "waiting" || result.status === "active") return { ok: true, done: result.status };
    if (result.status === "cooldown") return { ok: false, error: "COOLDOWN" };
    if (result.status === "off") return { ok: false, error: "NOT_CONFIGURED" };
    // What keeps it from running, as the merchant can act on it.
    const reasons: Record<string, Extract<ActionResult, { ok: false }>["error"]> = {
      CONSENT: "CONSENT",
      PLAN: "PLAN",
      PAUSED: "PAUSED",
      PRIMARY_LANGUAGE: "PRIMARY_LANGUAGE",
      NO_LANGUAGE: "NO_LANGUAGE",
    };
    return { ok: false, error: reasons[result.reason ?? ""] ?? "UNAVAILABLE" };
  }
  if (intent === "remove-exclusion") {
    const gid = String(form.get("resourceGid") ?? "");
    if (!/^gid:\/\/shopify\/[A-Za-z]+\/[0-9]+$/.test(gid)) return { ok: false, error: "INVALID" };
    await removeSmartExclusion({ shopId: shop.id, resourceGid: gid, actorId });
    return { ok: true, done: "removed" };
  }
  if (intent === "retry") {
    const runId = String(form.get("runId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false, error: "INVALID" };
    const queues = getQueues();
    if (!queues) return { ok: false, error: "UNAVAILABLE" };
    const round = `retry${Date.now()}`;
    const retried = await retrySmartRun({ prisma, adminFor: async () => admin, billingFor: async () => billing }, shop, runId, (ids) => enqueueItems(queues, shop.id, ids, round));
    return retried.ok ? { ok: true, done: "retried", count: retried.count } : retried;
  }
  return { ok: false, error: "INVALID" };
};

export default function SmartAutomatic() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t, number } = i18n;
  const panel = data.panel;
  const config = panel.config;
  const languageNames = new Map(data.languages.map((l) => [l.locale, i18n.language(l.locale, l.name)]));

  const settingsFetcher = useFetcher<typeof action>();
  const actionFetcher = useFetcher<typeof action>();
  useResultToast(settingsFetcher.data, smartToast(t, settingsFetcher.data));
  useResultToast(actionFetcher.data, smartToast(t, actionFetcher.data));
  // The button that was pressed shows it is working (one action at a time).
  const pending = actionFetcher.state !== "idle" ? actionFetcher.formData : null;
  const loading = (intent: string, field?: [string, string]) =>
    pending?.get("intent") === intent && (!field || pending.get(field[0]) === field[1]) ? { loading: true } : {};
  const act = (intent: string, extra: Record<string, string> = {}) => actionFetcher.submit({ intent, ...extra }, { method: "post" });

  // The form: what the merchant changes before saving (the next checks follow it live).
  const initial = useMemo(
    () => ({
      mode: config?.mode ?? "daily",
      times: config?.times.length ? config.times : [REALTIME_CHECK_MINUTE],
      weekdays: config?.weekdays.length ? config.weekdays : [...WEEKDAYS],
      zone: config?.timeZone ?? data.shopTimeZone ?? "UTC",
      fieldsChosen: Boolean(config?.fieldGroups.length),
      publishMode: config?.publishMode ?? "DRAFT",
    }),
    [config, data.shopTimeZone],
  );
  const [formKey, setFormKey] = useState(0);
  const [mode, setMode] = useState(initial.mode);
  const [fieldsChosen, setFieldsChosen] = useState(initial.fieldsChosen);
  const [publishMode, setPublishMode] = useState(initial.publishMode);
  const [preview, setPreview] = useState<{ times: number[]; weekdays: number[]; zone: string }>({ times: [...initial.times], weekdays: [...initial.weekdays], zone: initial.zone });
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const read = () => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const nextMode = String(fd.get("mode") ?? mode);
    setMode(nextMode);
    setFieldsChosen(fd.get("fields") === "chosen");
    setPublishMode(fd.get("publishMode") === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "DRAFT");
    const times = (nextMode === "custom" ? fd.getAll("customTime") : [fd.get("time")]).map((v) => parseTime(v)).filter((v): v is number => v !== null);
    const weekdays = fd.getAll("weekday").flatMap((v) => String(v).split(",")).map(Number).filter((n) => n >= 1 && n <= 7);
    setPreview({ times, weekdays, zone: String(fd.get("timeZone") ?? initial.zone) });
    setDirty(true);
  };
  const discard = () => {
    setFormKey((k) => k + 1);
    setMode(initial.mode);
    setFieldsChosen(initial.fieldsChosen);
    setPublishMode(initial.publishMode);
    setPreview({ times: [...initial.times], weekdays: [...initial.weekdays], zone: initial.zone });
    setDirty(false);
  };
  // Saved: the form is clean again, once per save (later edits show the save bar again).
  const savedResult = useRef<unknown>(null);
  useEffect(() => {
    if (settingsFetcher.state !== "idle" || !settingsFetcher.data?.ok || savedResult.current === settingsFetcher.data) return;
    savedResult.current = settingsFetcher.data;
    setDirty(false);
  }, [settingsFetcher.state, settingsFetcher.data]);
  useSaveBar(SAVE_BAR, dirty && data.entitled);

  // While a check runs, its figures follow (not while the form is being edited, nor in a hidden tab).
  const revalidator = useRevalidator();
  const running = panel.runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED" || r.status === "WAITING");
  useEffect(() => {
    if (!running || dirty) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle" && document.visibilityState === "visible") revalidator.revalidate();
    }, 10_000);
    return () => clearInterval(timer);
  }, [running, dirty, revalidator]);

  // The next three checks of the schedule as it is in the form now.
  const upcoming = useMemo(() => {
    const spec = normaliseSchedule({
      mode: mode === "realtime" ? "daily" : mode,
      timeZone: preview.zone,
      times: preview.times,
      weekdays: mode === "daily" || mode === "realtime" ? [...WEEKDAYS] : preview.weekdays,
      shopTimeZone: data.shopTimeZone,
    });
    if (!spec.ok) return [];
    const check = checkSpec({ ...spec.spec, mode });
    const out: number[] = [];
    let from = data.now;
    while (check && out.length < 3) {
      const next = nextOccurrence(check, from);
      if (next === null) break;
      out.push(next);
      from = next;
    }
    return out;
  }, [mode, preview, data.shopTimeZone, data.now]);

  // Each fetcher's own refusal: the form's next to the form, an action's next to its buttons.
  const error = settingsFetcher.data && !settingsFetcher.data.ok ? settingsFetcher.data.error : null;
  const actionError = actionFetcher.data && !actionFetcher.data.ok ? actionFetcher.data.error : null;
  const notConfigured = !config;
  const cantTurnOn = !data.consent ? "CONSENT" : !data.available ? "UNAVAILABLE" : null;

  // Where access to the first chosen type without it is allowed (its content page asks for the scope).
  const accessType = panel.noAccess.find(isContentType);
  const accessHref = accessType ? `/app/content/${CONTENT_TYPES[accessType].slug}` : null;

  const outside = data.languages.filter((l) => !l.inPlan);
  const chosenTypes = new Set<string>(config?.resourceTypes ?? SMART_DEFAULT_TYPES);
  const heroLines: Array<{ icon: IconName; text: string; key: string }> = [];
  if (config) {
    heroLines.push({
      key: "next",
      icon: "calendar-time",
      text:
        panel.nextChecks[0] !== undefined
          ? `${t("automatic.preview.nextCheck")}: ${t("automatic.schedule.zone", { time: i18n.dateTimeIn(panel.nextChecks[0], panel.zone), zone: panel.zone })}`
          : t("automatic.preview.noCheck"),
    });
    heroLines.push({
      key: "languages",
      icon: "language",
      text: config.locales.length ? languageList(i18n, config.locales.map((l) => languageNames.get(l) ?? l), Infinity) : t("automatic.preview.none"),
    });
  }

  return (
    <s-page heading={t("automatic.page.heading")}>
      <s-link slot="breadcrumb-actions" href="/app/settings">
        {t("automatic.page.back")}
      </s-link>

      <s-stack direction="block" gap="base">
        <Breadcrumbs i18n={i18n} trail={[{ href: "/app/settings", label: t("automatic.page.back") }]} current={t("automatic.page.heading")} />
        <s-stack direction="block" gap="small-500">
          <h1 style={BIG_HEADING}>{t("automatic.page.heading")}</h1>
          <s-text color="subdued">{t("automatic.page.subtitle")}</s-text>
        </s-stack>

        {/* The schedule as it is: its state, when it checks next, its actions, and what the last checks found. */}
        <section id="smart-status" aria-labelledby="smart-status-heading">
          <s-box {...CARD} padding="base">
            <s-stack direction="block" gap="base">
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 680px) 1fr auto, 1fr" gap="base" alignItems="start">
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
                    <IconTile icon="calendar-time" size={48} color="base" />
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="block" gap="small-500">
                        {/* The visual label; screen readers hear it inside the heading. */}
                        <span aria-hidden="true">
                          <s-text color="subdued">{t("automatic.hero.label")}</s-text>
                        </span>
                        <h2 id="smart-status-heading" style={HERO_NAME}>
                          <s-text accessibilityVisibility="exclusive">{`${t("automatic.hero.label")}: `}</s-text>
                          {config ? scheduleSummary(i18n, config) : t("automatic.hero.notSetUp")}
                        </h2>
                      </s-stack>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <SmartStateBadge status={panel.status} />
                        <s-badge tone="info" {...(data.entitled ? {} : { icon: "lock" })}>
                          {t("automatic.business")}
                        </s-badge>
                      </s-stack>
                      {heroLines.map((line) => (
                        <s-grid key={line.key} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                          <s-icon type={line.icon} color="subdued" />
                          <s-text color="subdued">{line.text}</s-text>
                        </s-grid>
                      ))}
                    </s-stack>
                  </s-grid>
                  <s-stack direction="inline" gap="small-200">
                    {panel.status.state === "off" ? (
                      // Not on the plan: the notice below offers the way to it instead of a button that can't work.
                      data.entitled ? (
                        <s-button variant="primary" disabled={notConfigured || cantTurnOn !== null} onClick={() => act("turn-on")} {...loading("turn-on")}>
                          {t("automatic.action.turnOn")}
                        </s-button>
                      ) : null
                    ) : (
                      <>
                        <s-button variant="primary" disabled={panel.status.state !== "on"} onClick={() => act("check-now", { key: data.checkKey })} {...loading("check-now")}>
                          {t("automatic.action.checkNow")}
                        </s-button>
                        {panel.status.state === "paused" ? (
                          <s-button onClick={() => act("resume")} {...loading("resume")}>
                            {t("automatic.action.resume")}
                          </s-button>
                        ) : (
                          <s-button onClick={() => act("pause")} {...loading("pause")}>
                            {t("automatic.action.pause")}
                          </s-button>
                        )}
                        <s-button onClick={() => act("turn-off")} {...loading("turn-off")}>
                          {t("automatic.action.turnOff")}
                        </s-button>
                      </>
                    )}
                  </s-stack>
                </s-grid>
              </s-query-container>
              {!data.entitled ? (
                <InlineNotice icon="lock" heading={t("automatic.locked.heading")} action={<s-button href="/app/plan">{t("automatic.upsell.cta")}</s-button>}>
                  {t("automatic.page.notInPlan")}
                </InlineNotice>
              ) : null}
              <SmartStateBanner status={panel.status} zone={panel.zone} />
              {panel.noAccess.length ? (
                <InlineNotice
                  icon="lock"
                  heading={t("automatic.noAccess.heading")}
                  action={accessHref ? <s-button href={accessHref}>{t("coverage.types.allowAccess")}</s-button> : undefined}
                >
                  {t("automatic.noAccess.body", { types: languageList(i18n, panel.noAccess.map((type) => kindLabel(i18n, type)), 4) })}
                </InlineNotice>
              ) : null}
              {notConfigured && data.entitled ? (
                <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                  <s-icon type="info" color="subdued" />
                  <s-text color="subdued">{t("automatic.hero.setUpHint")}</s-text>
                </s-grid>
              ) : null}
              {data.entitled && !notConfigured && panel.status.state === "off" && cantTurnOn ? (
                <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                  <s-icon type="info" color="subdued" />
                  <s-text color="subdued">
                    {errorText(i18n, cantTurnOn)} {cantTurnOn === "CONSENT" ? <s-link href="/app/settings">{t("automatic.page.back")}</s-link> : null}
                  </s-text>
                </s-grid>
              ) : null}
              {actionError ? (
                <s-banner tone="critical" heading={t("automatic.error.actionHeading")}>
                  <s-paragraph>{errorText(i18n, actionError)}</s-paragraph>
                </s-banner>
              ) : null}
              {config ? <SmartPreview data={panel} languageNames={languageNames} omit={["languages", "schedule", "nextCheck"]} /> : null}
            </s-stack>
          </s-box>
        </section>

        <ui-save-bar id={SAVE_BAR}>
          <button variant="primary" onClick={() => formRef.current?.requestSubmit()} {...(settingsFetcher.state !== "idle" ? { loading: "" } : {})}>
            {t("automatic.action.save")}
          </button>
          <button onClick={discard}>{t("automatic.action.discard")}</button>
        </ui-save-bar>

        <settingsFetcher.Form key={formKey} method="post" ref={formRef} onChange={read} onInput={read}>
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="version" value={config?.version ?? 0} />
          <s-stack direction="block" gap="base">
            {/* When: the mode on the left; its time, days and zone with the next checks on the right. */}
            <SettingCard id="smart-schedule" icon="calendar-time" heading={t("automatic.section.schedule")} lead={t("automatic.section.schedule.lead")}>
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr, 1fr" gap="large" alignItems="start">
                  <s-choice-list name="mode" label={t("automatic.mode.label")}>
                    {MODES.map((m) => (
                      <s-choice key={m} value={m} defaultSelected={initial.mode === m}>
                        {t(`automatic.mode.${m}` as "automatic.mode.daily")}
                        <s-text slot="details">{t(`automatic.mode.${m}.details` as "automatic.mode.daily.details")}</s-text>
                      </s-choice>
                    ))}
                  </s-choice-list>
                  <s-box background="subdued" borderRadius="large-100" padding="base">
                    <s-stack direction="block" gap="base">
                      {mode === "custom" ? (
                        <s-stack direction="block" gap="small-200">
                          <s-text>{t("automatic.times.label")}</s-text>
                          <s-query-container>
                            <s-grid gridTemplateColumns="@container (inline-size > 420px) 1fr 1fr 1fr, 1fr 1fr" gap="small-200">
                              {Array.from({ length: MAX_TIMES_PER_DAY }, (_, i) => {
                                const value =
                                  initial.mode === "custom" && initial.times[i] !== undefined
                                    ? formatTime(initial.times[i]!)
                                    : i === 0
                                      ? formatTime(initial.times[0] ?? REALTIME_CHECK_MINUTE)
                                      : "none";
                                return (
                                  <s-select key={i} name="customTime" label={t("automatic.times.slot", { number: i + 1 })} value={value}>
                                    <s-option value="none">{t("automatic.times.none")}</s-option>
                                    {TIME_OPTIONS.map((o) => (
                                      <s-option key={o} value={o}>
                                        {o}
                                      </s-option>
                                    ))}
                                  </s-select>
                                );
                              })}
                            </s-grid>
                          </s-query-container>
                        </s-stack>
                      ) : mode !== "manual" ? (
                        <s-select
                          name="time"
                          label={mode === "realtime" ? t("automatic.time.dailyCheck") : t("automatic.time.label")}
                          value={formatTime(initial.times[0] ?? REALTIME_CHECK_MINUTE)}
                        >
                          {TIME_OPTIONS.map((o) => (
                            <s-option key={o} value={o}>
                              {o}
                            </s-option>
                          ))}
                        </s-select>
                      ) : null}
                      {mode === "weekly" || mode === "custom" ? (
                        <s-choice-list name="weekday" label={t("automatic.weekdays.label")} multiple>
                          {WEEKDAYS.map((d) => (
                            <s-choice key={d} value={String(d)} defaultSelected={initial.weekdays.includes(d)}>
                              {i18n.weekday(d)}
                            </s-choice>
                          ))}
                        </s-choice-list>
                      ) : null}
                      {mode !== "manual" ? (
                        <s-select name="timeZone" label={t("automatic.zone.label")} value={initial.zone}>
                          {data.zones.map((z) => (
                            <s-option key={z} value={z}>
                              {z === data.shopTimeZone ? t("automatic.zone.shop", { zone: z }) : z}
                            </s-option>
                          ))}
                        </s-select>
                      ) : (
                        <input type="hidden" name="timeZone" value={initial.zone} />
                      )}
                      <s-divider />
                      <s-stack direction="block" gap="small-200">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-icon type="calendar-check" color="subdued" />
                          <h3 style={SUB_HEADING}>{t("automatic.next.label")}</h3>
                        </s-stack>
                        {upcoming.length ? (
                          <s-ordered-list>
                            {upcoming.map((at) => (
                              <s-list-item key={at}>{t("automatic.schedule.zone", { time: i18n.dateTimeIn(at, preview.zone), zone: preview.zone })}</s-list-item>
                            ))}
                          </s-ordered-list>
                        ) : (
                          <s-text color="subdued">{t("automatic.next.none")}</s-text>
                        )}
                      </s-stack>
                    </s-stack>
                  </s-box>
                </s-grid>
              </s-query-container>
            </SettingCard>

            {/* What: languages, the content by area (as the Content page groups it), and the fields. */}
            <SettingCard id="smart-scope" icon="language-translate" heading={t("automatic.section.scope")} lead={t("automatic.section.scope.lead")}>
              <s-stack direction="block" gap="small-200">
                <s-choice-list name="locale" label={t("automatic.languages.label")} multiple>
                  {data.languages
                    .filter((l) => l.inPlan)
                    .map((l) => (
                      <s-choice key={l.locale} value={l.locale} defaultSelected={config ? config.locales.includes(l.locale) : true}>
                        {languageNames.get(l.locale)}
                      </s-choice>
                    ))}
                </s-choice-list>
                {outside.length ? (
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                    <s-icon type="lock" color="subdued" />
                    <s-text color="subdued">
                      {t("settings.auto.outsidePlan", {
                        languages: languageList(i18n, outside.map((l) => languageNames.get(l.locale) ?? l.locale), Infinity),
                        count: outside.length,
                      })}{" "}
                      <s-link href="/app/plan">{t("automatic.upsell.cta")}</s-link>
                    </s-text>
                  </s-grid>
                ) : null}
              </s-stack>
              <s-divider />
              <s-stack direction="block" gap="small-200">
                <h3 id="smart-types" style={SUB_HEADING}>
                  {t("automatic.types.label")}
                </h3>
                {/* One row per area of the Content page: its icon, its name, and its kinds of content side by side. */}
                <s-box border="base" borderRadius="large-100" paddingInline="base">
                  <ul aria-labelledby="smart-types" style={PLAIN_LIST}>
                    {TYPE_AREAS.map(({ area, icon, types }, index) => (
                      <li key={area}>
                        {index > 0 ? <s-divider /> : null}
                        <s-box paddingBlock="small-100">
                          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-100" alignItems="start">
                            <IconTile icon={icon} size={28} color="base" iconSize="base" />
                            {types.length === 1 ? (
                              <div style={{ paddingTop: 4 }}>
                                <TypeCheckbox type={types[0]!} checked={chosenTypes.has(types[0]!)} i18n={i18n} />
                              </div>
                            ) : (
                              <div role="group" aria-labelledby={`smart-area-${area}`} style={{ paddingTop: 4 }}>
                                <s-stack direction="block" gap="small-200">
                                  <span id={`smart-area-${area}`} style={SETTING_NAME}>
                                    {area === "other" ? t("automatic.types.label") : categoryName(i18n, area)}
                                  </span>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
                                    {types.map((type) => (
                                      <TypeCheckbox key={type} type={type} checked={chosenTypes.has(type)} i18n={i18n} />
                                    ))}
                                  </div>
                                </s-stack>
                              </div>
                            )}
                          </s-grid>
                        </s-box>
                      </li>
                    ))}
                  </ul>
                </s-box>
                <s-checkbox name="attached" label={t("automatic.attached.label")} details={t("automatic.attached.details")} {...(config?.includeAttached ? { defaultChecked: true } : {})} />
              </s-stack>
              <s-divider />
              <s-stack direction="block" gap="small-200">
                <s-choice-list name="fields" label={t("automatic.fields.label")}>
                  <s-choice value="all" defaultSelected={!initial.fieldsChosen}>
                    {t("automatic.fields.all")}
                  </s-choice>
                  <s-choice value="chosen" defaultSelected={initial.fieldsChosen}>
                    {t("automatic.fields.chosen")}
                  </s-choice>
                </s-choice-list>
                {fieldsChosen ? (
                  <s-box background="subdued" borderRadius="large-100" padding="base">
                    <s-choice-list name="group" label={t("automatic.fields.groups")} multiple>
                      {SMART_FIELD_GROUPS.map((g) => (
                        <s-choice key={g} value={g} defaultSelected={config?.fieldGroups.includes(g) ?? false}>
                          {groupLabel(i18n, g)}
                        </s-choice>
                      ))}
                    </s-choice-list>
                  </s-box>
                ) : null}
              </s-stack>
            </SettingCard>

            {/* Publishing and outdated translations: two short choices, side by side where there is room. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16, alignItems: "stretch" }}>
              <SettingCard id="smart-publishing" icon="send" heading={t("automatic.section.publishing")} lead={t("automatic.section.publishing.lead")}>
                <s-choice-list name="publishMode" label={t("automatic.section.publishing")} labelAccessibilityVisibility="exclusive">
                  <s-choice value="DRAFT" defaultSelected={initial.publishMode !== "AUTO_PUBLISH"}>
                    {t("automatic.publish.draft")}
                    <s-text slot="details">{t("automatic.publish.draft.details")}</s-text>
                  </s-choice>
                  <s-choice value="AUTO_PUBLISH" defaultSelected={initial.publishMode === "AUTO_PUBLISH"} disabled={!data.autoPublishInPlan}>
                    {t("automatic.publish.auto")}
                    <s-text slot="details">{data.autoPublishInPlan ? t("automatic.publish.auto.details") : t("automatic.publish.plan")}</s-text>
                  </s-choice>
                </s-choice-list>
                {publishMode === "AUTO_PUBLISH" && config?.publishMode !== "AUTO_PUBLISH" ? (
                  <s-box background="subdued" borderRadius="large-100" padding="base">
                    <s-checkbox name="confirmPublish" label={t("automatic.publish.confirm")} />
                  </s-box>
                ) : null}
              </SettingCard>
              <SettingCard id="smart-outdated" icon="refresh" heading={t("automatic.section.outdated")} lead={t("automatic.section.outdated.lead")}>
                <s-choice-list name="outdated" label={t("automatic.section.outdated")} labelAccessibilityVisibility="exclusive">
                  <s-choice value="replace" defaultSelected={config?.replaceOutdatedMachine ?? true}>
                    {t("automatic.outdated.replace")}
                    <s-text slot="details">{t("automatic.outdated.replace.details")}</s-text>
                  </s-choice>
                  <s-choice value="keep" defaultSelected={config ? !config.replaceOutdatedMachine : false}>
                    {t("automatic.outdated.keep")}
                    <s-text slot="details">{t("automatic.outdated.keep.details")}</s-text>
                  </s-choice>
                </s-choice-list>
              </SettingCard>
            </div>

            {/* Budgets: optional caps below the plan's allowance. */}
            <SettingCard id="smart-budgets" icon="gauge" heading={t("automatic.section.budgets")} lead={t("automatic.section.budgets.lead")}>
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, 1fr" gap="base">
                  <s-number-field name="dailyBudget" label={t("automatic.budget.daily")} min={1} max={data.allowance} step={1} defaultValue={config?.dailyBudget ? String(config.dailyBudget) : ""} />
                  <s-number-field name="monthlyBudget" label={t("automatic.budget.monthly")} min={1} max={data.allowance} step={1} defaultValue={config?.monthlyBudget ? String(config.monthlyBudget) : ""} />
                </s-grid>
              </s-query-container>
              <FactList
                label={t("automatic.section.budgets")}
                facts={[
                  { key: "help", icon: "info", text: t("automatic.budget.help", { allowance: number(data.allowance) }) },
                  ...(data.trial
                    ? [{ key: "trial", icon: "clock" as const, text: t("automatic.budget.trial", { date: i18n.date(data.trial.endsAt), trial: number(data.allowance), limit: number(data.trial.limit) }) }]
                    : []),
                  { key: "used", icon: "gauge", text: t("automatic.budget.used", { today: number(panel.usage.today), month: number(panel.usage.month) }) },
                ]}
              />
            </SettingCard>

            {error ? (
              <s-banner tone="critical" heading={t("automatic.error.heading")}>
                <s-paragraph>{errorText(i18n, error)}</s-paragraph>
              </s-banner>
            ) : null}

            <s-stack direction="inline" gap="small-200 base" alignItems="center">
              <s-button type="submit" variant="primary" disabled={!data.entitled} {...(settingsFetcher.state !== "idle" ? { loading: true } : {})}>
                {t("automatic.action.save")}
              </s-button>
              <s-text color="subdued">{data.entitled ? t("automatic.save.note") : t("automatic.blocked.PLAN")}</s-text>
            </s-stack>
          </s-stack>
        </settingsFetcher.Form>

        {/* What it never translates: one row each, removable here, added from an item's editor. */}
        <SettingCard id="smart-exclusions" icon="hide" heading={t("automatic.section.exclusions")} lead={t("automatic.exclusions.body")}>
          {panel.exclusions.length ? (
            <ul aria-label={t("automatic.section.exclusions")} style={PLAIN_LIST}>
              {panel.exclusions.map((e, index) => {
                const name = `${itemKindLabel(i18n, e.resourceType)} ${e.resourceGid.split("/").pop()}`;
                return (
                  <li key={e.resourceGid}>
                    {index > 0 ? <s-divider /> : null}
                    <s-box paddingBlock="small-200">
                      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
                        <IconTile icon="hide" size={28} color="base" iconSize="base" />
                        {e.href ? <s-link href={e.href}>{name}</s-link> : <s-text>{e.resourceGid}</s-text>}
                        <s-button
                          variant="tertiary"
                          accessibilityLabel={`${t("automatic.action.remove")}: ${name}`}
                          onClick={() => act("remove-exclusion", { resourceGid: e.resourceGid })}
                          {...loading("remove-exclusion", ["resourceGid", e.resourceGid])}
                        >
                          {t("automatic.action.remove")}
                        </s-button>
                      </s-grid>
                    </s-box>
                  </li>
                );
              })}
            </ul>
          ) : (
            <InlineNotice icon="check-circle" heading={t("automatic.exclusions.empty")}>
              {t("automatic.exclusions.emptyBody")}
            </InlineNotice>
          )}
        </SettingCard>

        {/* Recent checks: when, how it ended (icon and word), what it found and sent, and its jobs. */}
        <SettingCard id="smart-activity" icon="clipboard-checklist" heading={t("automatic.section.activity")} lead={t("automatic.section.activity.lead")}>
          {panel.runs.length === 0 ? (
            <InlineNotice icon="calendar-check" heading={t("automatic.activity.empty")}>
              {t("automatic.activity.emptyBody")}
            </InlineNotice>
          ) : (
            <ul aria-label={t("automatic.section.activity")} style={PLAIN_LIST}>
              {panel.runs.map((run, index) => {
                const when = t("automatic.schedule.zone", { time: i18n.dateTimeIn(run.createdAt, panel.zone), zone: panel.zone });
                const status = RUN_STATUS[run.status] ?? RUN_STATUS.QUEUED!;
                return (
                  <li key={run.id}>
                    {index > 0 ? <s-divider /> : null}
                    <s-box paddingBlock="small-100">
                      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                        <IconTile icon={run.trigger === "MANUAL" ? "play-circle" : "calendar-time"} size={32} color="base" iconSize="base" />
                        <s-stack direction="block" gap="small-300">
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <span style={SETTING_NAME}>{when}</span>
                            <s-badge tone={status.tone} icon={status.icon}>
                              {t(`automatic.activity.status.${run.status}` as "automatic.activity.status.COMPLETED")}
                            </s-badge>
                            <s-text color="subdued">{t(`automatic.activity.trigger.${run.trigger}` as "automatic.activity.trigger.MANUAL")}</s-text>
                          </s-stack>
                          {run.status === "SKIPPED" ? (
                            <s-text color="subdued">{runReason(i18n, run.errorCode)}</s-text>
                          ) : (
                            <s-text>
                              {[
                                t("automatic.activity.checked", { count: run.resourcesChecked }),
                                t("automatic.activity.changed", { count: run.resourcesChanged, fields: number(run.fieldsDetected), chars: number(run.charsEstimated) }),
                                run.excludedSkipped ? t("automatic.activity.excluded", { count: run.excludedSkipped }) : null,
                                run.billed || run.fromMemory ? t("automatic.activity.billed", { billed: number(run.billed), memory: number(run.fromMemory) }) : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </s-text>
                          )}
                          {/* Why it didn't finish, or why its translation stopped (a budget, the plan's allowance). */}
                          {run.status !== "SKIPPED" && run.errorCode ? (
                            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                              <s-icon type="alert-triangle" tone={run.status === "FAILED" ? "critical" : "caution"} />
                              <s-text tone={run.status === "FAILED" ? "critical" : "caution"}>{runReason(i18n, run.errorCode)}</s-text>
                            </s-grid>
                          ) : null}
                          {run.failed || run.jobs.length ? (
                            <s-stack direction="inline" gap="small-200 base" alignItems="center">
                              {run.failed ? (
                                <s-stack direction="inline" gap="small-300" alignItems="center">
                                  <s-icon type="alert-circle" tone="critical" />
                                  <s-text tone="critical">{t("automatic.activity.failed", { count: run.failed })}</s-text>
                                </s-stack>
                              ) : null}
                              {/* Only while it runs: retried items would be cancelled again while paused or off. */}
                              {run.failed && panel.status.state === "on" ? (
                                <s-button
                                  variant="tertiary"
                                  accessibilityLabel={`${t("automatic.action.retryFailed")}: ${when}`}
                                  onClick={() => act("retry", { runId: run.id })}
                                  {...loading("retry", ["runId", run.id])}
                                >
                                  {t("automatic.action.retryFailed")}
                                </s-button>
                              ) : null}
                              {run.jobs.slice(0, 3).map((job) => (
                                <s-link key={job.id} href={`/app/jobs/${job.id}`}>
                                  {`${kindLabel(i18n, job.resourceType)} · ${languageNames.get(job.locale) ?? job.locale}`}
                                </s-link>
                              ))}
                            </s-stack>
                          ) : null}
                        </s-stack>
                      </s-grid>
                    </s-box>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingCard>
      </s-stack>
    </s-page>
  );
}

/** A content type of the smart schedule, with the personal-data note where it applies. */
function TypeCheckbox({ type, checked, i18n }: { type: SmartType; checked: boolean; i18n: ReturnType<typeof useI18n> }) {
  return (
    <s-checkbox
      name="type"
      value={type}
      label={kindLabel(i18n, type)}
      {...(SMART_PERSONAL_DATA_TYPES.has(type) ? { details: i18n.t("automatic.types.personal") } : {})}
      {...(checked ? { defaultChecked: true } : {})}
    />
  );
}

/** A check's state in words with its icon. */
const RUN_STATUS: Record<string, { tone?: "success" | "critical" | "info" | "warning"; icon: IconName }> = {
  QUEUED: { icon: "clock" },
  WAITING: { icon: "clock" },
  RUNNING: { tone: "info", icon: "in-progress" },
  COMPLETED: { tone: "success", icon: "check-circle" },
  FAILED: { tone: "critical", icon: "alert-circle" },
  CANCELLED: { icon: "x-circle" },
  SKIPPED: { icon: "minus-circle" },
};

/** The smart schedule's content types by the Content page's areas, in its order; any other type last. */
const TYPE_AREAS: Array<{ area: CategoryId | "other"; icon: IconName; types: SmartType[] }> = (() => {
  const byArea = new Map<CategoryId | "other", SmartType[]>();
  for (const type of SMART_TYPES) {
    const found = categoryOf(type);
    const area: CategoryId | "other" = found && isCategoryId(found) ? found : "other";
    byArea.set(area, [...(byArea.get(area) ?? []), type]);
  }
  const order: Array<CategoryId | "other"> = [...TIERS.flatMap((tier) => tier.categories), "other"];
  return order
    .filter((area) => byArea.has(area))
    .map((area) => ({ area, icon: area === "other" ? ("content" as const) : CATEGORIES[area].icon, types: byArea.get(area)! }));
})();

const RUN_REASONS = ["PAUSED", "COALESCED", "AI_NOT_CONFIGURED", "QUEUES_UNAVAILABLE", "NO_LANGUAGE", "SMART_OFF", "SCAN_FAILED", "STALLED", "PARTIAL"];

/** Why a check was skipped, didn't finish or stopped translating. */
function runReason(i18n: ReturnType<typeof useI18n>, code: string | null): string {
  if (code && RUN_REASONS.includes(code)) return i18n.t(`automatic.activity.reason.${code}` as "automatic.activity.reason.other");
  return (code ? jobErrorMessage(i18n, code) : null) ?? i18n.t("automatic.activity.reason.other");
}

/** The text for a refused action (the form's problems, the plan, consent, the installation). */
function errorText(i18n: ReturnType<typeof useI18n>, error: Extract<ActionResult, { ok: false }>["error"]): string {
  return smartErrorText(i18n, error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
