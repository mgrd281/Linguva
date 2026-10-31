/**
 * Settings: what Linguva may do and how it translates. At a glance first
 * (each state with its reason, a tile per card), then the cards in the
 * order a merchant needs them: the AI permission while it is missing, how
 * changes are translated (nothing, shortly after saving, on a schedule),
 * publishing, the form of address, translation memory, the permission once
 * given, and the tools. Every state says what really happens: "On" only
 * when the work runs (plan, installation, permission, pause, languages).
 */
import { useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { aiLimitsFor, shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { countTerms } from "../.server/glossary/glossary";
import { getConfig } from "../.server/lib/config";
import { prisma } from "../.server/lib/db";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { getTranslationProvider } from "../.server/providers";
import { getQueues } from "../.server/queue/client";
import {
  AI_STORE_CONTEXT_MAX,
  autoTranslatePaused,
  ConfirmationRequiredError,
  formalityFor,
  getShopSettings,
  hasCurrentAiConsent,
  setAiConsent,
  setAutoTranslate,
  setBulkPublishMode,
  setReuseMachineMemory,
  setTranslationStyle,
} from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { getSmartConfig, setSmartEnabled } from "../.server/smart/config";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { settleAfterConsent } from "../.server/smart/runs";
import { getMonthlyUsage, nextPeriodStart, periodKey } from "../.server/usage/usage-ledger";
import { useResultToast, useSaveBar } from "../components/app-bridge";
import { NoLanguagesCard } from "../components/ContentTiles";
import { Flag } from "../components/Flag";
import { BIG_HEADING, PLAIN_LIST } from "../components/LanguageLayout";
import { PublishingChoice, type PublishMode } from "../components/PublishingChoice";
import {
  Actions,
  FactList,
  focusById,
  focusCard,
  Glance,
  InlineNotice,
  LinkTiles,
  LockLine,
  More,
  OptionCard,
  OptionGrid,
  SettingCard,
  StateLine,
  useFreshResult,
  type GlanceTile,
  type SettingState,
} from "../components/SettingsParts";
import { scheduleSummary, smartErrorText, SmartStateBanner, smartToast } from "../components/SmartAutoCard";
import type { I18n } from "../i18n/i18n";
import { useI18n } from "../i18n/react";
import { basicState, changesMode, effectivePublishMode, smartState, type BasicState, type SmartState } from "../lib/automation-state";
import { localeCountry } from "../lib/flags";
import { formalityPronouns, supportsFormality } from "../lib/formality";
import { languageList } from "../lib/name-lists";
import { entitlementsFor, TRIAL_AI_CHARS } from "../lib/plans";
import { usagePercent } from "../lib/plan-view";
import { usageLevel } from "../lib/usage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  // One clock for the month, its renewal and the dates shown.
  const now = new Date();
  const [settings, locales, billing, smartConfig, glossaryTerms] = await Promise.all([
    getShopSettings(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
    shopBilling(admin, shop),
    getSmartConfig(shop.id),
    countTerms(shop.id),
  ]);
  // The same allowance as the Overview, editor and Plan page (the plan's, when billing is on).
  const limits = aiLimitsFor(getConfig(), billing);
  const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
  // The smart schedule on Business, and also after a move to a plan without it: its settings are kept, and it is stopped.
  const context = await smartContext(billing, settings, targets);
  const smart = context.entitled || smartConfig ? await loadSmartPanel(shop.id, { ...context, shopTimeZone: null, now }) : null;
  const period = periodKey(now);
  const nextMonth = nextPeriodStart(now);
  // New AI characters arrive with the UTC month, or when a running trial ends first and the plan's own allowance starts then (as on the Plan page).
  const trialRise =
    billing.trialEndsAt && billing.trialEndsAt < nextMonth && entitlementsFor(billing.subscription?.planHandle).monthlyChars > TRIAL_AI_CHARS ? billing.trialEndsAt : null;
  return {
    // One Check now per page view (a double click is one check).
    smartCheckKey: crypto.randomUUID(),
    smart: smart
      ? {
          entitled: context.entitled,
          status: smart.status,
          zone: smart.zone,
          config: smart.config,
          nextChecks: smart.nextChecks,
        }
      : null,
    style: {
      languages: locales.locales
        .filter((l) => !l.primary)
        .map((l) => ({ locale: l.locale, name: l.name, formality: formalityFor(settings, l.locale) ?? "default" })),
      storeContext: settings.aiStoreContext ?? "",
      maxContext: AI_STORE_CONTEXT_MAX,
    },
    glossaryTerms,
    consent: hasCurrentAiConsent(settings),
    consentAt: settings.aiDataProcessingConsentAt?.toISOString() ?? null,
    publishMode: settings.bulkPublishMode,
    // Shown before a click; the action checks the plan again, and jobs publish automatically only while it is included.
    autoPublishInPlan: billing.entitlements.autoPublish,
    reuseMachineMemory: settings.reuseMachineMemory,
    auto: {
      enabled: settings.autoTranslateNew,
      locales: settings.autoTranslateLocales,
      // Needs AI, background jobs and a plan that includes translating whole areas.
      available: getTranslationProvider() !== null && getQueues() !== null,
      planIncludes: billing.entitlements.bulk,
      // The plan's languages: the first ones in the order listed here, as for bulk jobs and the editor.
      allowedLocales: allowedTargetLocales(billing.entitlements, targets),
      paused: autoTranslatePaused(settings) ? { until: settings.autoPausedUntil!.toISOString(), reason: settings.autoPauseReason ?? "PROVIDER" } : null,
    },
    aiAvailable: getTranslationProvider() !== null,
    now: now.toISOString(),
    resetsOn: (trialRise ?? nextMonth).toISOString(),
    used: await getMonthlyUsage(shop.id, period),
    limit: limits.limit,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "style") {
    const locales = await fetchAndSyncShopLocales(admin, shop.id);
    const allowed = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
    const formality: Record<string, string> = {};
    for (const locale of allowed) formality[locale] = String(form.get(`formality:${locale}`) ?? "");
    await setTranslationStyle({ shopId: shop.id, formality, storeContext: String(form.get("storeContext") ?? ""), allowedLocales: allowed });
    return { ok: true, saved: "style" as const };
  }
  if (intent === "publish-mode") {
    if (form.get("mode") === "AUTO_PUBLISH" && !(await shopBilling(admin, shop)).entitlements.autoPublish) {
      return { ok: false, error: "PLAN_AUTO_PUBLISH" };
    }
    try {
      const mode = form.get("mode") === "AUTO_PUBLISH" ? ("AUTO_PUBLISH" as const) : ("DRAFT" as const);
      await setBulkPublishMode({ shopId: shop.id, mode, confirmed: form.get("confirm") === "on", actorId });
      return { ok: true, saved: "publish" as const, mode };
    } catch (error) {
      if (error instanceof ConfirmationRequiredError) return { ok: false, error: "CONFIRMATION_REQUIRED" };
      throw error;
    }
  }
  if (intent === "auto") {
    const enabled = form.get("enabled") === "true";
    const billing = await shopBilling(admin, shop);
    const smart = await getSmartConfig(shop.id);
    // The smart schedule and this would follow the same changes: turning this on replaces it, and only when the form says so.
    const replaceSmart = enabled && Boolean(smart?.enabled);
    if (enabled) {
      if (!hasCurrentAiConsent(await getShopSettings(shop.id))) return { ok: false, error: "CONSENT_REQUIRED" };
      if (!billing.entitlements.bulk) return { ok: false, error: "PLAN_BULK" };
      if (replaceSmart && form.get("replaceSmart") !== "true") return { ok: false, error: "SMART_ON" };
    }
    const locales = await fetchAndSyncShopLocales(admin, shop.id);
    const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
    const allowed = allowedTargetLocales(billing.entitlements, targets);
    // s-choice-list submits its selected values as one comma-separated value.
    const chosen = form.getAll("locale").flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean);
    // Checked before anything is written: a refused choice changes nothing.
    if (enabled) {
      if (chosen.some((l) => targets.includes(l) && !allowed.includes(l))) return { ok: false, error: "PLAN_LANGUAGE" };
      if (!chosen.some((l) => allowed.includes(l))) return { ok: false, error: "NO_LANGUAGE" };
    }
    if (replaceSmart) await setSmartEnabled({ shopId: shop.id, actorId, enabled: false });
    const result = await setAutoTranslate({ shopId: shop.id, enabled, locales: chosen, allowedLocales: allowed, actorId });
    return { ok: true, saved: "auto" as const, autoEnabled: result.enabled, replacedSmart: replaceSmart };
  }
  if (intent === "reuse-memory") {
    const enabled = form.get("enabled") === "true";
    await setReuseMachineMemory({ shopId: shop.id, enabled });
    return { ok: true, saved: "memory" as const, reuse: enabled };
  }
  if (intent !== "grant-consent" && intent !== "revoke-consent") {
    return { ok: false };
  }
  await setAiConsent({ shopId: shop.id, granted: intent === "grant-consent", actorId });
  // The smart schedule waits for consent no longer than needed.
  if (intent === "grant-consent") await settleAfterConsent({ prisma, adminFor: async () => admin, billingFor: async () => shopBilling(admin, shop) }, shop);
  return { ok: true, saved: "consent" as const, granted: intent === "grant-consent" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type SmartResult = { ok: boolean; done?: string; count?: number; error?: string };

const STYLE_SAVE_BAR = "settings-style-save-bar";
const REVOKE_MODAL = "settings-revoke";
/** Automatic translation's pause reasons with their own long text (any other reads as the AI service's). */
const AUTO_PAUSE_REASONS = ["DAILY_LIMIT", "PLATFORM_LIMIT", "QUOTA_EXCEEDED"];
/** A pause's reason in a few words, for automatic translation's and the smart schedule's reasons. */
const PAUSE_SHORT: Record<string, string> = {
  DAILY_LIMIT: "DAILY_LIMIT",
  DAILY_CAP: "DAILY_LIMIT",
  PLATFORM_LIMIT: "PLATFORM_LIMIT",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  PLAN_ALLOWANCE: "QUOTA_EXCEEDED",
  BUDGET_DAILY: "BUDGET_DAILY",
  BUDGET_MONTHLY: "BUDGET_MONTHLY",
  PRIMARY_LANGUAGE: "PRIMARY_LANGUAGE",
};

/** The pages beside the settings that aren't in the navigation (the glossary and memory open from their cards). */
const TOOLS = [
  { href: "/app/languages", icon: "language", label: "common.languages", detail: "settings.tools.languages.detail" },
  { href: "/app/markets", icon: "globe", label: "settings.tools.markets.label", detail: "settings.tools.markets.detail" },
  { href: "/app/coverage", icon: "chart-donut", label: "settings.tools.coverage.label", detail: "settings.tools.coverage.detail" },
  { href: "/app/translations", icon: "transfer", label: "transfer.page.heading", detail: "settings.tools.transfer.detail" },
] as const;

// ─── States in words ──────────────────────────────────────────────────────────

function basicBadge(i18n: I18n, state: BasicState): SettingState {
  const { t } = i18n;
  switch (state) {
    case "on":
      return { label: t("common.state.on"), icon: "check-circle", tone: "success" };
    case "plan":
      return { label: t("settings.changes.state.stopped"), icon: "lock", tone: "critical" };
    case "unavailable":
      return { label: t("settings.changes.state.unavailable"), icon: "disabled", tone: "neutral" };
    case "consent":
      return { label: t("settings.changes.state.waiting"), icon: "clock", tone: "warning" };
    case "paused":
      return { label: t("settings.changes.state.paused"), icon: "pause-circle", tone: "warning" };
    case "noLanguage":
      return { label: t("settings.changes.state.waiting"), icon: "alert-triangle", tone: "warning" };
    default:
      return { label: t("common.state.off"), icon: "minus-circle", tone: "neutral" };
  }
}

function smartBadge(i18n: I18n, state: SmartState): SettingState {
  const { t } = i18n;
  if (state === "on") return { label: t("common.state.on"), icon: "check-circle", tone: "success" };
  if (state === "paused" || state === "plan") return { label: t("settings.changes.state.paused"), icon: "pause-circle", tone: "warning" };
  if (state === "waiting") return { label: t("settings.changes.state.waiting"), icon: "clock", tone: "warning" };
  return { label: t("common.state.off"), icon: "minus-circle", tone: "neutral" };
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const consentFetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
  const styleFetcher = useFetcher<typeof action>();
  const autoFetcher = useFetcher<typeof action>();
  // The smart schedule's actions go to its page's action, which checks the plan again.
  const smartFetcher = useFetcher<SmartResult>();

  // Confirmations: a toast for what was saved; problems stay on the page.
  useResultToast(smartFetcher.data, smartToast(t, smartFetcher.data));
  useResultToast(styleFetcher.data, styleFetcher.data && "saved" in styleFetcher.data ? t("settings.style.saved") : null);
  useResultToast(
    autoFetcher.data,
    autoFetcher.data && "autoEnabled" in autoFetcher.data ? (autoFetcher.data.autoEnabled ? t("settings.auto.savedOn") : t("settings.auto.savedOff")) : null,
  );
  useResultToast(
    modeFetcher.data,
    modeFetcher.data && "mode" in modeFetcher.data ? (modeFetcher.data.mode === "AUTO_PUBLISH" ? t("settings.publish.savedAuto") : t("settings.publish.savedReview")) : null,
  );
  useResultToast(memoryFetcher.data, memoryFetcher.data && "reuse" in memoryFetcher.data ? t("settings.memory.saved") : null);
  useResultToast(
    consentFetcher.data,
    consentFetcher.data && "granted" in consentFetcher.data ? (consentFetcher.data.granted ? t("settings.ai.savedAllowed") : t("settings.ai.savedRevoked")) : null,
  );

  // After a switch, focus moves to the choice that is now current.
  useFreshResult(memoryFetcher, (result) => {
    if (result && "reuse" in result) focusById(result.reuse ? "settings-memory-machine" : "settings-memory-approved");
  });
  useFreshResult(modeFetcher, (result) => {
    if (result && "mode" in result) focusById(result.mode === "AUTO_PUBLISH" ? "settings-publish-auto" : "settings-publish-review");
  });
  useFreshResult(autoFetcher, (result) => {
    if (result && "autoEnabled" in result) focusById(result.autoEnabled ? "settings-changes-basic" : "settings-changes-manual");
  });
  useFreshResult(smartFetcher, (result) => {
    if (result?.ok && (result.done === "on" || result.done === "off")) focusById(result.done === "on" ? "settings-changes-smart" : "settings-changes-manual");
  });
  // Permission given: on to the next step, the card that is now where the permission was. Withdrawn: to the permission, now first.
  useFreshResult(consentFetcher, (result) => {
    if (result && "granted" in result) focusCard(result.granted ? "settings-changes" : "settings-ai");
  });

  const hasLanguages = data.style.languages.length > 0;
  // The page's one primary button is the next step that is needed: a language, then the permission.
  const consentPrimary = hasLanguages && !data.consent;

  const glance = glanceTiles(data, i18n);
  const permission = <PermissionCard data={data} i18n={i18n} fetcher={consentFetcher} primary={consentPrimary} />;

  return (
    <s-page heading={t("common.nav.settings")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-500">
          <h1 style={BIG_HEADING}>{t("common.nav.settings")}</h1>
          <s-text color="subdued">{t("settings.subtitle")}</s-text>
        </s-stack>
        {hasLanguages ? null : <NoLanguagesCard i18n={i18n} body={t("settings.noLanguages.body")} />}
        <Glance label={t("settings.glance")} tiles={glance} />
        {data.consent ? null : permission}
        <ChangesCard data={data} i18n={i18n} autoFetcher={autoFetcher} smartFetcher={smartFetcher} consentFetcher={consentFetcher} />
        <PublishingCard data={data} i18n={i18n} fetcher={modeFetcher} />
        <StyleCard data={data} i18n={i18n} fetcher={styleFetcher} />
        <MemoryCard data={data} i18n={i18n} fetcher={memoryFetcher} />
        {data.consent ? permission : null}
        <SettingCard id="settings-tools" icon="wrench" heading={t("settings.tools.heading")}>
          <LinkTiles label={t("settings.tools.heading")} links={TOOLS.map((tool) => ({ href: tool.href, icon: tool.icon, name: t(tool.label), detail: t(tool.detail) }))} />
        </SettingCard>
      </s-stack>
    </s-page>
  );
}

// ─── At a glance ──────────────────────────────────────────────────────────────

/** Six tiles: each state with its reason or value, never a generic sentence. */
function glanceTiles(data: Data, i18n: I18n): GlanceTile[] {
  const { t } = i18n;
  const changes = changesView(data, i18n);
  const publish = effectivePublishMode({ mode: data.publishMode, inPlan: data.autoPublishInPlan });
  const publishLine =
    data.publishMode === "AUTO_PUBLISH" && !data.autoPublishInPlan
      ? t("settings.glance.publish.notInPlan")
      : publish === "AUTO_PUBLISH"
        ? t("settings.glance.publish.auto")
        : t("settings.glance.publish.review");
  const formalities = data.style.languages.filter((l) => supportsFormality(l.locale)).map((l) => l.formality);
  const address = !data.style.languages.length
    ? t("settings.glance.style.noLanguage")
    : formalities.every((f) => f === "default")
      ? t("settings.style.deeplDecides")
      : formalities.every((f) => f === "more")
        ? t("settings.style.formal")
        : formalities.every((f) => f === "less")
          ? t("settings.style.informal")
          : t("settings.glance.style.mixed");
  const usage = usagePercent(data.used, data.limit);
  const level = usageLevel(data.used, data.limit);
  return [
    {
      key: "ai",
      target: "settings-ai",
      icon: "shield-check-mark",
      label: t("settings.ai.heading"),
      short: t("settings.glance.short.ai"),
      state: data.consent ? { label: t("common.state.allowed"), icon: "check-circle", tone: "success" } : { label: t("settings.ai.notAllowed"), icon: "minus-circle", tone: "warning" },
      line: data.consent && data.consentAt ? t("settings.ai.since", { date: i18n.date(data.consentAt, "long") }) : t("settings.glance.ai.missing"),
    },
    {
      key: "changes",
      target: "settings-changes",
      icon: "automation",
      label: t("settings.changes.heading"),
      short: t("settings.glance.short.changes"),
      state: changes.badge,
      line: changes.line,
    },
    {
      key: "publish",
      target: "settings-publish",
      icon: "send",
      label: t("settings.publish.heading"),
      state: publish === "AUTO_PUBLISH" ? { label: t("settings.publish.state.auto"), icon: "bolt", tone: "warning" } : { label: t("settings.publish.state.review"), icon: "eye-check-mark", tone: "success" },
      line: publishLine,
    },
    {
      key: "style",
      target: "settings-style",
      icon: "chat",
      label: t("settings.style.heading"),
      state: { label: address, icon: "chat", tone: "neutral" },
      line: data.style.storeContext ? t("settings.glance.style.withContext") : t("settings.glance.style.withoutContext"),
    },
    {
      key: "memory",
      target: "settings-memory",
      icon: "database",
      label: t("common.nav.memory"),
      short: t("settings.glance.short.memory"),
      state: data.reuseMachineMemory
        ? { label: t("settings.memory.machine.title"), short: t("settings.glance.memory.machineShort"), icon: "wand", tone: "neutral" }
        : { label: t("settings.memory.approved.title"), icon: "check-circle", tone: "neutral" },
      line: data.reuseMachineMemory ? t("settings.glance.memory.machine") : t("settings.glance.memory.approved"),
    },
    {
      key: "usage",
      href: "/app/plan",
      icon: "gauge",
      label: t("settings.usage.short"),
      figure: {
        value: usage.tiny ? t("settings.usage.tiny") : i18n.percent(usage.percent),
        percent: usage.percent,
        tone: level === "exhausted" ? "critical" : level === "high" ? "warning" : "success",
        label: t("settings.usage.progress"),
      },
      ...(level === "exhausted"
        ? { state: { label: t("settings.usage.exhausted"), icon: "alert-circle" as const, tone: "critical" as const } }
        : level === "high"
          ? { state: { label: t("settings.usage.high"), icon: "alert-triangle" as const, tone: "warning" as const } }
          : {}),
      line: t("settings.usage.line", { used: i18n.number(data.used), limit: i18n.number(data.limit), date: i18n.dayMonth(data.resetsOn, data.now) }),
    },
  ];
}

// ─── Translating changes ──────────────────────────────────────────────────────

/** Why it is paused, in a few words ("Daily limit reached"). */
function pauseShort(i18n: I18n, reason: string): string {
  return i18n.t(`settings.changes.pause.${PAUSE_SHORT[reason] ?? "PROVIDER"}` as "settings.changes.pause.PROVIDER");
}

/** The card's state: its badge and the reason line the glance tile shows too. */
function changesView(data: Data, i18n: I18n): { mode: ReturnType<typeof changesMode>; basic: BasicState; smart: SmartState; badge: SettingState; line: string } {
  const { t } = i18n;
  const smartConfig = data.smart?.config ?? null;
  const mode = changesMode({ basicEnabled: data.auto.enabled, smartEnabled: Boolean(smartConfig?.enabled) });
  const active = data.auto.locales.filter((l) => data.auto.allowedLocales.includes(l));
  const basic = basicState({
    enabled: data.auto.enabled,
    planIncludes: data.auto.planIncludes,
    available: data.auto.available,
    consent: data.consent,
    paused: Boolean(data.auto.paused),
    activeLanguages: active.length,
  });
  const smart = data.smart ? smartState({ status: data.smart.status, entitled: data.smart.entitled }) : "off";
  if (mode === "smart" && data.smart) {
    const status = data.smart.status;
    const line =
      smart === "plan"
        ? t("settings.changes.line.notInPlan")
        : smart === "on" && smartConfig
          ? scheduleSummary(i18n, smartConfig)
          : status.state === "paused"
            ? status.reason === "MANUAL"
              ? t("settings.changes.line.pausedByYou")
              : status.until
                ? t("settings.changes.line.pausedUntil", { time: i18n.dateTimeIn(status.until, data.smart.zone), reason: pauseShort(i18n, status.reason) })
                : pauseShort(i18n, status.reason)
            : status.state === "waiting"
              ? t(`settings.changes.waiting.${status.reason}` as "settings.changes.waiting.CONSENT")
              : t("settings.changes.line.manual");
    return { mode, basic, smart, badge: smartBadge(i18n, smart), line };
  }
  if (mode === "basic") {
    const names = data.style.languages.filter((l) => active.includes(l.locale)).map((l) => i18n.language(l.locale, l.name));
    const line =
      basic === "plan"
        ? t("settings.changes.line.notInPlan")
        : basic === "unavailable"
          ? t("settings.changes.line.unavailable")
          : basic === "consent"
            ? t("settings.changes.waiting.CONSENT")
            : basic === "paused" && data.auto.paused
              ? t("settings.changes.line.pausedUntil", { time: i18n.dateTime(data.auto.paused.until), reason: pauseShort(i18n, data.auto.paused.reason) })
              : basic === "noLanguage"
                ? t("settings.changes.waiting.NO_LANGUAGE")
                : t("settings.changes.line.basic", { languages: languageList(i18n, names, 2) });
    return { mode, basic, smart, badge: basicBadge(i18n, basic), line };
  }
  return { mode, basic, smart, badge: { label: t("common.state.off"), icon: "minus-circle", tone: "neutral" }, line: t("settings.changes.line.manual") };
}

function ChangesCard({
  data,
  i18n,
  autoFetcher,
  smartFetcher,
  consentFetcher,
}: {
  data: Data;
  i18n: I18n;
  autoFetcher: ReturnType<typeof useFetcher<typeof action>>;
  smartFetcher: ReturnType<typeof useFetcher<SmartResult>>;
  consentFetcher: ReturnType<typeof useFetcher<typeof action>>;
}) {
  const { t } = i18n;
  const view = changesView(data, i18n);
  const { mode, basic, smart } = view;
  const smartConfig = data.smart?.config ?? null;
  const entitled = Boolean(data.smart?.entitled);
  const [choosingBasic, setChoosingBasic] = useState(false);
  const busy = autoFetcher.state !== "idle" || smartFetcher.state !== "idle";
  // A switch that went through closes the language choice.
  useFreshResult(autoFetcher, (result) => {
    if (result && "autoEnabled" in result) setChoosingBasic(false);
  });
  const smartAct = (intent: string, extra: Record<string, string> = {}) => smartFetcher.submit({ intent, ...extra }, { method: "post", action: "/app/settings/automatic" });
  const turnOffBasic = () => autoFetcher.submit({ intent: "auto", enabled: "false" }, { method: "post" });
  const autoError = autoFetcher.data && "error" in autoFetcher.data ? autoFetcher.data.error : null;
  const smartError = smartFetcher.data && !smartFetcher.data.ok && smartFetcher.data.error ? smartFetcher.data.error : null;
  const hasLanguages = data.style.languages.length > 0;
  // Several locks on a store without languages repeat no plans link (the page's next step is a language).
  const lockLink = hasLanguages ? { href: "/app/plan", label: t("common.action.seePlans") } : undefined;

  const grantButton = (variant: "secondary" | "primary" = "secondary") => (
    <consentFetcher.Form method="post">
      <input type="hidden" name="intent" value="grant-consent" />
      <s-button type="submit" variant={variant} {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
        {t("settings.ai.allow")}
      </s-button>
    </consentFetcher.Form>
  );
  const needsConsent = (
    <s-stack direction="block" gap="small-200">
      <StateLine icon="lock">{t("settings.changes.needsConsent")}</StateLine>
      <s-stack direction="inline">{grantButton()}</s-stack>
    </s-stack>
  );

  // The language choice of "shortly after saving": its saved languages, or every language of the plan the first time.
  const allowed = data.style.languages.filter((l) => data.auto.allowedLocales.includes(l.locale));
  const saved = data.auto.locales.length ? data.auto.locales : allowed.map((l) => l.locale);
  const chosenOutside = data.style.languages.filter((l) => data.auto.locales.includes(l.locale) && !data.auto.allowedLocales.includes(l.locale)).map((l) => i18n.language(l.locale, l.name));
  const basicForm = (
    <autoFetcher.Form method="post">
      <input type="hidden" name="intent" value="auto" />
      <input type="hidden" name="enabled" value="true" />
      {mode === "smart" ? <input type="hidden" name="replaceSmart" value="true" /> : null}
      <s-stack direction="block" gap="small-200">
        <s-choice-list name="locale" label={t("settings.auto.languages")} multiple>
          {allowed.map((l) => (
            <s-choice key={l.locale} value={l.locale} defaultSelected={saved.includes(l.locale)}>
              {i18n.language(l.locale, l.name)}
            </s-choice>
          ))}
        </s-choice-list>
        {chosenOutside.length ? (
          <StateLine icon="lock">{t("settings.auto.chosenOutside", { languages: languageList(i18n, chosenOutside, Infinity), count: chosenOutside.length })}</StateLine>
        ) : null}
        {mode === "smart" ? <StateLine icon="info">{t("settings.changes.replacesSmart")}</StateLine> : null}
        <Actions wide={280}>
          <s-button type="submit" {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
            {mode === "basic" ? t("settings.auto.saveLanguages") : t("settings.auto.turnOn")}
          </s-button>
          {mode === "basic" ? null : (
            <s-button type="button" variant="tertiary" onClick={() => setChoosingBasic(false)}>
              {t("common.action.cancel")}
            </s-button>
          )}
        </Actions>
      </s-stack>
    </autoFetcher.Form>
  );

  // The state with its reason and time, under the heading.
  let state: ReactNode;
  if (mode === "basic") {
    if (basic === "plan") {
      state = (
        <InlineNotice
          icon="lock"
          heading={t("settings.changes.line.notInPlan")}
          actionsWide={300}
          actions={
            <>
              <s-button href="/app/plan">
                {t("common.action.seePlans")}
              </s-button>
              <s-button onClick={turnOffBasic} {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                {t("settings.auto.turnOff")}
              </s-button>
            </>
          }
        >
          {t("settings.changes.stoppedByPlan")}
        </InlineNotice>
      );
    } else if (basic === "unavailable") {
      state = (
        <InlineNotice icon="disabled" heading={t("settings.auto.unavailable.heading")}>
          {t("settings.auto.unavailable.body")}
        </InlineNotice>
      );
    } else if (basic === "consent") {
      state = (
        <s-banner tone="warning" heading={t("settings.auto.waitingConsent.heading")}>
          <s-paragraph>{t("settings.auto.waitingConsent.body")}</s-paragraph>
          <s-stack direction="inline">{grantButton()}</s-stack>
        </s-banner>
      );
    } else if (basic === "paused" && data.auto.paused) {
      const key = AUTO_PAUSE_REASONS.includes(data.auto.paused.reason) ? data.auto.paused.reason : "PROVIDER";
      state = (
        <s-banner tone="warning" heading={t("settings.auto.paused.heading")}>
          <s-paragraph>{t(`settings.auto.paused.${key}` as "settings.auto.paused.PROVIDER", { date: i18n.dateTime(data.auto.paused.until) })}</s-paragraph>
        </s-banner>
      );
    } else {
      state = <StateLine icon={basic === "noLanguage" ? "alert-triangle" : "check-circle"}>{basic === "noLanguage" ? t("settings.auto.noActiveLanguages") : view.line}</StateLine>;
    }
  } else if (mode === "smart" && data.smart) {
    if (smart === "plan") {
      // Business left: the settings are kept; the same languages can be translated shortly after saving instead.
      const languages = (smartConfig?.locales ?? []).filter((l) => data.auto.allowedLocales.includes(l));
      const instead = data.auto.planIncludes && data.auto.available && languages.length > 0;
      state = (
        <InlineNotice
          icon="pause-circle"
          heading={t("settings.changes.line.notInPlan")}
          actionsWide={560}
          actions={
            <>
              {instead ? (
                <autoFetcher.Form method="post">
                  <input type="hidden" name="intent" value="auto" />
                  <input type="hidden" name="enabled" value="true" />
                  <input type="hidden" name="replaceSmart" value="true" />
                  {languages.map((l) => (
                    <input key={l} type="hidden" name="locale" value={l} />
                  ))}
                  <s-button type="submit" variant={data.consent ? "primary" : "secondary"} {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("settings.changes.instead")}
                  </s-button>
                </autoFetcher.Form>
              ) : null}
              <s-button href="/app/plan">
                {t("common.action.seePlans")}
              </s-button>
              <s-link href="/app/settings/automatic">{t("settings.changes.viewSchedule")}</s-link>
            </>
          }
        >
          {t("settings.changes.smartStoppedByPlan")}
        </InlineNotice>
      );
    } else if (data.smart.status.state === "on") {
      // On: when it checks next (its schedule and languages are in the option).
      const next = data.smart.nextChecks[0];
      state = (
        <StateLine icon="clock">
          {next !== undefined
            ? t("settings.changes.nextCheck", { time: t("automatic.schedule.zone", { time: i18n.dateTimeIn(next, data.smart.zone), zone: data.smart.zone }) })
            : t("automatic.schedule.manual")}
        </StateLine>
      );
    } else {
      state = <SmartStateBanner status={data.smart.status} zone={data.smart.zone} consentAction={<s-stack direction="inline">{grantButton()}</s-stack>} />;
    }
  } else {
    state = <StateLine icon="play-circle">{t("settings.auto.offBody")}</StateLine>;
  }

  const smartSummary =
    smartConfig && data.smart
      ? [scheduleSummary(i18n, smartConfig), languageList(i18n, smartConfig.locales.map((l) => i18n.language(l, data.style.languages.find((x) => x.locale === l)?.name ?? l)), 3)].join(" · ")
      : null;
  const locked = !data.auto.planIncludes && !entitled && !smartConfig;
  // A refused language choice is shown where it was made.
  const errorInBasic = mode === "basic" || choosingBasic;
  // Business with a lock: the plan doesn't include the schedule (kept, and stopped, after a move to another plan).
  const lockedBusiness = <s-badge icon="lock">{t("automatic.business")}</s-badge>;

  return (
    <SettingCard
      id="settings-changes"
      icon="automation"
      heading={t("settings.changes.heading")}
      state={view.badge}
      extra={mode === "smart" && smart === "plan" ? lockedBusiness : null}
      lead={t("settings.changes.lead")}
    >
      {state}
      <OptionGrid label={t("settings.changes.heading")} min={240}>
        <OptionCard
          id="settings-changes-manual"
          title={t("settings.changes.manual.title")}
          body={t("settings.changes.manual.body")}
          current={mode === "manual"}
          currentLabel={t("settings.option.current")}
          select={{ onClick: () => (mode === "basic" ? turnOffBasic() : smartAct("turn-off")), disabled: busy }}
        />
        <OptionCard
          id="settings-changes-basic"
          title={t("settings.changes.basic.title")}
          body={t("settings.changes.basic.body")}
          current={mode === "basic"}
          currentLabel={t("settings.option.current")}
          select={
            data.auto.planIncludes && data.auto.available && data.consent && hasLanguages && !choosingBasic
              ? { onClick: () => setChoosingBasic(true), disabled: busy }
              : undefined
          }
        >
          {!data.auto.planIncludes ? (
            mode === "basic" ? null : (
              <LockLine plan="Starter" text={t("settings.changes.basic.plan")} {...(lockLink ? { link: lockLink } : {})} />
            )
          ) : !data.auto.available ? (
            mode === "basic" ? null : <StateLine icon="disabled">{t("settings.changes.line.unavailable")}</StateLine>
          ) : !data.consent && mode !== "basic" ? (
            needsConsent
          ) : (mode === "basic" && basic !== "plan") || choosingBasic ? (
            basicForm
          ) : null}
          {errorInBasic && autoError ? <AutoError i18n={i18n} error={autoError} /> : null}
        </OptionCard>
        <OptionCard
          id="settings-changes-smart"
          title={t("settings.changes.smart.title")}
          body={t("settings.changes.smart.body")}
          current={mode === "smart"}
          currentLabel={t("settings.option.current")}
          // Locked and not current: the lock line carries the plan's badge.
          badges={entitled ? <s-badge>{t("automatic.business")}</s-badge> : mode === "smart" ? lockedBusiness : null}
          select={
            !entitled
              ? undefined
              : !smartConfig
                ? { href: "/app/settings/automatic" }
                : data.consent && data.auto.available
                  ? { onClick: () => smartAct("turn-on", mode === "basic" ? { replaceBasic: "true" } : {}), disabled: busy }
                  : undefined
          }
        >
          {mode === "smart" && smartSummary ? (
            <s-stack direction="block" gap="small-200">
              <StateLine icon="calendar-time">{smartSummary}</StateLine>
              {/* Stopped by the plan: the notice above has the way on. */}
              {smart === "plan" ? null : (
                <Actions wide={300}>
                  {data.smart?.status.state === "on" ? (
                    <s-button onClick={() => smartAct("check-now", { key: data.smartCheckKey })} {...(smartFetcher.state !== "idle" ? { loading: true } : {})}>
                      {t("automatic.action.checkNow")}
                    </s-button>
                  ) : null}
                  <s-button href="/app/settings/automatic">
                    {t("automatic.action.options")}
                  </s-button>
                </Actions>
              )}
            </s-stack>
          ) : !entitled ? (
            <LockLine plan="Business" text={t("settings.changes.smart.plan")} {...(lockLink ? { link: lockLink } : {})} />
          ) : !smartConfig ? (
            <StateLine icon="info">{t("settings.changes.smart.setUp")}</StateLine>
          ) : !data.consent ? (
            needsConsent
          ) : !data.auto.available ? (
            <StateLine icon="disabled">{t("settings.changes.line.unavailable")}</StateLine>
          ) : mode === "basic" ? (
            <StateLine icon="info">{t("settings.changes.replacesBasic")}</StateLine>
          ) : null}
        </OptionCard>
      </OptionGrid>
      {!errorInBasic && autoError ? <AutoError i18n={i18n} error={autoError} /> : null}
      {smartError ? (
        <s-banner tone="critical" heading={t("automatic.error.actionHeading")}>
          <s-paragraph>{smartErrorText(i18n, smartError)}</s-paragraph>
        </s-banner>
      ) : null}
      {locked ? null : (
        <More summary={t("settings.changes.how")}>
          <FactList
            label={t("settings.changes.how")}
            facts={[
              { icon: "check", text: t("settings.auto.how.missing") },
              { icon: "eye-check-mark", text: t("settings.auto.how.publishing") },
              { icon: "clock", text: t("settings.auto.how.later") },
              { icon: "gauge", text: t("settings.auto.how.allowance") },
            ]}
          />
        </More>
      )}
    </SettingCard>
  );
}

function AutoError({ i18n, error }: { i18n: I18n; error: string }) {
  const { t } = i18n;
  if (error === "SMART_ON")
    return (
      <s-banner tone="critical" heading={t("settings.auto.smartOn.heading")}>
        <s-paragraph>{t("settings.auto.smartOn.body")}</s-paragraph>
      </s-banner>
    );
  if (error === "CONSENT_REQUIRED")
    return (
      <s-banner tone="critical" heading={t("settings.auto.consent.heading")}>
        <s-paragraph>{t("settings.auto.consent.body")}</s-paragraph>
      </s-banner>
    );
  if (error === "NO_LANGUAGE")
    return (
      <s-banner tone="critical" heading={t("settings.auto.noLanguage.heading")}>
        <s-paragraph>{t("settings.auto.noLanguage.body")}</s-paragraph>
      </s-banner>
    );
  if (error === "PLAN_LANGUAGE")
    return (
      <s-banner tone="info" heading={t("settings.auto.planLanguage.heading")}>
        <s-paragraph>
          {t("settings.auto.planLanguage.body")} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
        </s-paragraph>
      </s-banner>
    );
  return (
    <s-banner tone="info" heading={t("settings.changes.basic.plan")}>
      <s-paragraph>
        <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
      </s-paragraph>
    </s-banner>
  );
}

// ─── Publishing ───────────────────────────────────────────────────────────────

function PublishingCard({ data, i18n, fetcher }: { data: Data; i18n: I18n; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const { t } = i18n;
  const mode = effectivePublishMode({ mode: data.publishMode, inPlan: data.autoPublishInPlan });
  const downgraded = data.publishMode === "AUTO_PUBLISH" && !data.autoPublishInPlan;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const choose = (next: PublishMode, confirmed: boolean) =>
    fetcher.submit({ intent: "publish-mode", mode: next, ...(confirmed ? { confirm: "on" } : {}) }, { method: "post" });
  return (
    <SettingCard
      id="settings-publish"
      icon="send"
      heading={t("settings.publish.heading")}
      state={mode === "AUTO_PUBLISH" ? { label: t("settings.publish.state.auto"), icon: "bolt", tone: "warning" } : { label: t("settings.publish.state.review"), icon: "eye-check-mark", tone: "success" }}
      lead={t("settings.publish.scope")}
    >
      {downgraded ? <StateLine icon="lock">{t("settings.publish.notInPlan")}</StateLine> : null}
      <PublishingChoice id="settings-publish" mode={mode} inPlan={data.autoPublishInPlan} onChoose={choose} busy={fetcher.state !== "idle"} lockLink={data.style.languages.length > 0} />
      {error === "PLAN_AUTO_PUBLISH" ? (
        <s-banner tone="info" heading={t("settings.publish.auto.plan")}>
          <s-paragraph>
            <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : error === "CONFIRMATION_REQUIRED" ? (
        <s-banner tone="critical" heading={t("settings.publish.confirmHeading")}>
          <s-paragraph>{t("settings.publish.confirmBody")}</s-paragraph>
        </s-banner>
      ) : null}
      <s-stack direction="inline">
        <s-link href="/app/review">{t("settings.publish.toReview")}</s-link>
      </s-stack>
    </SettingCard>
  );
}

// ─── Form of address ──────────────────────────────────────────────────────────

function StyleCard({ data, i18n, fetcher }: { data: Data; i18n: I18n; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const { t } = i18n;
  const [formKey, setFormKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Unsaved changes are never lost silently: the admin's save bar holds them.
  useSaveBar(STYLE_SAVE_BAR, dirty);
  useFreshResult(fetcher, (result) => {
    if (result && "saved" in result && result.saved === "style") setDirty(false);
  });
  const discard = () => {
    setFormKey((k) => k + 1);
    setDirty(false);
  };
  const optionLabel = (locale: string, kind: "formal" | "informal") => {
    const pronouns = formalityPronouns(locale);
    if (!pronouns) return kind === "formal" ? t("settings.style.formal") : t("settings.style.informal");
    return kind === "formal" ? t("settings.style.formalWith", { pronoun: pronouns.formal }) : t("settings.style.informalWith", { pronoun: pronouns.informal });
  };
  return (
    <SettingCard id="settings-style" icon="chat" heading={t("settings.style.heading")} lead={t("settings.style.lead")}>
      <ui-save-bar id={STYLE_SAVE_BAR}>
        <button variant="primary" onClick={() => formRef.current?.requestSubmit()} {...(fetcher.state !== "idle" ? { loading: "" } : {})}>
          {t("automatic.action.save")}
        </button>
        <button onClick={discard}>{t("automatic.action.discard")}</button>
      </ui-save-bar>
      <fetcher.Form key={formKey} ref={formRef} method="post" onChange={() => setDirty(true)} onInput={() => setDirty(true)}>
        <input type="hidden" name="intent" value="style" />
        <s-stack direction="block" gap="base">
          {data.style.languages.length ? (
            <ul aria-label={t("settings.style.address")} style={PLAIN_LIST}>
              {data.style.languages.map((l, index) => {
                const name = i18n.language(l.locale, l.name);
                return (
                  <li key={l.locale}>
                    {index > 0 ? <s-divider /> : null}
                    <s-box paddingBlock="small-300">
                      {/* The name keeps the room it needs; the choice is narrower on a phone. */}
                      <s-grid gridTemplateColumns="@container (inline-size > 520px) 1fr 220px, 1fr 170px" gap="base" alignItems="center">
                        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                          <Flag country={localeCountry(l.locale)} fallback={l.locale} size={20} />
                          <span aria-hidden="true" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                            {name}
                          </span>
                        </s-grid>
                        {supportsFormality(l.locale) ? (
                          <s-select name={`formality:${l.locale}`} label={name} labelAccessibilityVisibility="exclusive" value={l.formality}>
                            <s-option value="default">{t("settings.style.deeplDecides")}</s-option>
                            <s-option value="more">{optionLabel(l.locale, "formal")}</s-option>
                            <s-option value="less">{optionLabel(l.locale, "informal")}</s-option>
                          </s-select>
                        ) : (
                          <>
                            {/* DeepL has no choice for this language: what is stored stays as it is. */}
                            <input type="hidden" name={`formality:${l.locale}`} value={l.formality} />
                            <s-text color="subdued">
                              <s-text accessibilityVisibility="exclusive">{`${name}: `}</s-text>
                              {t("settings.style.noChoice")}
                            </s-text>
                          </>
                        )}
                      </s-grid>
                    </s-box>
                  </li>
                );
              })}
            </ul>
          ) : (
            <StateLine icon="language">{t("settings.style.noLanguages")}</StateLine>
          )}
          <s-text-area
            name="storeContext"
            label={t("settings.style.storeContext.label")}
            placeholder={t("settings.style.storeContext.placeholder")}
            details={t("settings.style.storeContext.details")}
            value={data.style.storeContext}
            maxLength={data.style.maxContext}
            rows={2}
          />
          <StateLine icon="book-open">
            {t("settings.style.glossary", { count: data.glossaryTerms })} <s-link href="/app/glossary">{t("settings.style.glossaryLink")}</s-link>
          </StateLine>
        </s-stack>
      </fetcher.Form>
    </SettingCard>
  );
}

// ─── Translation memory ───────────────────────────────────────────────────────

function MemoryCard({ data, i18n, fetcher }: { data: Data; i18n: I18n; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const { t } = i18n;
  const busy = fetcher.state !== "idle";
  const choose = (enabled: boolean) => fetcher.submit({ intent: "reuse-memory", enabled: String(enabled) }, { method: "post" });
  return (
    <SettingCard
      id="settings-memory"
      icon="database"
      heading={t("common.nav.memory")}
      state={data.reuseMachineMemory ? { label: t("settings.memory.machine.title"), icon: "wand", tone: "neutral" } : { label: t("settings.memory.approved.title"), icon: "check-circle", tone: "neutral" }}
      lead={t("settings.memory.lead")}
    >
      <OptionGrid label={t("common.nav.memory")}>
        <OptionCard
          id="settings-memory-approved"
          title={t("settings.memory.approved.title")}
          body={t("settings.memory.approved.details")}
          current={!data.reuseMachineMemory}
          currentLabel={t("settings.option.current")}
          select={{ onClick: () => choose(false), disabled: busy }}
        />
        <OptionCard
          id="settings-memory-machine"
          title={t("settings.memory.machine.title")}
          body={t("settings.memory.machine.details")}
          current={data.reuseMachineMemory}
          currentLabel={t("settings.option.current")}
          select={{ onClick: () => choose(true), disabled: busy }}
        />
      </OptionGrid>
      <s-stack direction="inline">
        <s-link href="/app/memory">{t("settings.memory.open")}</s-link>
      </s-stack>
    </SettingCard>
  );
}

// ─── AI permission ────────────────────────────────────────────────────────────

function PermissionCard({ data, i18n, fetcher, primary }: { data: Data; i18n: I18n; fetcher: ReturnType<typeof useFetcher<typeof action>>; primary: boolean }) {
  const { t } = i18n;
  const busy = fetcher.state !== "idle";
  const revoke = () => fetcher.submit({ intent: "revoke-consent" }, { method: "post" });
  return (
    <SettingCard
      id="settings-ai"
      icon="shield-check-mark"
      heading={t("settings.ai.heading")}
      state={data.consent ? { label: t("common.state.allowed"), icon: "check-circle", tone: "success" } : { label: t("settings.ai.notAllowed"), icon: "minus-circle", tone: "warning" }}
      lead={t("settings.ai.lead")}
    >
      <More summary={t("settings.ai.detailsSummary")}>
        <s-paragraph>{t("settings.ai.personal")}</s-paragraph>
        <s-paragraph>{t("settings.ai.details")}</s-paragraph>
      </More>
      <s-stack direction="inline">
        {data.consent ? (
          <s-button commandFor={REVOKE_MODAL} command="--show" {...(busy ? { loading: true } : {})}>
            {t("settings.ai.withdraw")}
          </s-button>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="grant-consent" />
            <s-button type="submit" variant={primary ? "primary" : "secondary"} {...(busy ? { loading: true } : {})}>
              {t("settings.ai.allow")}
            </s-button>
          </fetcher.Form>
        )}
      </s-stack>
      {!data.aiAvailable ? (
        <s-banner tone="warning" heading={t("settings.ai.notConfigured.heading")}>
          <s-paragraph>{t("settings.ai.notConfigured.body")}</s-paragraph>
        </s-banner>
      ) : null}
      <s-modal id={REVOKE_MODAL} heading={t("settings.ai.revoke.heading")} accessibilityLabel={t("settings.ai.revoke.heading")}>
        <s-paragraph>{t("settings.ai.revoke.body")}</s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" commandFor={REVOKE_MODAL} command="--hide" onClick={revoke}>
          {t("settings.ai.withdraw")}
        </s-button>
        <s-button slot="secondary-actions" commandFor={REVOKE_MODAL} command="--hide">
          {t("common.action.cancel")}
        </s-button>
      </s-modal>
    </SettingCard>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
