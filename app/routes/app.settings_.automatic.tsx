/**
 * Smart Auto-Translate (Business): when the store is checked, what is
 * translated, publishing, budgets, exclusions and recent checks. How often
 * is a choice of square tiles (native radio buttons), the weekdays a row of
 * square toggles, and the next checks follow the form live, with the
 * problem the server would refuse said in their place. Every
 * value is validated again on the server (smart/validate.ts); the plan is
 * checked in every action, also for a form posted without this page.
 *
 * Without Business and never set up, the page only shows what it would
 * add. After a move to a plan without it, the settings are shown read-only.
 * Set up once, saving can turn it on in the same step (an explicit flag).
 * A job the schedule stopped for a budget or the main language links here
 * with `?job=<id>`; once its cause is fixed, its card leads back to it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { aiLimitsFor, shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { backToJob } from "../.server/jobs/back-to-job";
import { enqueueCoveragePage, enqueueItems } from "../.server/jobs/queues";
import { engineConsentTokens, getConfig } from "../.server/lib/config";
import { prisma } from "../.server/lib/db";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { getTranslationProvider } from "../.server/providers";
import { getQueues } from "../.server/queue/client";
import { getShopSettings, hasCurrentAiConsent, textConsentTokens } from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { sizedImage } from "../.server/shopify/preview-images";
import { PREVIEW_NODE_TYPES } from "../.server/shopify/preview-nodes";
import { fetchShopTimeZone } from "../.server/shopify/shop-time-zone";
import { getSmartConfig, pauseSmart, removeSmartExclusion, resumeSmart, saveSmartSettings, setSmartEnabled } from "../.server/smart/config";
import { exclusionNodes } from "../.server/smart/exclusion-names";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { requestSmartRun, retrySmartRun } from "../.server/smart/runs";
import { normaliseSmartSettings, type SmartSettingsProblem } from "../.server/smart/validate";
import { useResultToast, useSaveBar } from "../components/app-bridge";
import { categoryName, IconTile } from "../components/CategoryCard";
import { BackToJob } from "../components/jobs/BackToJob";
import { CARD } from "../components/ContentTiles";
import { Breadcrumbs, PLAIN_LIST } from "../components/LanguageLayout";
import { PageHeader } from "../components/PageHeader";
import { SUB_HEADING } from "../components/plan/styles";
import { PublishingChoice, type PublishMode } from "../components/PublishingChoice";
import { Disclosure } from "../components/Disclosure";
import { IconSquare, type Tint } from "../components/IconSquare";
import { FactList, focusById, focusSection, InlineNotice, SETTING_NAME, SettingCard, StateLine, useFreshResult, type SettingState } from "../components/SettingsParts";
import {
  BudgetMeter,
  ChoiceTiles,
  DayToggles,
  failedAction,
  scheduleSummary,
  smartErrorText,
  SmartPreview,
  SmartStateBanner,
  sameScope,
  smartToast,
  whenIn,
  type ChoiceTile,
} from "../components/SmartAutoCard";
import { Strong } from "../components/Type";
import { itemKindLabel, jobErrorMessage, kindLabel } from "../i18n/labels";
import { useI18n } from "../i18n/react";
import { effectivePublishMode } from "../lib/automation-state";
import { consentLead, enginesText, isDeepLOnly } from "../lib/engine-texts";
import type { ConsentToken } from "../lib/engines";
import type { IconName } from "../lib/icons";
import { CATEGORIES, categoryOf, isCategoryId, TIERS, type CategoryId } from "../lib/language-categories";
import { jobKindLabel, jobName } from "../lib/job-view";
import { languageList } from "../lib/name-lists";
import { entitlementsFor } from "../lib/plans";
import { CONTENT_TYPES, isContentType, stillWithoutAccess } from "../lib/resource-kinds";
import { formatTime, MAX_TIMES_PER_DAY, normaliseSchedule, parseTime, SCHEDULE_PROBLEMS, suggestTime, upcomingOccurrences, wallClock, WEEKDAYS } from "../lib/schedule";
import { checkSpec, REALTIME_CHECK_MINUTE, SMART_DEFAULT_TYPES, SMART_FIELD_GROUPS, SMART_PERSONAL_DATA_TYPES, SMART_TYPES, type SmartType } from "../lib/smart-auto";
import { Button } from "../components/Button";

const SAVE_BAR = "smart-auto-save-bar";
const MODES = ["realtime", "daily", "weekly", "custom", "manual"] as const;
type Mode = (typeof MODES)[number];
/**
 * Each way's icon and colour: shortly after each change as Settings' "Shortly after saving" (automation,
 * blue), the timed ones in the schedule's violet, on demand as Settings' "Start it yourself" (slate).
 */
const MODE_LOOK: Record<Mode, { icon: IconName; tint: Tint }> = {
  realtime: { icon: "automation", tint: "blue" },
  daily: { icon: "calendar-time", tint: "violet" },
  weekly: { icon: "calendar", tint: "violet" },
  custom: { icon: "clock", tint: "violet" },
  manual: { icon: "play-circle", tint: "slate" },
};
/** The last checks shown; the earlier ones (up to RECENT_RUNS) fold behind one line, so the settings start high. */
const RUNS_SHOWN = 3;
/** Settings' section of the ways changes are translated: where this page is opened from, and leads back to. */
const SETTINGS_CHANGES = "/app/settings?section=changes";
/** Times offered in the selects, every 15 minutes: the form's value "HH:MM", shown in the interface language's clock ("11:00 PM", "23:00"). */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => ({ value: formatTime(i * 15), minute: i * 15 }));
/** The summary card's schedule ("Every day at 11:00 PM"): smaller than the Plan page's plan name, as it can be a sentence. */
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
  // The exclusions' names and pictures, read live (Linguva stores no merchant text) and kept a minute, so the
  // 10-second reloads while a check runs don't ask Shopify each time; a row Shopify doesn't answer for keeps
  // its kind and number.
  const readable = measured.exclusions.filter((e) => PREVIEW_NODE_TYPES.has(e.resourceType)).map((e) => e.resourceGid);
  const nameLocale = measured.config?.locales[0] ?? targets[0]?.locale ?? locales.primary?.locale ?? "en";
  const nodes = await exclusionNodes(admin, shop.id, readable, nameLocale);
  const exclusions = measured.exclusions.map((e) => {
    const node = nodes.get(e.resourceGid);
    return { ...e, title: node?.text ?? null, image: sizedImage(node?.image, 80) };
  });
  const panel = { ...measured, noAccess: stillWithoutAccess(measured.noAccess, granted), exclusions };
  // The shop's zone first (Shopify may spell it differently from Intl), then Intl's list.
  const zones = [...new Set([...(panel.config ? [panel.config.timeZone] : []), ...(shopTimeZone ? [shopTimeZone] : []), "UTC", ...Intl.supportedValuesOf("timeZone")])];
  // From a job the schedule stopped for a budget or the main language (`?job=<id>`): the way back, once fixed.
  const back = await backToJob({ shopId: shop.id, billing, jobId: new URL(request.url).searchParams.get("job"), target: "/app/settings/automatic" });
  return {
    backToJob: back,
    // The translation services in use (posted with "allow") and the ones the texts name.
    engines: { configured: engineConsentTokens(getConfig()), text: textConsentTokens(settings) },
    entitled: billing.entitlements.smartAuto,
    // Turning on needs both: the page says so instead of a button that is refused.
    consent: context.consent,
    available: context.available,
    // Automatic translation shortly after saving is on: turning this on replaces it (said beside the button).
    basicOn: settings.autoTranslateNew,
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
      error:
        | SmartSettingsProblem
        | "PLAN"
        | "CHANGED"
        | "NOT_CONFIGURED"
        | "COOLDOWN"
        | "CONSENT"
        | "UNAVAILABLE"
        | "INVALID"
        | "NOT_ON"
        | "PAUSED"
        | "PRIMARY_LANGUAGE"
        | "BASIC_ON";
    };

/**
 * Whether it may be turned on now: AI permission, the installation, and
 * automatic translation shortly after saving, which it replaces only when
 * the form says so (a stale form never turns that off silently).
 */
async function turnOnRefusal(shopId: string, form: FormData): Promise<"CONSENT" | "UNAVAILABLE" | "BASIC_ON" | null> {
  const settings = await getShopSettings(shopId);
  if (!hasCurrentAiConsent(settings)) return "CONSENT";
  if (!getTranslationProvider() || !getQueues()) return "UNAVAILABLE";
  if (settings.autoTranslateNew && form.get("replaceBasic") !== "true") return "BASIC_ON";
  return null;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const billing = await shopBilling(admin, shop);
  // Turning off, pausing and removing exclusions stay possible after a downgrade.
  if (!billing.entitlements.smartAuto && !["turn-off", "pause", "remove-exclusion"].includes(intent)) return { ok: false, error: "PLAN" };

  if (intent === "save") {
    // Saving and turning on in one step: checked before anything is written.
    const turnOn = form.get("turnOn") === "true";
    if (turnOn) {
      const refusal = await turnOnRefusal(shop.id, form);
      if (refusal) return { ok: false, error: refusal };
    }
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
    if (!saved) return { ok: false, error: "CHANGED" };
    if (!turnOn) return { ok: true, done: "saved" };
    const result = await setSmartEnabled({ shopId: shop.id, actorId, enabled: true });
    return result.ok ? { ok: true, done: "savedOn" } : { ok: false, error: result.problem };
  }
  if (intent === "turn-on") {
    const refusal = await turnOnRefusal(shop.id, form);
    if (refusal) return { ok: false, error: refusal };
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
  const shopZone = data.shopTimeZone;
  const languageNames = new Map(data.languages.map((l) => [l.locale, i18n.language(l.locale, l.name)]));
  // A job the schedule stopped for a budget or the main language, its cause fixed: the way back to it at
  // the top of the card that fixed it (`?job=…#smart-budgets`, `#smart-scope`), as the page's one primary button.
  const back = data.backToJob ? (
    <BackToJob jobId={data.backToJob.id} name={jobName(i18n, data.backToJob, Object.fromEntries(data.languages.map((l) => [l.locale, l.name])))} />
  ) : null;
  const backIn = (card: "smart-scope" | "smart-budgets") => (back && (data.backToJob?.group === "PRIMARY_LANGUAGE" ? "smart-scope" : "smart-budgets") === card ? back : null);
  const heroVariant = back ? ("secondary" as const) : ("primary" as const);
  // Where the page came from: Settings' section of the ways changes are translated (a phone shows its back row).
  const trail = [
    { href: "/app/settings", label: t("automatic.page.back") },
    { href: SETTINGS_CHANGES, label: t("settings.changes.heading") },
  ];

  const settingsFetcher = useFetcher<typeof action>();
  const actionFetcher = useFetcher<typeof action>();
  // The permission is granted where it lives (Settings' action), without leaving the page.
  const consentFetcher = useFetcher<{ ok: boolean; granted?: boolean; error?: string }>();
  useResultToast(settingsFetcher.data, smartToast(t, settingsFetcher.data));
  useResultToast(actionFetcher.data, smartToast(t, actionFetcher.data));
  useResultToast(consentFetcher.data, consentFetcher.data?.granted ? t("settings.ai.savedAllowed") : null);
  // Given: focus goes back to the schedule's summary, where turning it on is now offered.
  useFreshResult(consentFetcher, (result) => {
    if (result.granted) document.getElementById("smart-status-heading")?.focus();
  });
  // The button that was pressed shows it is working (one action at a time).
  const pending = actionFetcher.state !== "idle" ? actionFetcher.formData : null;
  const loading = (intent: string, field?: [string, string]) =>
    pending?.get("intent") === intent && (!field || pending.get(field[0]) === field[1]) ? { loading: true } : {};
  const act = (intent: string, extra: Record<string, string> = {}) => actionFetcher.submit({ intent, ...extra }, { method: "post" });

  // The form: what the merchant changes before saving (the next checks, and before setup the summary, follow it live).
  const initial = useMemo(
    () => ({
      mode: config?.mode ?? "daily",
      times: config?.times.length ? config.times : [REALTIME_CHECK_MINUTE],
      weekdays: config?.weekdays.length ? config.weekdays : [...WEEKDAYS],
      zone: config?.timeZone ?? data.shopTimeZone ?? "UTC",
      fieldsChosen: Boolean(config?.fieldGroups.length),
      publishMode: (config?.publishMode === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "DRAFT") as PublishMode,
      locales: config ? [...config.locales] : data.languages.filter((l) => l.inPlan).map((l) => l.locale),
      types: config ? [...config.resourceTypes] : [...SMART_DEFAULT_TYPES],
      attached: Boolean(config?.includeAttached),
      replace: config?.replaceOutdatedMachine !== false,
    }),
    [config, data.shopTimeZone, data.languages],
  );
  const [formKey, setFormKey] = useState(0);
  const [mode, setMode] = useState<string>(initial.mode);
  const [fieldsChosen, setFieldsChosen] = useState(initial.fieldsChosen);
  const [publishMode, setPublishMode] = useState<PublishMode>(initial.publishMode);
  // Automatic publishing confirmed in its dialog during this edit (the server requires it).
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  // After a choice (also from its dialog), focus moves to the option that is now current.
  const publishChosen = useRef(false);
  useEffect(() => {
    if (!publishChosen.current) return;
    publishChosen.current = false;
    focusById(publishMode === "AUTO_PUBLISH" ? "smart-publish-auto" : "smart-publish-review");
  }, [publishMode]);
  // The schedule as the form holds it: the one time, the custom times, the days and the zone. A field that
  // is hidden (another mode) keeps its value, and shows it again when it comes back.
  const [time, setTime] = useState(() => formatTime(initial.times[0] ?? REALTIME_CHECK_MINUTE));
  const [slots, setSlots] = useState<Slot[]>(() => slotsOf(initial));
  const [weekdays, setWeekdays] = useState<number[]>(() => [...initial.weekdays]);
  const [zone, setZone] = useState(initial.zone);
  // The zone's long list waits behind "Change": few stores need another zone than their own.
  const [zoneOpen, setZoneOpen] = useState(false);
  // Before setup the summary shows the form's languages and content as the suggestion it turns on; the whole
  // scope says whether the first check's figure is still the form's.
  const [scope, setScope] = useState(() => ({ locales: initial.locales, types: initial.types, attached: initial.attached, replace: initial.replace }));
  const [dirty, setDirty] = useState(false);
  // The answer to a save that was current when the form last changed: a refused field keeps its error until
  // the form changes after that answer (a new answer shows its errors again).
  const [editedAt, setEditedAt] = useState<unknown>(null);
  const slotIds = useRef(MAX_TIMES_PER_DAY);
  // An element to focus once the page shows it (a new time, the zone's list, the time before a removed one).
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    document.getElementById(id)?.focus();
  });
  const formRef = useRef<HTMLFormElement>(null);
  const changed = () => {
    setDirty(true);
    setEditedAt(settingsFetcher.data ?? null);
  };
  const read = () => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const nextMode = String(fd.get("mode") ?? mode);
    setMode(nextMode);
    setFieldsChosen(fd.get("fields") === "chosen");
    const field = fd.get("time");
    const single = typeof field === "string" && parseTime(field) !== null ? field : null;
    if (single) setTime(single);
    const customs = fd.getAll("customTime").map(String);
    if (customs.length) setSlots((current) => current.map((slot, i) => ({ ...slot, value: customs[i] ?? slot.value })));
    // Between one time and several a day, the first time moves along (09:00 every day → check 1 at 09:00).
    if (nextMode !== mode && nextMode === "custom" && slots.length === 1) setSlots([{ ...slots[0]!, value: single ?? time }]);
    if (nextMode !== mode && mode === "custom" && slots[0]) setTime(customs[0] ?? slots[0].value);
    // The days only while they are shown: hidden, they keep what was chosen.
    if (form.querySelector('input[name="weekday"]')) setWeekdays(fd.getAll("weekday").map(Number).filter((n) => n >= 1 && n <= 7));
    const chosenZone = fd.get("timeZone");
    if (typeof chosenZone === "string" && chosenZone) setZone(chosenZone);
    setScope({
      locales: fd.getAll("locale").flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean),
      types: fd.getAll("type").map(String),
      // As the server reads them when saving.
      attached: fd.get("attached") === "on",
      replace: fd.get("outdated") !== "keep",
    });
    changed();
  };
  const discard = () => {
    setFormKey((k) => k + 1);
    setMode(initial.mode);
    setFieldsChosen(initial.fieldsChosen);
    setPublishMode(initial.publishMode);
    setPublishConfirmed(false);
    setTime(formatTime(initial.times[0] ?? REALTIME_CHECK_MINUTE));
    setSlots(slotsOf(initial));
    setWeekdays([...initial.weekdays]);
    setZone(initial.zone);
    setZoneOpen(false);
    setScope({ locales: initial.locales, types: initial.types, attached: initial.attached, replace: initial.replace });
    setDirty(false);
  };
  // "+ Add a time": a new check as far from the others as it can be, focused; × takes one away.
  const addSlot = () => {
    const taken = slots.map((s) => parseTime(s.value)).filter((m): m is number => m !== null);
    const slot = { id: slotIds.current++, value: formatTime(suggestTime(taken)) };
    setSlots([...slots, slot]);
    focusAfter.current = `smart-slot-${slot.id}`;
    changed();
  };
  const removeSlot = (id: number) => {
    const index = slots.findIndex((s) => s.id === id);
    const next = slots.filter((s) => s.id !== id);
    setSlots(next);
    focusAfter.current = `smart-slot-${next[Math.max(0, index - 1)]!.id}`;
    changed();
  };
  const openZone = () => {
    setZoneOpen(true);
    focusAfter.current = "smart-zone";
  };
  // Saved: the form is clean again, once per save (later edits show the save bar again).
  const savedResult = useRef<unknown>(null);
  useEffect(() => {
    if (settingsFetcher.state !== "idle" || !settingsFetcher.data?.ok || savedResult.current === settingsFetcher.data) return;
    savedResult.current = settingsFetcher.data;
    setDirty(false);
    setPublishConfirmed(false);
  }, [settingsFetcher.state, settingsFetcher.data]);

  const notConfigured = !config;
  // Downgraded: the settings are shown as they are, and can't be changed until Business again.
  const readOnly = !data.entitled;
  const canTurnOn = data.entitled && data.consent && data.available;
  // Never set up: saving turns it on in the same step (when it can run).
  const saveTurnsOn = notConfigured && canTurnOn;
  // Paused for a changed main language: only saving lifts it (the save records the new main language; Resume
  // would be paused again by the next check), so Save is there even before anything is changed.
  const saveToContinue = !readOnly && panel.status.state === "paused" && panel.status.reason === "PRIMARY_LANGUAGE";
  // The admin's save bar only for changes: shown on load, it would hold up leaving the page.
  useSaveBar(SAVE_BAR, dirty && !readOnly);

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

  // The schedule as it is in the form now, checked as the server checks it; its next three checks.
  const schedule = useMemo(
    () =>
      normaliseSchedule({
        mode: mode === "realtime" ? "daily" : mode,
        timeZone: zone,
        times: mode === "custom" ? slots.map((s) => s.value) : [time],
        weekdays: mode === "daily" || mode === "realtime" ? [...WEEKDAYS] : weekdays,
        shopTimeZone: data.shopTimeZone,
      }),
    [mode, zone, slots, time, weekdays, data.shopTimeZone],
  );
  const upcoming = useMemo(() => {
    if (!schedule.ok) return [];
    const check = checkSpec({ ...schedule.spec, mode });
    return check ? upcomingOccurrences(check, data.now, 3) : [];
  }, [schedule, mode, data.now]);
  // What the server would refuse ("at least an hour apart"), said live where the next checks would be.
  const liveProblem = schedule.ok ? null : schedule.problem;

  // The form's refusal is shown at the top and moved to; an action's beside its buttons.
  const error = settingsFetcher.data && !settingsFetcher.data.ok ? settingsFetcher.data.error : null;
  const actionError = actionFetcher.data && !actionFetcher.data.ok ? actionFetcher.data.error : null;
  const errorRef = useRef<HTMLDivElement>(null);
  const shownError = useRef<unknown>(null);
  useEffect(() => {
    if (!error || settingsFetcher.state !== "idle" || shownError.current === settingsFetcher.data) return;
    shownError.current = settingsFetcher.data;
    errorRef.current?.scrollIntoView({ block: "start" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error, settingsFetcher.state, settingsFetcher.data]);
  // After a refused save the field to change says so too: the schedule's from the live check (gone once it
  // is fixed), every other one until the next change.
  const edited = editedAt !== null && editedAt === settingsFetcher.data;
  const fieldError = (codes: readonly string[]) => (error && codes.includes(error) && !edited ? smartErrorText(i18n, error) : undefined);
  // A zone the server refused is shown in its list.
  const zoneShown = zoneOpen || error === "TIME_ZONE";
  const scheduleError = error && SCHEDULE_PROBLEMS.has(error) && liveProblem ? smartErrorText(i18n, liveProblem) : undefined;
  const timeError = liveProblem === "TIMES" || liveProblem === "TIMES_TOO_CLOSE" || liveProblem === "TOO_MANY_TIMES" ? scheduleError : undefined;
  const daysError = liveProblem === "WEEKDAYS" ? scheduleError : undefined;
  const zoneError = fieldError(["TIME_ZONE"]);
  const languagesError = fieldError(["NO_LANGUAGE", "PLAN_LANGUAGE", "UNKNOWN_LANGUAGE"]);
  const typesError = fieldError(["NO_TYPE", "UNKNOWN_TYPE"]);
  const groupsError = fieldError(["NO_FIELD_GROUP", "UNKNOWN_FIELD_GROUP"]);
  const budgetError = fieldError(["BUDGET"]);

  // Where access to the first chosen type without it is allowed (its content page asks for the scope).
  const accessType = panel.noAccess.find(isContentType);
  const accessHref = accessType ? `/app/content/${CONTENT_TYPES[accessType].slug}` : null;

  const outside = data.languages.filter((l) => !l.inPlan);
  const chosenTypes = new Set<string>(initial.types);
  const publishing = effectivePublishMode({ mode: publishMode, inPlan: data.autoPublishInPlan });
  const turnOnSubmit = () => {
    const form = formRef.current;
    if (!form) return;
    form.requestSubmit();
  };
  // What the grant button agrees to, next to it: with an engine beside DeepL, the services by
  // their legal names and data locations (the tokens the form posts are exactly these), and a
  // list that changed before the click (the page then shows the new one). DeepL alone: today's texts.
  const consentChanged = consentFetcher.data?.error === "CONSENT_CHANGED";
  const consentNote =
    isDeepLOnly(data.engines.configured) && !consentChanged ? null : (
      <s-stack direction="block" gap="small-200">
        {consentChanged ? (
          <s-banner tone="warning">
            <s-paragraph>{t("settings.ai.changed")}</s-paragraph>
          </s-banner>
        ) : null}
        {isDeepLOnly(data.engines.configured) ? null : (
          <>
            <s-paragraph>{consentLead(i18n, data.engines.configured)}</s-paragraph>
            <s-paragraph>{t("settings.ai.personal.multi")}</s-paragraph>
          </>
        )}
      </s-stack>
    );
  // A form: in the summary's actions it fills its place like the other buttons; elsewhere it sits in an inline stack.
  const grantButton = (variant: "primary" | "secondary") => (
    <consentFetcher.Form method="post" action="/app/settings">
      <input type="hidden" name="intent" value="grant-consent" />
      <input type="hidden" name="consentTokens" value={data.engines.configured.join(",")} />
      <Button type="submit" variant={variant} {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
        {t("settings.ai.allow")}
      </Button>
    </consentFetcher.Form>
  );

  // ─── The summary card ──────────────────────────────────────────────────────
  // After a move to a plan without it: paused while it was on (it continues on Business), off while it was off.
  const stoppedByPlan = readOnly && panel.status.state !== "off";
  const stateBadge: SettingState = stoppedByPlan
    ? { label: t("settings.changes.state.paused"), icon: "pause-circle", tone: "warning" }
    : panel.status.state === "on"
      ? { label: t("automatic.state.on"), icon: "check-circle", tone: "success" }
      : panel.status.state === "paused"
        ? { label: t("automatic.state.paused"), icon: "pause-circle", tone: "warning" }
        : panel.status.state === "waiting"
          ? { label: t("automatic.state.waiting"), icon: "clock", tone: "warning" }
          : { label: t("automatic.state.off"), icon: "minus-circle", tone: "neutral" };
  // Turning off is the quiet, red one: it isn't undone by Resume (it switches to "Start it yourself").
  const turnOff = (
    <Button variant="tertiary" tone="critical" onClick={() => act("turn-off")} {...loading("turn-off")}>
      {t("automatic.action.turnOff")}
    </Button>
  );
  const heroActions = readOnly ? (
    <>
      <Button href="/app/plan">{t("automatic.upsell.cta")}</Button>
      {panel.status.state !== "off" ? turnOff : null}
    </>
  ) : panel.status.state === "off" ? (
    canTurnOn ? (
      notConfigured ? (
        <>
          <Button variant={heroVariant} onClick={turnOnSubmit} {...(settingsFetcher.state !== "idle" ? { loading: true } : {})}>
            {t("automatic.action.turnOnWithThese")}
          </Button>
          {/* The suggestions are the form below: "Adjust" goes to its first card. */}
          <Button onClick={() => focusSection("smart-schedule")}>{t("automatic.action.adjust")}</Button>
        </>
      ) : (
        <Button variant={heroVariant} onClick={() => act("turn-on", data.basicOn ? { replaceBasic: "true" } : {})} {...loading("turn-on")}>
          {t("automatic.action.turnOn")}
        </Button>
      )
    ) : !data.consent ? (
      grantButton(heroVariant)
    ) : null
  ) : panel.status.state === "paused" ? (
    <>
      {saveToContinue ? (
        <Button variant={heroVariant} onClick={() => formRef.current?.requestSubmit()} {...(settingsFetcher.state !== "idle" ? { loading: true } : {})}>
          {t("automatic.action.save")}
        </Button>
      ) : (
        <Button variant={heroVariant} icon="play-circle" onClick={() => act("resume")} {...loading("resume")}>
          {t("automatic.action.resume")}
        </Button>
      )}
      {turnOff}
    </>
  ) : panel.status.state === "on" ? (
    <>
      <Button variant={heroVariant} icon="play" onClick={() => act("check-now", { key: data.checkKey })} {...loading("check-now")}>
        {t("automatic.action.checkNow")}
      </Button>
      <Button icon="pause-circle" onClick={() => act("pause")} {...loading("pause")}>
        {t("automatic.action.pause")}
      </Button>
      {turnOff}
    </>
  ) : (
    // Waiting: the reason says what to do; turning off stays possible.
    turnOff
  );
  // Pause and Turn off side by side: how they differ, in one line under them.
  const actionsNote = !readOnly && panel.status.state === "on" ? t("automatic.hero.pauseOrOff", { manual: t("settings.changes.manual.title") }) : null;
  const nextCheck = panel.nextChecks[0];

  if (!data.entitled && !config) {
    // Never set up and not in the plan: what it would add, and the way to it (no form to fill in for nothing).
    return (
      <s-page heading={t("automatic.page.heading")}>
        <s-link slot="breadcrumb-actions" href={SETTINGS_CHANGES}>
          {t("automatic.page.back")}
        </s-link>
        <s-query-container>
          <s-stack direction="block" gap="base">
            <Breadcrumbs i18n={i18n} trail={trail} current={t("automatic.page.heading")} touch />
            {/* No lead: the card says what it would do. */}
            <PageHeader page="smart" title={t("automatic.page.heading")} />
            <SettingCard id="smart-status" icon="calendar-time" heading={t("automatic.locked.heading")} extra={<s-badge icon="lock">{t("automatic.business")}</s-badge>} lead={t("automatic.locked.body")}>
              <FactList
                label={t("automatic.page.heading")}
                facts={[
                  { icon: "calendar-time", text: t("automatic.locked.schedule") },
                  { icon: "gauge", text: t("automatic.locked.budgets") },
                  { icon: "clipboard-checklist", text: t("automatic.locked.log") },
                ]}
              />
              <s-stack direction="inline">
                <Button href="/app/plan">{t("automatic.upsell.cta")}</Button>
              </s-stack>
            </SettingCard>
          </s-stack>
        </s-query-container>
      </s-page>
    );
  }

  // Before setup the summary shows what turning on would use: the form's schedule, languages, content and publishing.
  const suggestion = notConfigured
    ? { mode, times: schedule.ok ? schedule.spec.times : [], weekdays: schedule.ok ? schedule.spec.weekdays : [], locales: scope.locales }
    : null;
  // What the first check may use is counted on the server for the suggestion as loaded (the plan's languages, the
  // usual content, every field, no images or custom fields, outdated ones replaced). For another scope in the form
  // that figure isn't its own, so it isn't shown; a store never counted says so whatever the scope.
  const firstCheckShown = sameScope({ ...scope, fieldsChosen }, initial) || (panel.estimate === null && !panel.remeasure);
  const checkNow = t("automatic.action.checkNow");
  const modeKey: Mode = (MODES as readonly string[]).includes(mode) ? (mode as Mode) : "daily";
  const modeTiles: ChoiceTile[] = MODES.map((m) => ({
    value: m,
    name: t(`automatic.mode.${m}` as "automatic.mode.daily"),
    line: t(`automatic.mode.${m}.line` as "automatic.mode.manual.line", { checkNow }),
    ...MODE_LOOK[m],
  }));
  const runRow = (run: (typeof panel.runs)[number], index: number) => {
    const when = whenIn(i18n, run.createdAt, panel.zone, data.now, shopZone);
    const status = RUN_STATUS[run.status] ?? RUN_STATUS.QUEUED!;
    const failed = failedAction(run);
    return (
      <li key={run.id}>
        {index > 0 ? <s-divider /> : null}
        <s-box paddingBlock="small-100">
          <s-stack direction="block" gap="small-300">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type={run.trigger === "MANUAL" ? "play-circle" : "calendar-time"} color="subdued" />
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
              <StateLine icon="alert-triangle" tone={run.status === "FAILED" ? "critical" : "caution"}>
                {runReason(i18n, run.errorCode)}
              </StateLine>
            ) : null}
            {run.failed || run.jobs.length ? (
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                {run.failed ? (
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-icon type="alert-circle" tone="critical" />
                    <s-text tone="critical">{t("automatic.activity.failed", { count: run.failed })}</s-text>
                  </s-stack>
                ) : null}
                {/* Only what a new try can fix, and only while it runs: retried items would be cancelled again while paused or off. */}
                {failed.retry && panel.status.state === "on" && !readOnly ? (
                  <Button
                    variant="tertiary"
                    accessibilityLabel={`${t("automatic.action.retryFailed", { count: failed.retry })}: ${when}`}
                    onClick={() => act("retry", { runId: run.id })}
                    {...loading("retry", ["runId", run.id])}
                  >
                    {t("automatic.action.retryFailed", { count: failed.retry })}
                  </Button>
                ) : null}
                {/* The rest is fixed in the editor: its job lists them. */}
                {failed.job ? <s-link href={`/app/jobs/${failed.job}`}>{t("automatic.activity.seeJob")}</s-link> : null}
                {/* A run's image and custom-field jobs by the Jobs page's words ("Extra details (products)"), which the link opens. */}
                {run.jobs.slice(0, 3).map((job) => (
                  <s-link key={job.id} href={`/app/jobs/${job.id}`}>
                    {`${jobKindLabel(i18n, job.resourceType)} · ${languageNames.get(job.locale) ?? job.locale}`}
                  </s-link>
                ))}
              </s-stack>
            ) : null}
          </s-stack>
        </s-box>
      </li>
    );
  };
  const recent = panel.runs.slice(0, RUNS_SHOWN);
  const earlier = panel.runs.slice(RUNS_SHOWN);

  return (
    <s-page heading={t("automatic.page.heading")}>
      <s-link slot="breadcrumb-actions" href={SETTINGS_CHANGES}>
        {t("automatic.page.back")}
      </s-link>

      <s-query-container>
        <s-stack direction="block" gap="base">
          <Breadcrumbs i18n={i18n} trail={trail} current={t("automatic.page.heading")} touch />
          <PageHeader page="smart" title={t("automatic.page.heading")} lead={t("automatic.page.subtitle")} />

          {/* The form's refusal, at the top, where focus moves when it appears. */}
          {error ? (
            <div ref={errorRef} tabIndex={-1} style={{ outline: "none", scrollMarginTop: 16 }}>
              <s-banner tone="critical" heading={t("automatic.error.heading")}>
                <s-paragraph>{smartErrorText(i18n, error)}</s-paragraph>
              </s-banner>
            </div>
          ) : null}

          {/* The schedule as it is: its state, when it checks next, its actions, and what the last checks found. */}
          <section id="smart-status" aria-labelledby="smart-status-heading">
            <s-box {...CARD} padding="base">
              <div className="lv-smart-hero">
                <s-stack direction="block" gap="base">
                  <s-query-container>
                    <s-grid gridTemplateColumns="@container (inline-size > 680px) 1fr auto, 1fr" gap="base" alignItems="start">
                      {/* The page's header carries the schedule's sign; the card starts with what it is. */}
                      <s-stack direction="block" gap="small-300">
                        <s-stack direction="block" gap="small-500">
                          {/* The visual label; screen readers hear it inside the heading. */}
                          <span aria-hidden="true">
                            <s-text color="subdued">{t("automatic.hero.label")}</s-text>
                          </span>
                          <h2 id="smart-status-heading" tabIndex={-1} style={{ ...HERO_NAME, outline: "none" }}>
                            <s-text accessibilityVisibility="exclusive">{`${t("automatic.hero.spokenLabel")} `}</s-text>
                            {config ? scheduleSummary(i18n, config) : t("automatic.hero.notSetUp")}
                          </h2>
                        </s-stack>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-badge tone={stateBadge.tone === "neutral" ? undefined : stateBadge.tone} icon={stateBadge.icon}>
                            {stateBadge.label}
                          </s-badge>
                          <s-badge {...(data.entitled ? {} : { icon: "lock" as const })}>{t("automatic.business")}</s-badge>
                        </s-stack>
                        {/* "today, 11:00 PM": the zone only where it isn't the store's own. */}
                        {config && nextCheck !== undefined ? (
                          <StateLine icon="clock">{t("automatic.hero.nextCheck", { time: whenIn(i18n, nextCheck, panel.zone, data.now, shopZone, true) })}</StateLine>
                        ) : null}
                        {config ? (
                          <StateLine icon="language">{config.locales.length ? languageList(i18n, config.locales.map((l) => languageNames.get(l) ?? l), Infinity) : t("automatic.preview.none")}</StateLine>
                        ) : null}
                      </s-stack>
                      {/* Beside the summary on a wide card; on a phone under it, the main action at full width and the others side by side. */}
                      <div>
                        <div className="lv-smart-actions">{heroActions}</div>
                        {actionsNote ? <span className="lv-caption lv-smart-actions__note">{actionsNote}</span> : null}
                      </div>
                    </s-grid>
                  </s-query-container>
                  {readOnly ? (
                    <InlineNotice icon={stoppedByPlan ? "pause-circle" : "lock"} heading={t("settings.changes.line.notInPlan")}>
                      {stoppedByPlan ? t("automatic.page.notInPlan") : t("automatic.page.keptOff")}
                    </InlineNotice>
                  ) : (
                    <SmartStateBanner
                      status={panel.status}
                      zone={panel.zone}
                      onChooseLanguages={() => focusSection("smart-scope")}
                      consentAction={
                        consentNote ? (
                          <s-stack direction="block" gap="small-200">
                            {consentNote}
                            <s-stack direction="inline">{grantButton(heroVariant)}</s-stack>
                          </s-stack>
                        ) : (
                          <s-stack direction="inline">{grantButton(heroVariant)}</s-stack>
                        )
                      }
                    />
                  )}
                  {!readOnly && notConfigured ? <StateLine icon="info">{canTurnOn ? t("automatic.hero.setUpHint") : !data.consent ? t("automatic.blocked.CONSENT") : t("automatic.blocked.UNAVAILABLE")}</StateLine> : null}
                  {!readOnly && panel.status.state === "off" && data.basicOn && canTurnOn ? <StateLine icon="info">{t("settings.changes.replacesBasic")}</StateLine> : null}
                  {!readOnly && !notConfigured && panel.status.state === "off" && !canTurnOn ? (
                    <StateLine icon="info">{!data.consent ? t("automatic.blocked.CONSENT") : t("automatic.blocked.UNAVAILABLE")}</StateLine>
                  ) : null}
                  {/* Next to the summary's grant button: what it agrees to. */}
                  {!readOnly && panel.status.state === "off" && !data.consent ? consentNote : null}
                  {panel.noAccess.length ? (
                    <InlineNotice icon="lock" heading={t("automatic.noAccess.heading")} actions={accessHref ? <Button href={accessHref}>{t("coverage.types.allowAccess")}</Button> : undefined}>
                      {t("automatic.noAccess.body", { types: languageList(i18n, panel.noAccess.map((type) => jobKindLabel(i18n, type)), 4) })}
                    </InlineNotice>
                  ) : null}
                  {actionError ? (
                    <s-banner tone="critical" heading={t("automatic.error.actionHeading")}>
                      <s-paragraph>{smartErrorText(i18n, actionError)}</s-paragraph>
                    </s-banner>
                  ) : null}
                  {suggestion ? (
                    // Before setup: the suggestion the form holds, which "Turn on with these settings" saves, and what the first check may use.
                    <SmartPreview
                      data={{ ...panel, config: suggestion, publishing, types: scope.types, scheduleNote: liveProblem ? smartErrorText(i18n, liveProblem) : null }}
                      languageNames={languageNames}
                      omit={["nextCheck", "lastSuccess", "lastRun", ...(firstCheckShown ? [] : (["waiting"] as const))]}
                      now={data.now}
                      shopZone={shopZone}
                      firstCheck
                    />
                  ) : (
                    <SmartPreview
                      // How results go out now: automatically only while the plan includes it.
                      data={{ ...panel, publishing: panel.publishing ? effectivePublishMode({ mode: panel.publishing, inPlan: data.autoPublishInPlan }) : null }}
                      languageNames={languageNames}
                      // The summary names schedule, next check and languages; stopped by the plan nothing waits for a check.
                      omit={["languages", "schedule", "content", "nextCheck", ...(readOnly ? (["waiting"] as const) : [])]}
                      now={data.now}
                      shopZone={shopZone}
                    />
                  )}
                </s-stack>
              </div>
            </s-box>
          </section>

          {/* Recent checks: when, how it ended (icon and word), what it found and sent, and its jobs; the earlier ones folded. Before setup only if there are any. */}
          {config || panel.runs.length ? (
            <SettingCard id="smart-activity" icon="clipboard-checklist" heading={t("automatic.section.activity")} lead={t("automatic.section.activity.lead")}>
              {panel.runs.length === 0 ? (
                <InlineNotice icon="calendar-check" heading={t("automatic.activity.empty")}>
                  {t("automatic.activity.emptyBody")}
                </InlineNotice>
              ) : (
                <>
                  <ul aria-label={t("automatic.section.activity")} style={PLAIN_LIST}>
                    {recent.map(runRow)}
                  </ul>
                  {earlier.length ? (
                    <Disclosure summary={t("automatic.activity.more", { count: earlier.length })}>
                      {/* Named by what it holds, not by the fold's line that opens it. */}
                      <ul aria-label={t("automatic.activity.earlier")} style={PLAIN_LIST}>
                        {earlier.map(runRow)}
                      </ul>
                    </Disclosure>
                  ) : null}
                </>
              )}
            </SettingCard>
          ) : null}

          {/* What it never translates: one row each with its name and picture, removable here, added from an item's editor. Before setup only if there are any. */}
          {config || panel.exclusions.length ? (
            <SettingCard id="smart-exclusions" icon="hide" heading={t("automatic.section.exclusions")} lead={t("automatic.exclusions.body")}>
              {panel.exclusions.length ? (
                <ul aria-label={t("automatic.section.exclusions")} style={PLAIN_LIST}>
                  {panel.exclusions.map((e, index) => {
                    const kind = itemKindLabel(i18n, e.resourceType);
                    // Its name as Shopify has it; its kind and number where Shopify didn't answer.
                    const name = e.title ?? `${kind} ${e.resourceGid.split("/").pop()}`;
                    return (
                      <li key={e.resourceGid}>
                        {index > 0 ? <s-divider /> : null}
                        <s-box paddingBlock="small-200">
                          <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-300" alignItems="center">
                            {e.image ? <img className="lv-smart-thumb" src={e.image.url} alt="" width={40} height={40} loading="lazy" /> : <IconSquare icon={kindIcon(e.resourceType)} />}
                            <s-stack direction="block" gap="small-500">
                              {e.href ? <s-link href={e.href}>{name}</s-link> : <Strong>{name}</Strong>}
                              {e.title ? <s-text color="subdued">{kind}</s-text> : null}
                            </s-stack>
                            <Button
                              variant="tertiary"
                              accessibilityLabel={`${t("automatic.action.remove")}: ${name}`}
                              onClick={() => act("remove-exclusion", { resourceGid: e.resourceGid })}
                              {...loading("remove-exclusion", ["resourceGid", e.resourceGid])}
                            >
                              {t("automatic.action.remove")}
                            </Button>
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
          ) : null}

          {readOnly ? null : (
            <ui-save-bar id={SAVE_BAR}>
              <button variant="primary" onClick={() => formRef.current?.requestSubmit()} {...(settingsFetcher.state !== "idle" ? { loading: "" } : {})}>
                {saveTurnsOn ? t("automatic.action.saveAndTurnOn") : t("automatic.action.save")}
              </button>
              <button onClick={discard}>{t("automatic.action.discard")}</button>
            </ui-save-bar>
          )}

          <settingsFetcher.Form key={formKey} method="post" ref={formRef} onChange={read} onInput={read}>
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="version" value={config?.version ?? 0} />
            {saveTurnsOn ? <input type="hidden" name="turnOn" value="true" /> : null}
            {saveTurnsOn && data.basicOn ? <input type="hidden" name="replaceBasic" value="true" /> : null}
            <input type="hidden" name="publishMode" value={publishMode} />
            {publishConfirmed ? <input type="hidden" name="confirmPublish" value="on" /> : null}
            <s-stack direction="block" gap="base">
              {/* When: how often as square tiles; under them the chosen way's time, days and zone with its next checks. */}
              <SettingCard id="smart-schedule" icon="calendar-time" heading={t("automatic.section.schedule")} lead={t("automatic.section.schedule.lead")}>
                <ChoiceTiles name="mode" legend={t("automatic.mode.label")} options={modeTiles} defaultValue={initial.mode} disabled={readOnly} />
                <div className="lv-option-panel">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <IconSquare icon={MODE_LOOK[modeKey].icon} tint={MODE_LOOK[modeKey].tint} size={28} />
                        <Strong>{t(`automatic.mode.${modeKey}` as "automatic.mode.daily")}</Strong>
                      </s-stack>
                      <s-text color="subdued">{t(`automatic.mode.${modeKey}.details` as "automatic.mode.realtime.details", { basic: t("settings.changes.basic.title"), checkNow })}</s-text>
                    </s-stack>
                    <s-query-container>
                      <s-grid gridTemplateColumns={modeKey === "manual" ? "1fr" : "@container (inline-size > 640px) 1fr 1fr, 1fr"} gap="large" alignItems="start">
                        {modeKey === "manual" ? (
                          <input type="hidden" name="timeZone" value={zone} />
                        ) : (
                          <s-stack direction="block" gap="base">
                            {modeKey === "custom" ? (
                              <s-stack direction="block" gap="small-200">
                                <s-text>{t("automatic.times.label")}</s-text>
                                <s-query-container>
                                  <s-grid gridTemplateColumns="@container (inline-size > 380px) 1fr 1fr, 1fr" gap="small-200">
                                    {slots.map((slot, i) => (
                                      <s-grid key={slot.id} gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="end">
                                        <s-select id={`smart-slot-${slot.id}`} name="customTime" label={t("automatic.times.slot", { number: i + 1 })} value={slot.value} icon="clock" disabled={readOnly}>
                                          {TIME_OPTIONS.map((o) => (
                                            <s-option key={o.value} value={o.value}>
                                              {i18n.clock(o.minute)}
                                            </s-option>
                                          ))}
                                        </s-select>
                                        {slots.length > 1 && !readOnly ? (
                                          <Button
                                            variant="tertiary"
                                            icon="x"
                                            accessibilityLabel={t("automatic.times.remove", { number: i + 1 })}
                                            tooltip={t("automatic.times.remove", { number: i + 1 })}
                                            onClick={() => removeSlot(slot.id)}
                                          />
                                        ) : null}
                                      </s-grid>
                                    ))}
                                  </s-grid>
                                </s-query-container>
                                {slots.length < MAX_TIMES_PER_DAY && !readOnly ? (
                                  <s-stack direction="inline">
                                    <Button variant="tertiary" icon="plus" onClick={addSlot}>
                                      {t("automatic.times.add")}
                                    </Button>
                                  </s-stack>
                                ) : null}
                                {timeError ? (
                                  <StateLine icon="alert-circle" tone="critical">
                                    {timeError}
                                  </StateLine>
                                ) : null}
                              </s-stack>
                            ) : (
                              <s-select
                                id="smart-time"
                                name="time"
                                label={modeKey === "realtime" ? t("automatic.time.dailyCheck") : t("automatic.time.label")}
                                value={time}
                                icon="clock"
                                disabled={readOnly}
                                {...(timeError ? { error: timeError } : {})}
                              >
                                {TIME_OPTIONS.map((o) => (
                                  <s-option key={o.value} value={o.value}>
                                    {i18n.clock(o.minute)}
                                  </s-option>
                                ))}
                              </s-select>
                            )}
                            {modeKey === "weekly" || modeKey === "custom" ? (
                              <s-stack direction="block" gap="small-200">
                                <DayToggles name="weekday" legend={t("automatic.weekdays.label")} checked={weekdays} disabled={readOnly} {...(daysError ? { errorId: "smart-days-error" } : {})} />
                                {daysError ? (
                                  <div id="smart-days-error">
                                    <StateLine icon="alert-circle" tone="critical">
                                      {daysError}
                                    </StateLine>
                                  </div>
                                ) : null}
                              </s-stack>
                            ) : null}
                            {/* The zone in one line; its long list only after "Change". */}
                            {zoneShown ? (
                              <s-select id="smart-zone" name="timeZone" label={t("automatic.zone.label")} value={zone} disabled={readOnly} {...(zoneError ? { error: zoneError } : {})}>
                                {data.zones.map((z) => (
                                  <s-option key={z} value={z}>
                                    {z === data.shopTimeZone ? t("automatic.zone.shop", { zone: z }) : z}
                                  </s-option>
                                ))}
                              </s-select>
                            ) : (
                              <s-stack direction="inline" gap="small-200" alignItems="center">
                                <input type="hidden" name="timeZone" value={zone} />
                                <s-text>{t("automatic.zone.line", { zone: zone === data.shopTimeZone ? t("automatic.zone.shop", { zone }) : zone })}</s-text>
                                {readOnly ? null : (
                                  <Button variant="tertiary" accessibilityLabel={`${t("automatic.zone.change")}: ${t("automatic.zone.label")}`} onClick={openZone}>
                                    {t("automatic.zone.change")}
                                  </Button>
                                )}
                              </s-stack>
                            )}
                          </s-stack>
                        )}
                        <s-stack direction="block" gap="small-200">
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-icon type="calendar-list" color="subdued" />
                            <h3 style={SUB_HEADING}>{t("automatic.next.label")}</h3>
                          </s-stack>
                          {upcoming.length ? (
                            <s-ordered-list>
                              {upcoming.map((at) => (
                                <s-list-item key={at}>{t("automatic.schedule.zone", { time: i18n.dateTimeIn(at, zone), zone })}</s-list-item>
                              ))}
                            </s-ordered-list>
                          ) : liveProblem ? (
                            <StateLine icon="alert-triangle" tone="caution">
                              {smartErrorText(i18n, liveProblem)}
                            </StateLine>
                          ) : (
                            <s-text color="subdued">{t("automatic.next.none")}</s-text>
                          )}
                        </s-stack>
                      </s-grid>
                    </s-query-container>
                  </s-stack>
                </div>
              </SettingCard>

              {/* What: languages, the content by area (as the Content page groups it), the fields, and outdated translations; four labels at one level. */}
              <SettingCard id="smart-scope" icon="language-translate" heading={t("automatic.section.scope")} lead={t("automatic.section.scope.lead")}>
                {backIn("smart-scope")}
                <s-stack direction="block" gap="small-200">
                  <h3 style={SUB_HEADING}>{t("automatic.languages.label")}</h3>
                  <s-choice-list
                    name="locale"
                    label={t("automatic.languages.label")}
                    labelAccessibilityVisibility="exclusive"
                    multiple
                    disabled={readOnly}
                    {...(languagesError ? { error: languagesError } : {})}
                  >
                    {data.languages
                      .filter((l) => l.inPlan)
                      .map((l) => (
                        <s-choice key={l.locale} value={l.locale} defaultSelected={initial.locales.includes(l.locale)}>
                          {languageNames.get(l.locale)}
                        </s-choice>
                      ))}
                  </s-choice-list>
                  {outside.length ? (
                    <StateLine icon="lock">
                      {t("settings.auto.outsidePlan", {
                        languages: languageList(i18n, outside.map((l) => languageNames.get(l.locale) ?? l.locale), Infinity),
                        count: outside.length,
                      })}{" "}
                      <s-link href="/app/plan">{t("automatic.upsell.cta")}</s-link>
                    </StateLine>
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
                                  <TypeCheckbox
                                    type={types[0]!}
                                    // An area named apart from its kind says both ("Size charts & more (Metaobjects)").
                                    label={areaLabel(i18n, area, types[0]!)}
                                    checked={chosenTypes.has(types[0]!)}
                                    i18n={i18n}
                                    disabled={readOnly}
                                    engines={data.engines.text}
                                  />
                                </div>
                              ) : (
                                <div role="group" aria-labelledby={`smart-area-${area}`} style={{ paddingTop: 4 }}>
                                  <s-stack direction="block" gap="small-200">
                                    <span id={`smart-area-${area}`} style={SETTING_NAME}>
                                      {area === "other" ? t("automatic.types.label") : categoryName(i18n, area)}
                                    </span>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
                                      {types.map((type) => (
                                        <TypeCheckbox key={type} type={type} label={kindLabel(i18n, type)} checked={chosenTypes.has(type)} i18n={i18n} disabled={readOnly} engines={data.engines.text} />
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
                  {typesError ? (
                    <StateLine icon="alert-circle" tone="critical">
                      {typesError}
                    </StateLine>
                  ) : null}
                  <s-checkbox
                    name="attached"
                    label={t("automatic.attached.label")}
                    details={t("automatic.attached.details")}
                    disabled={readOnly}
                    {...(config?.includeAttached ? { defaultChecked: true } : {})}
                  />
                </s-stack>
                <s-divider />
                <s-stack direction="block" gap="small-200">
                  <h3 style={SUB_HEADING}>{t("automatic.fields.label")}</h3>
                  <s-choice-list name="fields" label={t("automatic.fields.label")} labelAccessibilityVisibility="exclusive" disabled={readOnly}>
                    <s-choice value="all" defaultSelected={!initial.fieldsChosen}>
                      {t("automatic.fields.all")}
                    </s-choice>
                    <s-choice value="chosen" defaultSelected={initial.fieldsChosen}>
                      {t("automatic.fields.chosen")}
                    </s-choice>
                  </s-choice-list>
                  {fieldsChosen ? (
                    <s-box background="subdued" borderRadius="large-100" padding="base">
                      <s-choice-list name="group" label={t("automatic.fields.groups")} multiple disabled={readOnly} {...(groupsError ? { error: groupsError } : {})}>
                        {SMART_FIELD_GROUPS.map((g) => (
                          <s-choice key={g} value={g} defaultSelected={config?.fieldGroups.includes(g) ?? false}>
                            {/* The Coverage page's names for the field groups ("Titles and names", "SEO titles"), never the codes. */}
                            {t(`coverage.group.${g}`)}
                          </s-choice>
                        ))}
                      </s-choice-list>
                    </s-box>
                  ) : null}
                </s-stack>
                <s-divider />
                {/* Outdated translations: the app's state word, its two choices as tiles like the schedule's. */}
                <div id="smart-outdated">
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="block" gap="small-500">
                      <h3 style={SUB_HEADING}>{t("automatic.outdated.label")}</h3>
                      <s-text color="subdued">{t("automatic.section.outdated.lead")}</s-text>
                    </s-stack>
                    <ChoiceTiles
                      name="outdated"
                      legend={t("automatic.outdated.label")}
                      legendHidden
                      disabled={readOnly}
                      defaultValue={config?.replaceOutdatedMachine === false ? "keep" : "replace"}
                      options={[
                        { value: "replace", name: t("automatic.outdated.replace"), line: t("automatic.outdated.replace.details") },
                        { value: "keep", name: t("automatic.outdated.keep"), line: t("automatic.outdated.keep.details", { outdated: t("coverage.state.outdated") }) },
                      ]}
                    />
                  </s-stack>
                </div>
              </SettingCard>

              {/* Publishing: the same choice as on Settings, for the smart schedule's own results. */}
              <SettingCard id="smart-publishing" icon="send" heading={t("automatic.section.publishing")} lead={t("automatic.section.publishing.lead")}>
                <PublishingChoice
                  id="smart-publish"
                  mode={publishing}
                  inPlan={data.autoPublishInPlan}
                  busy={readOnly}
                  onChoose={(next, confirmed) => {
                    if (next === publishMode) return;
                    publishChosen.current = true;
                    setPublishMode(next);
                    setPublishConfirmed(confirmed);
                    changed();
                  }}
                />
              </SettingCard>

              {/* Budgets: optional caps below the plan's AI characters, each with how much of it is used. */}
              <SettingCard id="smart-budgets" icon="gauge" heading={t("automatic.section.budgets")} lead={t("automatic.section.budgets.lead")}>
                {backIn("smart-budgets")}
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, 1fr" gap="large base">
                    <s-stack direction="block" gap="base">
                      <s-number-field
                        name="dailyBudget"
                        label={t("automatic.budget.daily")}
                        placeholder={t("automatic.budget.none")}
                        suffix={t("automatic.budget.unit")}
                        min={1}
                        max={data.allowance}
                        step={1}
                        disabled={readOnly}
                        defaultValue={config?.dailyBudget ? String(config.dailyBudget) : ""}
                        {...(config?.dailyBudget ? { details: t("automatic.budget.saved", { chars: number(config.dailyBudget) }) } : {})}
                        {...(budgetError ? { error: budgetError } : {})}
                      />
                      <BudgetMeter label={t("automatic.budget.usedToday")} used={panel.usage.today} budget={config?.dailyBudget ?? null} />
                    </s-stack>
                    <s-stack direction="block" gap="base">
                      <s-number-field
                        name="monthlyBudget"
                        label={t("automatic.budget.monthly")}
                        placeholder={t("automatic.budget.none")}
                        suffix={t("automatic.budget.unit")}
                        min={1}
                        max={data.allowance}
                        step={1}
                        disabled={readOnly}
                        defaultValue={config?.monthlyBudget ? String(config.monthlyBudget) : ""}
                        {...(config?.monthlyBudget ? { details: t("automatic.budget.saved", { chars: number(config.monthlyBudget) }) } : {})}
                        {...(budgetError ? { error: budgetError } : {})}
                      />
                      <BudgetMeter label={t("automatic.budget.usedMonth", { month: i18n.month(monthOf(data.now, panel.zone)) })} used={panel.usage.month} budget={config?.monthlyBudget ?? null} />
                    </s-stack>
                  </s-grid>
                </s-query-container>
                <FactList
                  label={t("automatic.section.budgets")}
                  facts={[
                    { key: "help", icon: "info", text: t("automatic.budget.help", { allowance: number(data.allowance) }) },
                    ...(data.trial
                      ? [{ key: "trial", icon: "clock" as const, text: t("automatic.budget.trial", { date: i18n.date(data.trial.endsAt), trial: number(data.allowance), limit: number(data.trial.limit) }) }]
                      : []),
                  ]}
                />
              </SettingCard>

              {/* The save bar is the main way to save; this one is for pages opened without it, secondary, and only while there is something to save. */}
              {readOnly || !(dirty || saveToContinue) ? null : (
                <s-stack direction="inline" gap="small-200 base" alignItems="center">
                  <Button type="submit" {...(settingsFetcher.state !== "idle" ? { loading: true } : {})}>
                    {saveTurnsOn ? t("automatic.action.saveAndTurnOn") : t("automatic.action.save")}
                  </Button>
                  <s-text color="subdued">{t("automatic.save.note")}</s-text>
                </s-stack>
              )}
            </s-stack>
          </settingsFetcher.Form>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

/** One custom check time in the form, with a key that stays when another one is taken away. */
interface Slot {
  id: number;
  value: string;
}

/** The custom times the form starts with: the saved ones, or the one time of another mode. */
function slotsOf(initial: { mode: string; times: readonly number[] }): Slot[] {
  const times = initial.mode === "custom" && initial.times.length ? initial.times : [initial.times[0] ?? REALTIME_CHECK_MINUTE];
  return times.slice(0, MAX_TIMES_PER_DAY).map((minute, id) => ({ id, value: formatTime(minute) }));
}

/** The month a budget counts in ("2026-11"), in the schedule's zone. */
function monthOf(now: number, zone: string): string {
  const { year, month } = wallClock(now, zone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** An excluded item's icon when it has no picture: its area's, as on the Content page. */
function kindIcon(resourceType: string): IconName {
  const area = categoryOf(resourceType);
  return area && isCategoryId(area) ? CATEGORIES[area].icon : "content";
}

/** A single-kind area's checkbox: the area's name, with the kind where the two differ ("Size charts & more (Metaobjects)"). */
function areaLabel(i18n: ReturnType<typeof useI18n>, area: CategoryId | "other", type: SmartType): string {
  const kind = kindLabel(i18n, type);
  if (area === "other") return kind;
  const name = categoryName(i18n, area);
  return name === kind ? kind : `${name} (${kind})`;
}

/** A content type of the smart schedule, with the personal-data note where it applies. */
function TypeCheckbox({
  type,
  label,
  checked,
  i18n,
  disabled,
  engines,
}: {
  type: SmartType;
  label: string;
  checked: boolean;
  i18n: ReturnType<typeof useI18n>;
  disabled: boolean;
  /** The services the texts name: DeepL only keeps today's note. */
  engines: readonly ConsentToken[];
}) {
  const personal = isDeepLOnly(engines) ? i18n.t("automatic.types.personal") : i18n.t("automatic.types.personal.multi", { engines: enginesText(i18n, engines) });
  return (
    <s-checkbox
      name="type"
      value={type}
      label={label}
      disabled={disabled}
      {...(SMART_PERSONAL_DATA_TYPES.has(type) ? { details: personal } : {})}
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

/** Why a check was skipped, didn't finish or stopped translating, as a sentence. */
function runReason(i18n: ReturnType<typeof useI18n>, code: string | null): string {
  if (code && RUN_REASONS.includes(code)) return i18n.t(`automatic.activity.reason.${code}` as "automatic.activity.reason.other");
  return (code ? jobErrorMessage(i18n, code) : null) ?? i18n.t("automatic.activity.reason.other");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
