/**
 * Settings: what Linguva may do and how it translates, in sections shown one
 * at a time (`?section=<key>`). Under the heading the status row: all set
 * up, or the one thing that needs the merchant (a language, a key, the AI
 * permission, translating changes paused or waiting) with its fix. On a
 * wide container a nav card lists the sections beside the chosen one (none
 * chosen: the first that needs the merchant, else "Translating changes");
 * on a phone the sections are a list of rows, and a chosen one shows alone
 * under a back row. The sections: how changes are translated (nothing,
 * shortly after saving, on a schedule), publishing, how AI writes,
 * translation memory; then (Own key plan, or saved keys) the merchant's
 * keys right before the AI permission, the plan with this month's AI
 * characters, and the tools. Every state says what really happens: "On"
 * only when the work runs (plan, installation, permission, pause, languages).
 *
 * Every section stays mounted (only the chosen one is shown), so a choice
 * being made or unsaved text survives a switch, and switching never loads
 * the page's data again. A job stopped for the permission or a key links
 * here with `?job=<id>`; once its cause is fixed, the section leads back.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { aiLimitsFor, shopBilling } from "../.server/billing/billing";
import { checkEngineKey, ownKeysView, removeEngineKey, saveEngineKey, type EngineKeyErrorCode } from "../.server/credentials/service";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { countTerms } from "../.server/glossary/glossary";
import { backToJob } from "../.server/jobs/back-to-job";
import { getConfig } from "../.server/lib/config";
import { prisma } from "../.server/lib/db";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { openShopTranslation, shopTranslationFacts } from "../.server/providers/shop-translation";
import { appVersion } from "../.server/lib/app-version";
import { formalityEngines } from "../.server/providers/language-support";
import { getQueues } from "../.server/queue/client";
import {
  AI_STORE_CONTEXT_MAX,
  autoPauseApplies,
  ConfirmationRequiredError,
  formalityFor,
  getShopSettings,
  hasCurrentAiConsent,
  missingConsent,
  setAiConsent,
  setAutoTranslate,
  setBulkPublishMode,
  setReuseMachineMemory,
  setTranslationStyle,
  textConsentTokens,
} from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { getSmartConfig, setSmartEnabled } from "../.server/smart/config";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { settleAfterConsent } from "../.server/smart/runs";
import { getMonthlyUsage, nextPeriodStart, periodKey } from "../.server/usage/usage-ledger";
import { useResultToast, useSaveBar } from "../components/app-bridge";
import { BackToJob } from "../components/jobs/BackToJob";
import { KEYS_CARD, keysState, ownKeyCostNote, OwnKeysCard, type KeyFetcher } from "../components/OwnKeysCard";
import { Flag } from "../components/Flag";
import { Segmented } from "../components/Segmented";
import { AppVersionLine } from "../components/AppVersion";
import { BIG_HEADING, Breadcrumbs } from "../components/LanguageLayout";
import { STAT, SUB_HEADING } from "../components/plan/styles";
import { ProgressBar } from "../components/ProgressBar";
import { PublishingChoice, type PublishMode } from "../components/PublishingChoice";
import { NARROW_ONLY, SectionList, SectionNav, StatusRow, WIDE_ONLY, type SectionEntry, type StatusView } from "../components/SettingsNav";
import {
  Actions,
  FactList,
  focusById,
  focusSection,
  InlineNotice,
  LinkTiles,
  LockLine,
  More,
  OptionCard,
  OptionGrid,
  SETTING_NAME,
  SettingSection,
  StateBadge,
  StateLine,
  useFreshResult,
  type SettingState,
} from "../components/SettingsParts";
import { scheduleSummary, smartErrorText, SmartStateBanner, smartToast } from "../components/SmartAutoCard";
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import { jobErrorMessage } from "../i18n/labels";
import { useI18n } from "../i18n/react";
import { basicState, changesMode, effectivePublishMode, smartState, type BasicState, type SmartState } from "../lib/automation-state";
import { consentLead, enginesText, isDeepLOnly, orderTexts, processorsText } from "../lib/engine-texts";
import { ENGINE_NAMES, engineOfToken, isEngineId, type ConsentToken, type EngineId } from "../lib/engines";
import { localeCountry } from "../lib/flags";
import { formalityPronouns, supportsFormality } from "../lib/formality";
import type { IconName } from "../lib/icons";
import { jobName } from "../lib/job-view";
import { languageList, upperFirst } from "../lib/name-lists";
import { isOwnKeyCode, usableOwnKey } from "../lib/own-keys";
import { entitlementsFor, TRIAL_AI_CHARS } from "../lib/plans";
import { planName, usagePercent } from "../lib/plan-view";
import { usageLevel } from "../lib/usage";
import { Button } from "../components/Button";

/** The sections in the nav's order: how Linguva translates, then what it may use (keys right before the permission). */
const SECTION_KEYS = ["changes", "publish", "style", "memory", "keys", "ai", "plan", "tools"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
/** The nav's first group; a divider, then the rest. */
const FIRST_GROUP: readonly SectionKey[] = ["changes", "publish", "style", "memory"];
const isSectionKey = (value: string | null | undefined): value is SectionKey => (SECTION_KEYS as readonly string[]).includes(value ?? "");
/** A section's element id ("settings-keys" is the keys card's KEYS_CARD). */
const sectionId = (key: SectionKey) => `settings-${key}`;
const sectionHref = (key: SectionKey) => `/app/settings?section=${key}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
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
  // Which translation services the texts name: what a current consent covers, else every one in use
  // (DeepL only: today's texts). With several engines, the engine that serves each language first
  // (only among those the texts name), for the form of address.
  // Own key plan: the tokens of the shop's usable keys, under the own-key notice (no decryption here).
  const facts = await shopTranslationFacts(shop.id, billing);
  const configured = facts.configured;
  const consented = hasCurrentAiConsent(settings, configured, facts.payer);
  const text = textConsentTokens(settings, configured, facts.payer);
  // Azure or Google alone serve every language without a form of address, too. The provider is
  // opened only for the engines' language lists and dropped right after (never in the page's data).
  const { servedBy, noFormality } = await formalityEngines((await openShopTranslation(shop.id, billing, { settings })).provider, targets, text.map(engineOfToken));
  // The Own key plan's keys (summaries: never a key, hints of four characters): on the plan, with a
  // pending change to it, or saved under another plan (to remove them). Null for every other shop.
  const ownKeys = await ownKeysView(shop.id, billing);
  // From a job stopped for the permission or a key (`?section=ai|keys&job=<id>`): the way back, once its
  // cause is fixed. Only a FAILED job of this shop whose cause this section fixes; never breaks the page.
  const section = url.searchParams.get("section");
  const fixSection = section === "ai" || (section === "keys" && ownKeys) ? section : null;
  const back = fixSection ? await backToJob({ shopId: shop.id, billing, jobId: url.searchParams.get("job"), target: `/app/settings?section=${fixSection}`, now }) : null;
  return {
    engines: {
      configured,
      text,
      missing: consented ? missingConsent(settings, configured, facts.payer) : ([] as ConsentToken[]),
      servedBy,
      noFormality,
    },
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
    consent: consented,
    consentAt: settings.aiDataProcessingConsentAt?.toISOString() ?? null,
    publishMode: settings.bulkPublishMode,
    // Shown before a click; the action checks the plan again, and jobs publish automatically only while it is included.
    autoPublishInPlan: billing.entitlements.autoPublish,
    reuseMachineMemory: settings.reuseMachineMemory,
    auto: {
      enabled: settings.autoTranslateNew,
      locales: settings.autoTranslateLocales,
      // Needs AI, background jobs and a plan that includes translating whole areas.
      available: facts.available && getQueues() !== null,
      planIncludes: billing.entitlements.bulk,
      // The plan's languages: the first ones in the order listed here, as for bulk jobs and the editor.
      allowedLocales: allowedTargetLocales(billing.entitlements, targets),
      // Only a pause about this plan's payer: a pause for Linguva's limits doesn't hold an own-key shop, nor the other way round.
      paused: autoPauseApplies(settings, facts.payer === "merchant") ? { until: settings.autoPausedUntil!.toISOString(), reason: settings.autoPauseReason ?? "PROVIDER" } : null,
    },
    aiAvailable: facts.available,
    now: now.toISOString(),
    // The running version: when it went live and its commit (the page's last line).
    version: appVersion(),
    resetsOn: (trialRise ?? nextMonth).toISOString(),
    used: await getMonthlyUsage(shop.id, period),
    limit: limits.limit,
    // The plan section's name (as the Plan page's hero names it).
    plan: { state: billing.state, configured: billing.configured, handle: billing.subscription?.planHandle ?? null },
    ownKeys,
    backToJob: back && fixSection ? { ...back, section: fixSection } : null,
  };
};

/**
 * Choosing another section changes only `?section`: every section is already on the page, so the
 * data isn't loaded again. Anything else (an action, another `job`, a reload) loads as usual.
 */
export const shouldRevalidate = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) => {
  if (formMethod || currentUrl.pathname !== nextUrl.pathname || currentUrl.search === nextUrl.search) return defaultShouldRevalidate;
  // The section, and what Shopify adds to the first address (the admin's launch: shop, host, token,
  // interface language), change nothing the loader reads.
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    for (const name of ["section", "embedded", "shop", "host", "id_token", "hmac", "session", "timestamp", "locale"]) params.delete(name);
    params.sort();
    return params.toString();
  };
  return rest(currentUrl) === rest(nextUrl) ? false : defaultShouldRevalidate;
};

/** A key form's failure: its code, the engine only when it was a valid id, and the wait (never the key). */
function keyFailure(result: { error: EngineKeyErrorCode; retryAfterMs?: number }, engine: EngineId | undefined) {
  return {
    ok: false as const,
    error: result.error,
    ...(engine ? { engine } : {}),
    ...(result.retryAfterMs !== undefined ? { retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)) } : {}),
  };
}

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
      const facts = await shopTranslationFacts(shop.id, billing);
      if (!hasCurrentAiConsent(await getShopSettings(shop.id), facts.configured, facts.payer)) return { ok: false, error: "CONSENT_REQUIRED" };
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
  // The Own key plan's keys. The key is read once, passed on, and never returned, logged or put into
  // an error; replies carry codes and the key's state only. The plan is checked again on the server.
  if (intent === "save-key" || intent === "check-key" || intent === "remove-key") {
    const posted = form.get("engine");
    const engine = typeof posted === "string" && isEngineId(posted) ? posted : undefined;
    if (intent === "remove-key") {
      const removed = await removeEngineKey({ shopId: shop.id, actorId, engine: posted });
      return removed.ok ? { ok: true as const, saved: "key-removed" as const, engine: engine! } : keyFailure(removed, engine);
    }
    const billing = await shopBilling(admin, shop);
    if (intent === "save-key") {
      const saved = await saveEngineKey({
        shopId: shop.id,
        actorId,
        billing,
        form: { engine: posted, apiKey: form.get("apiKey"), region: form.get("region"), location: form.get("location") },
      });
      return saved.ok
        ? { ok: true as const, saved: "key" as const, engine: saved.summary.engine, replaced: saved.replaced, status: saved.summary.status }
        : keyFailure(saved, engine);
    }
    const checked = await checkEngineKey({ shopId: shop.id, actorId, billing, engine: posted });
    return checked.ok ? { ok: true as const, saved: "key-check" as const, engine: checked.summary.engine, status: checked.summary.status } : keyFailure(checked, engine);
  }
  if (intent !== "grant-consent" && intent !== "revoke-consent") {
    return { ok: false };
  }
  // The services the page showed: a page from before an engine was added stores nothing and shows the new list.
  const shown = form.get("consentTokens");
  // The services in use and who they are used under: the operator's engines, or the shop's own keys.
  const facts = await shopTranslationFacts(shop.id, await shopBilling(admin, shop));
  const saved = await setAiConsent({
    shopId: shop.id,
    granted: intent === "grant-consent",
    actorId,
    shown: typeof shown === "string" ? shown.split(",").filter(Boolean) : null,
    consent: { configured: facts.configured, payer: facts.payer },
  });
  if (saved === "changed") return { ok: false, error: "CONSENT_CHANGED" };
  // The smart schedule waits for consent no longer than needed.
  if (intent === "grant-consent") await settleAfterConsent({ prisma, adminFor: async () => admin, billingFor: async () => shopBilling(admin, shop) }, shop);
  // "extend": more services allowed beside a consent already given (the permission card stays where it is).
  return { ok: true, saved: "consent" as const, granted: intent === "grant-consent", extended: form.get("extend") === "true" };
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

/** The pages beside the settings that aren't in the navigation (the glossary and memory also open from their sections). */
const TOOLS = [
  { href: "/app/glossary", icon: "book-open", label: "common.nav.glossary", detail: "settings.tools.glossary.detail" },
  { href: "/app/languages", icon: "language", label: "common.languages", detail: "settings.tools.languages.detail" },
  { href: "/app/markets", icon: "globe", label: "settings.tools.markets.label", detail: "settings.tools.markets.detail" },
  { href: "/app/memory", icon: "database", label: "common.nav.memory", detail: "settings.tools.memory.detail" },
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
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const consentFetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
  const styleFetcher = useFetcher<typeof action>();
  const autoFetcher = useFetcher<typeof action>();
  // The smart schedule's actions go to its page's action, which checks the plan again.
  const smartFetcher = useFetcher<SmartResult>();
  // One per translation service of the keys card (its add/replace, check and remove forms).
  const deeplKeyFetcher = useFetcher<typeof action>();
  const azureKeyFetcher = useFetcher<typeof action>();
  const googleKeyFetcher = useFetcher<typeof action>();
  const keyFetchers: Record<EngineId, KeyFetcher> = { deepl: deeplKeyFetcher, azure: azureKeyFetcher, google: googleKeyFetcher };

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

  const hasLanguages = data.style.languages.length > 0;
  // The page's one primary button is the next step that is needed: a language, then (Own key plan)
  // a working key, then the permission.
  const noKey = ownKeyMissing(data);
  const consentPrimary = hasLanguages && !noKey && !data.consent;
  const status = pageStatus(data, i18n);

  // The sections this store has (its keys only on the Own key plan or with saved keys), the one the
  // address asks for, and the one shown. Without one asked for, the first that needs the merchant,
  // decided when the address was opened: a key saved or a permission given doesn't move the page.
  const available = SECTION_KEYS.filter((key) => key !== "keys" || data.ownKeys);
  const asked = searchParams.get("section");
  const requested = isSectionKey(asked) && available.includes(asked) ? asked : null;
  const firstNeeded = status.section ?? "changes";
  const [opened, setOpened] = useState({ key: location.key, section: firstNeeded });
  if (opened.key !== location.key) setOpened({ key: location.key, section: firstNeeded });
  const openedSection = opened.key === location.key ? opened.section : firstNeeded;
  const current: SectionKey = requested ?? (available.includes(openedSection) ? openedSection : "changes");
  const jobParam = searchParams.get("job");

  // Another section shown, or a section chosen in the address (on a phone the list opens the one that
  // needs the merchant, which is already the current one): its heading takes focus.
  const shown = useRef({ requested, current });
  useEffect(() => {
    const before = shown.current;
    if (before.requested === requested && before.current === current) return;
    shown.current = { requested, current };
    if (requested || before.current !== current) focusSection(sectionId(current));
  }, [requested, current]);
  // The cards' old addresses (/app/settings#settings-keys) open their section.
  const hasKeys = Boolean(data.ownKeys);
  useEffect(() => {
    const key = /^#settings-([a-z]+)$/.exec(location.hash)?.[1];
    if (!requested && isSectionKey(key) && (key !== "keys" || hasKeys)) navigate(sectionHref(key), { replace: true });
  }, [location.hash, requested, hasKeys, navigate]);

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
  // Permission given: on to the next step, translating changes (from a stopped job: here, where the
  // way back to it now shows). More services allowed, or permission withdrawn: the permission's heading.
  useFreshResult(consentFetcher, (result) => {
    if (!(result && "granted" in result)) return;
    if (!result.granted || result.extended) return focusSection(sectionId("ai"));
    if (jobParam || current === "changes") return focusSection(sectionId(current));
    navigate(sectionHref("changes"));
  });

  // Back to the job that stopped for the permission or a key, once its cause is fixed (the loader's check).
  const back =
    data.backToJob && data.backToJob.id === jobParam ? (
      <BackToJob jobId={data.backToJob.id} name={jobName(i18n, data.backToJob, Object.fromEntries(data.style.languages.map((l) => [l.locale, l.name])))} />
    ) : null;

  // Right before the permission: the permission covers the keys' services.
  const sections: Array<[SectionKey, ReactNode]> = [
    ["changes", <ChangesCard key="changes" data={data} i18n={i18n} autoFetcher={autoFetcher} smartFetcher={smartFetcher} consentFetcher={consentFetcher} />],
    ["publish", <PublishingCard key="publish" data={data} i18n={i18n} fetcher={modeFetcher} />],
    ["style", <StyleCard key="style" data={data} i18n={i18n} fetcher={styleFetcher} />],
    ["memory", <MemoryCard key="memory" data={data} i18n={i18n} fetcher={memoryFetcher} />],
    ...(data.ownKeys
      ? ([
          [
            "keys",
            <OwnKeysCard key={KEYS_CARD} data={data.ownKeys} i18n={i18n} fetchers={keyFetchers} primary={hasLanguages && noKey} top={data.backToJob?.section === "keys" ? back : null} />,
          ],
        ] as Array<[SectionKey, ReactNode]>)
      : []),
    ["ai", <PermissionCard key="ai" data={data} i18n={i18n} fetcher={consentFetcher} primary={consentPrimary} top={data.backToJob?.section === "ai" ? back : null} />],
    ["plan", <PlanCard key="plan" data={data} i18n={i18n} />],
    ["tools", <ToolsCard key="tools" i18n={i18n} />],
  ];

  const texts = sectionTexts(data, i18n);
  const entry = (key: SectionKey): SectionEntry => ({ key, href: sectionHref(key), ...texts[key] });
  const groups = [available.filter((key) => FIRST_GROUP.includes(key)).map(entry), available.filter((key) => !FIRST_GROUP.includes(key)).map(entry)];

  // The status row's fix: the page's primary button where it is the next step. Where its section is
  // shown beside it (a wide page), that section's own button is the way, so only the phone list has it.
  const fix = status.action;
  const fixButton = fix ? (
    <Button variant={back ? "secondary" : "primary"} href={fix.href} {...(fix.external ? { target: "_top" as const } : {})}>
      {fix.label}
    </Button>
  ) : null;
  const statusAction = !fixButton ? null : status.section !== current ? fixButton : requested ? null : <s-box display={NARROW_ONLY}>{fixButton}</s-box>;

  return (
    <s-page heading={t("common.nav.settings")}>
      <s-query-container>
        <s-stack direction="block" gap="base">
          {/* A chosen section on a phone: the way back to the list, then the section alone. */}
          {requested ? (
            <s-box display={NARROW_ONLY}>
              <Breadcrumbs i18n={i18n} trail={[{ href: "/app/settings", label: t("common.nav.settings") }]} current={texts[requested].name} touch />
            </s-box>
          ) : null}
          <s-box display={requested ? WIDE_ONLY : "auto"}>
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="small-500">
                <h1 style={BIG_HEADING}>{t("common.nav.settings")}</h1>
                <s-text color="subdued">{t("settings.subtitle")}</s-text>
              </s-stack>
              <StatusRow id="settings-status" status={status} action={statusAction} />
            </s-stack>
          </s-box>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 260px 1fr, 1fr" gap="base" alignItems="start">
            <s-box display={WIDE_ONLY}>
              <SectionNav label={t("settings.section.nav")} groups={groups} current={current} />
            </s-box>
            {requested ? null : (
              <s-box display={NARROW_ONLY}>
                <SectionList label={t("settings.section.nav")} groups={groups} />
              </s-box>
            )}
            {/* Every section stays on the page; only the chosen one is shown (a phone without one shows the list). */}
            <s-box display={requested ? "auto" : WIDE_ONLY} minInlineSize="0">
              {sections.map(([key, node]) => (
                <div key={key} hidden={key !== current}>
                  {node}
                </div>
              ))}
            </s-box>
          </s-grid>
          {/* When the running version went live: under the sections (on a phone, under the list). */}
          <s-box display={requested ? WIDE_ONLY : "auto"}>
            <AppVersionLine version={data.version} now={data.now} />
          </s-box>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

// ─── Translation services ─────────────────────────────────────────────────────

/** The services the page showed, posted with every "allow": a page from before an engine was added changes nothing. */
function ConsentTokensInput({ data }: { data: Data }) {
  return <input type="hidden" name="consentTokens" value={data.engines.configured.join(",")} />;
}

/** The engine that translates a language first, when several engines are in use (null: DeepL only, or none serves it). */
function servingEngine(data: Data, locale: string): EngineId | null {
  return data.engines.servedBy?.[locale] ?? null;
}

/** The language has formal and informal forms and its engine can set them. */
function hasFormalityChoice(data: Data, locale: string): boolean {
  const engine = servingEngine(data, locale);
  return supportsFormality(locale) && !(engine && data.engines.noFormality.includes(engine));
}

// ─── The sections in the nav and the status row ───────────────────────────────

/** A section's name, icon and state: one line for the wide nav, up to two for the phone list. */
interface SectionText {
  name: string;
  icon: IconName;
  summary: string;
  detail: string;
}

/** The form of address in a few words: DeepL decides, formal, informal, per language, or no language yet. */
function addressSummary(data: Data, i18n: I18n): string {
  const { t } = i18n;
  // With several engines, only languages DeepL serves have a choice.
  const formalities = data.style.languages.filter((l) => hasFormalityChoice(data, l.locale)).map((l) => l.formality);
  if (!data.style.languages.length) return t("settings.summary.style.noLanguage");
  if (data.engines.servedBy && formalities.length === 0) return t("settings.style.noChoice");
  if (formalities.every((f) => f === "default")) return t("settings.style.deeplDecides");
  if (formalities.every((f) => f === "more")) return t("settings.style.formal");
  if (formalities.every((f) => f === "less")) return t("settings.style.informal");
  return t("settings.summary.style.mixed");
}

/** The keys in a few words: they work, one needs attention, none yet, or unused on this plan. */
function keysSummary(data: Data, i18n: I18n): string {
  const { t } = i18n;
  const own = data.ownKeys;
  if (!own) return "";
  if (own.access === "off") return t("settings.keys.offPlan.heading");
  if (own.keys.some((k) => k.status !== "OK")) return t("settings.summary.keys.problem");
  const usable = own.keys.filter(usableOwnKey).length;
  return usable ? t("settings.summary.keys.ok", { count: usable }) : t("settings.summary.keys.none");
}

/** The plan's name as the Plan page's hero names it ("Pro", "Owner access", "No plan chosen"). */
function planLabel(data: Data, i18n: I18n): string {
  const { t } = i18n;
  if (data.plan.state === "COMPLIMENTARY") return t("plan.hero.name.complimentary");
  if (!data.plan.configured) return t("plan.hero.name.unconfigured");
  if (data.plan.state === "UNKNOWN") return t("plan.hero.name.unknown");
  if (data.plan.state === "ACTIVE" && data.plan.handle) return planName(data.plan.handle);
  return t("plan.hero.name.none");
}

/** "Pro · <1 % used": the plan and how much of this month's AI characters is used (Own key: no allowance). */
function planSummary(data: Data, i18n: I18n): string {
  const name = planLabel(data, i18n);
  if (data.ownKeys?.plan) return name;
  const usage = usagePercent(data.used, data.limit);
  return `${name} · ${i18n.t("settings.summary.plan.used", { percent: usage.tiny ? i18n.t("settings.usage.tiny") : i18n.percent(usage.percent) })}`;
}

function sectionTexts(data: Data, i18n: I18n): Record<SectionKey, SectionText> {
  const { t } = i18n;
  const changes = changesView(data, i18n);
  const way = changes.mode === "basic" ? t("settings.changes.basic.title") : changes.mode === "smart" ? t("settings.changes.smart.title") : t("settings.changes.manual.title");
  // Paused, stopped or waiting: said in the nav too.
  const attention = changes.badge.tone === "warning" || changes.badge.tone === "critical";
  const publish = effectivePublishMode({ mode: data.publishMode, inPlan: data.autoPublishInPlan });
  const publishTitle = publish === "AUTO_PUBLISH" ? t("settings.publish.auto.title") : t("settings.publish.review.title");
  const publishLine =
    data.publishMode === "AUTO_PUBLISH" && !data.autoPublishInPlan
      ? t("settings.summary.publish.notInPlan")
      : publish === "AUTO_PUBLISH"
        ? t("settings.summary.publish.auto")
        : t("settings.summary.publish.review");
  const address = addressSummary(data, i18n);
  const memory = data.reuseMachineMemory ? t("settings.memory.machine.title") : t("settings.memory.approved.title");
  const keys = keysSummary(data, i18n);
  const tokens = data.engines.text;
  const ai = data.consent ? t("common.state.allowed") : t("settings.ai.notAllowed");
  // Allowed: who translates (one service by its legal name, several by their names).
  const aiDetail = !data.consent ? t("settings.summary.ai.missing") : tokens.length === 1 ? processorsText(i18n, tokens) : tokens.length ? enginesText(i18n, tokens) : ai;
  const plan = planSummary(data, i18n);
  const tools = t("settings.summary.tools");
  return {
    changes: { name: t("settings.changes.heading"), icon: "settings", summary: attention ? `${way} · ${changes.badge.label}` : way, detail: changes.line },
    publish: { name: t("settings.publish.heading"), icon: "send", summary: publishTitle, detail: `${publishTitle} · ${publishLine}` },
    style: {
      name: t("settings.section.style"),
      icon: "chat",
      summary: address,
      detail: `${address} · ${data.style.storeContext ? t("settings.summary.style.withContext") : t("settings.summary.style.withoutContext")}`,
    },
    memory: { name: t("common.nav.memory"), icon: "database", summary: memory, detail: memory },
    keys: { name: t("settings.section.keys"), icon: "key", summary: keys, detail: keys },
    ai: { name: t("settings.ai.heading"), icon: "shield-check-mark", summary: ai, detail: aiDetail },
    plan: { name: t("settings.section.plan"), icon: "gauge", summary: plan, detail: plan },
    tools: { name: t("settings.tools.heading"), icon: "wrench", summary: tools, detail: tools },
  };
}

/** The status row with the section that fixes what it names (none: all set up, or a language in Shopify). */
interface PageStatus extends StatusView {
  section: SectionKey | null;
  action: { label: string; href: string; external?: boolean } | null;
}

/** The one thing that needs the merchant, in the order of the page's next steps: a language, a key, the permission, translating changes. */
function pageStatus(data: Data, i18n: I18n): PageStatus {
  const { t } = i18n;
  if (!data.style.languages.length) {
    return {
      tone: "warning",
      title: t("content.noLanguages.heading"),
      detail: t("settings.noLanguages.body"),
      section: null,
      action: { label: t("resources.noLanguages.open"), href: "shopify://admin/settings/languages", external: true },
    };
  }
  const own = data.ownKeys?.plan ? data.ownKeys : null;
  if (own?.keys.some((k) => k.status !== "OK")) {
    const state = keysState(i18n, own.keys);
    return {
      tone: state.tone === "critical" ? "critical" : "warning",
      title: t("settings.summary.keys.problem"),
      detail: state.label,
      section: "keys",
      action: { label: t("settings.status.keys.action"), href: sectionHref("keys") },
    };
  }
  if (ownKeyMissing(data)) {
    return {
      tone: "warning",
      title: t("overview.checklist.ownKey.label"),
      detail: t("settings.status.noKey"),
      section: "keys",
      action: { label: t("overview.checklist.ownKey.action"), href: sectionHref("keys") },
    };
  }
  if (!data.consent) {
    return {
      tone: "warning",
      title: t("settings.status.consent"),
      detail: t("settings.summary.ai.missing"),
      section: "ai",
      action: { label: t("settings.status.consent.action"), href: sectionHref("ai") },
    };
  }
  const changes = changesView(data, i18n);
  if (changes.badge.tone === "warning" || changes.badge.tone === "critical") {
    return {
      tone: changes.badge.tone,
      title: t("settings.changes.heading"),
      badge: changes.badge,
      detail: changes.line,
      section: "changes",
      action: { label: t("settings.status.changes.action"), href: sectionHref("changes") },
    };
  }
  return { tone: "success", title: t("settings.status.ok"), section: null, action: null };
}

// ─── Plan and tools ───────────────────────────────────────────────────────────

/** The plan, this month's AI characters of its allowance and when new ones come (Own key: what went through the keys), and the way to the Plan page. */
function PlanCard({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const own = data.ownKeys?.plan ? data.ownKeys : null;
  const usage = usagePercent(data.used, data.limit);
  const level = usageLevel(data.used, data.limit);
  const levelState: SettingState | null =
    level === "exhausted"
      ? { label: t("settings.usage.exhausted"), icon: "alert-circle", tone: "critical" }
      : level === "high"
        ? { label: t("settings.usage.high"), icon: "alert-triangle", tone: "warning" }
        : null;
  return (
    <SettingSection id="settings-plan" heading={t("settings.section.plan")} lead={own ? t("settings.plan.lead.ownKey") : t("settings.plan.lead")}>
      <s-stack direction="block" gap="small-500">
        <s-text color="subdued">{t("common.nav.plan")}</s-text>
        <strong style={STAT}>{planLabel(data, i18n)}</strong>
      </s-stack>
      {own ? (
        <s-text color="subdued">{own.usage.total > 0 ? t("settings.keys.usage", { chars: own.usage.total }) : t("settings.keys.usage.none")}</s-text>
      ) : (
        <s-stack direction="block" gap="small-300">
          <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="center">
            <span style={SETTING_NAME}>{t("settings.usage.short")}</span>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {levelState ? <StateBadge state={levelState} /> : null}
              <span style={STAT}>{usage.tiny ? t("settings.usage.tiny") : i18n.percent(usage.percent)}</span>
            </s-stack>
          </s-grid>
          <ProgressBar value={usage.percent} label={t("settings.usage.progress")} tone={level === "exhausted" ? "critical" : level === "high" ? "warning" : "success"} />
          <s-text color="subdued">{t("settings.usage.line", { used: i18n.number(data.used), limit: i18n.number(data.limit), date: i18n.dayMonth(data.resetsOn, data.now) })}</s-text>
        </s-stack>
      )}
      <s-stack direction="inline">
        <Button href="/app/plan">{t("common.action.seePlans")}</Button>
      </s-stack>
    </SettingSection>
  );
}

function ToolsCard({ i18n }: { i18n: I18n }) {
  const { t } = i18n;
  return (
    <SettingSection id="settings-tools" heading={t("settings.tools.heading")} lead={t("settings.tools.lead")}>
      <LinkTiles label={t("settings.tools.heading")} links={TOOLS.map((tool) => ({ href: tool.href, icon: tool.icon, name: t(tool.label), detail: t(tool.detail) }))} />
    </SettingSection>
  );
}

// ─── Translating changes ──────────────────────────────────────────────────────

/** Why it is paused, in a few words ("Daily limit reached"); an own key's stop: "Waits for your key". */
function pauseShort(i18n: I18n, reason: string): string {
  if (isOwnKeyCode(reason)) return i18n.t("settings.changes.pause.OWN_KEY");
  return i18n.t(`settings.changes.pause.${PAUSE_SHORT[reason] ?? "PROVIDER"}` as "settings.changes.pause.PROVIDER");
}

/** On the Own key plan without a usable key: nothing translates with AI before one is added. */
function ownKeyMissing(data: Data): boolean {
  return Boolean(data.ownKeys?.plan) && !data.ownKeys!.keys.some(usableOwnKey);
}

/** "Add your translation key first.", leading to the keys section. */
function NoKeyLine({ i18n }: { i18n: I18n }) {
  return (
    <StateLine icon="connect">
      <s-link href={sectionHref("keys")}>{i18n.t("settings.changes.line.noKey")}</s-link>
    </StateLine>
  );
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
          ? ownKeyMissing(data)
            ? t("settings.changes.line.noKey")
            : t("settings.changes.line.unavailable")
          : basic === "consent"
            ? t("settings.changes.waiting.CONSENT")
            : basic === "paused" && data.auto.paused
              ? t("settings.changes.line.pausedUntil", { time: i18n.dateTime(data.auto.paused.until), reason: pauseShort(i18n, data.auto.paused.reason) })
              : basic === "noLanguage"
                ? t("settings.changes.waiting.NO_LANGUAGE")
                : t("settings.changes.line.basic", { languages: languageList(i18n, names, 2) });
    // Own key plan without a key: it needs the merchant's key, not the installation.
    const badge: SettingState =
      basic === "unavailable" && ownKeyMissing(data) ? { label: t("settings.changes.badge.noKey"), icon: "connect", tone: "warning" } : basicBadge(i18n, basic);
    return { mode, basic, smart, badge, line };
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
      <ConsentTokensInput data={data} />
      <Button type="submit" variant={variant} {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
        {t("settings.ai.allow")}
      </Button>
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
          <Button type="submit" {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
            {mode === "basic" ? t("settings.auto.saveLanguages") : t("settings.auto.turnOn")}
          </Button>
          {mode === "basic" ? null : (
            <Button type="button" variant="tertiary" onClick={() => setChoosingBasic(false)}>
              {t("common.action.cancel")}
            </Button>
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
              <Button href="/app/plan">
                {t("common.action.seePlans")}
              </Button>
              <Button onClick={turnOffBasic} {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                {t("settings.auto.turnOff")}
              </Button>
            </>
          }
        >
          {t("settings.changes.stoppedByPlan")}
        </InlineNotice>
      );
    } else if (basic === "unavailable") {
      state = ownKeyMissing(data) ? (
        <NoKeyLine i18n={i18n} />
      ) : (
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
      const reason = data.auto.paused.reason;
      const key = AUTO_PAUSE_REASONS.includes(reason) ? reason : "PROVIDER";
      state = (
        <s-banner tone="warning" heading={t("settings.auto.paused.heading")}>
          <s-paragraph>
            {isOwnKeyCode(reason)
              ? // An own key's stop: what its service said, and that a working key lifts the pause.
                t("settings.auto.paused.OWN_KEY", { problem: jobErrorMessage(i18n, reason) ?? "", date: i18n.dateTime(data.auto.paused.until) })
              : t(`settings.auto.paused.${key}` as "settings.auto.paused.PROVIDER", { date: i18n.dateTime(data.auto.paused.until) })}
          </s-paragraph>
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
                  <Button type="submit" variant={data.consent ? "primary" : "secondary"} {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("settings.changes.instead")}
                  </Button>
                </autoFetcher.Form>
              ) : null}
              <Button href="/app/plan">
                {t("common.action.seePlans")}
              </Button>
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
    <SettingSection
      id="settings-changes"
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
            mode === "basic" ? null : ownKeyMissing(data) ? <NoKeyLine i18n={i18n} /> : <StateLine icon="disabled">{t("settings.changes.line.unavailable")}</StateLine>
          ) : !data.consent && mode !== "basic" ? (
            needsConsent
          ) : (mode === "basic" && basic !== "plan") || choosingBasic ? (
            basicForm
          ) : null}
          {errorInBasic && autoError ? <AutoError i18n={i18n} error={autoError} tokens={data.engines.text} /> : null}
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
                    <Button onClick={() => smartAct("check-now", { key: data.smartCheckKey })} {...(smartFetcher.state !== "idle" ? { loading: true } : {})}>
                      {t("automatic.action.checkNow")}
                    </Button>
                  ) : null}
                  <Button href="/app/settings/automatic">
                    {t("automatic.action.options")}
                  </Button>
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
      {!errorInBasic && autoError ? <AutoError i18n={i18n} error={autoError} tokens={data.engines.text} /> : null}
      {/* Own key plan: nothing limits automatic translation through the keys but the services' own budgets. */}
      {data.ownKeys?.plan && data.ownKeys.keys.some(usableOwnKey) && data.auto.planIncludes ? (
        <StateLine icon="cash-dollar" tone="caution">
          {ownKeyCostNote(i18n, data.ownKeys.keys)}
        </StateLine>
      ) : null}
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
              // Own key plan: no AI characters of Linguva's (the cost note above says who bills).
              ...(data.ownKeys?.plan ? [] : [{ icon: "gauge" as const, text: t("settings.auto.how.allowance") }]),
            ]}
          />
        </More>
      )}
    </SettingSection>
  );
}

function AutoError({ i18n, error, tokens }: { i18n: I18n; error: string; tokens: readonly ConsentToken[] }) {
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
        <s-paragraph>{isDeepLOnly(tokens) ? t("settings.auto.consent.body") : t("settings.auto.consent.body.multi", { engines: enginesText(i18n, tokens) })}</s-paragraph>
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
    <SettingSection
      id="settings-publish"
      heading={t("settings.publish.heading")}
      state={mode === "AUTO_PUBLISH" ? { label: t("settings.publish.state.auto"), icon: "bolt", tone: "warning" } : { label: t("settings.publish.state.review"), icon: "eye-check-mark", tone: "success" }}
      lead={t("settings.publish.scope")}
    >
      {downgraded ? <StateLine icon="lock">{t("settings.publish.notInPlan")}</StateLine> : null}
      <PublishingChoice id="settings-publish" mode={mode} stored={downgraded} inPlan={data.autoPublishInPlan} onChoose={choose} busy={fetcher.state !== "idle"} lockLink={data.style.languages.length > 0} />
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
    </SettingSection>
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
  // DeepL and at least one other service in the texts: only DeepL applies the form of address and the context.
  const withFallback = data.engines.text.includes("deepl") && !isDeepLOnly(data.engines.text);
  // No DeepL at all (Azure, Google or both): no service in use reads the store context.
  const contextUnused = !data.engines.text.includes("deepl");
  return (
    <SettingSection id="settings-style" heading={t("settings.section.style")} lead={t("settings.style.lead")}>
      <ui-save-bar id={STYLE_SAVE_BAR}>
        <button variant="primary" onClick={() => formRef.current?.requestSubmit()} {...(fetcher.state !== "idle" ? { loading: "" } : {})}>
          {t("automatic.action.save")}
        </button>
        <button onClick={discard}>{t("automatic.action.discard")}</button>
      </ui-save-bar>
      <fetcher.Form key={formKey} ref={formRef} method="post" onChange={() => setDirty(true)} onInput={() => setDirty(true)}>
        <input type="hidden" name="intent" value="style" />
        <s-stack direction="block" gap="base">
          <h3 style={SUB_HEADING}>{t("settings.style.heading")}</h3>
          {data.style.languages.length ? (
            <AddressChoices data={data} i18n={i18n} />
          ) : (
            <StateLine icon="language">{t("settings.style.noLanguages")}</StateLine>
          )}
          {/* DeepL is always first when it is used, so "if DeepL can't translate" stays true. Only a
              chosen form (formal or informal) is dropped by the other services and raises
              FORMALITY_NOT_APPLIED; "DeepL decides" sends none. */}
          {withFallback && data.style.languages.some((l) => hasFormalityChoice(data, l.locale) && l.formality !== "default") ? (
            <s-text color="subdued">{t("settings.style.fallbackNote")}</s-text>
          ) : null}
          <s-text-area
            name="storeContext"
            label={t("settings.style.storeContext.label")}
            placeholder={t("settings.style.storeContext.placeholder")}
            details={
              contextUnused
                ? t("settings.style.storeContext.detailsUnused")
                : withFallback
                  ? t("settings.style.storeContext.detailsDeepL")
                  : t("settings.style.storeContext.details")
            }
            value={data.style.storeContext}
            maxLength={data.style.maxContext}
            rows={2}
          />
          <StateLine icon="book-open">
            {t("settings.style.glossary", { count: data.glossaryTerms })} <s-link href="/app/glossary">{t("settings.style.glossaryLink")}</s-link>
          </StateLine>
        </s-stack>
      </fetcher.Form>
    </SettingSection>
  );
}

/**
 * The form of address, language by language: a row with the segmented
 * choice ("DeepL entscheidet" · "Sie" · "Du") for each language that has
 * one, then one line naming the languages without a choice, with their
 * flags. Their stored value goes along unchanged (hidden inputs).
 */
function AddressChoices({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const languages = data.style.languages.map((l) => ({ ...l, label: i18n.language(l.locale, l.name) }));
  const choices = languages.filter((l) => hasFormalityChoice(data, l.locale));
  const without = languages.filter((l) => !hasFormalityChoice(data, l.locale));
  // Without a choice: the languages DeepL has none for, and per service those it translates without one.
  const byEngine = new Map<EngineId, typeof without>();
  const none: typeof without = [];
  for (const l of without) {
    const engine = supportsFormality(l.locale) ? servingEngine(data, l.locale) : null;
    if (engine) byEngine.set(engine, [...(byEngine.get(engine) ?? []), l]);
    else none.push(l);
  }
  const options = (locale: string) => {
    const pronouns = formalityPronouns(locale);
    return [
      { value: "default", label: t("settings.style.deeplDecides") },
      pronouns
        ? { value: "more", label: upperFirst(pronouns.formal), accessibilityLabel: t("settings.style.formalWith", { pronoun: pronouns.formal }) }
        : { value: "more", label: t("settings.style.formal") },
      pronouns
        ? { value: "less", label: upperFirst(pronouns.informal), accessibilityLabel: t("settings.style.informalWith", { pronoun: pronouns.informal }) }
        : { value: "less", label: t("settings.style.informal") },
    ];
  };
  return (
    <s-stack direction="block" gap="small-200">
      {choices.length ? <s-text color="subdued">{t("settings.style.autoHint")}</s-text> : null}
      {choices.length ? (
        <ul aria-label={t("settings.style.address")} className="lv-choices">
          {choices.map((l) => (
            <li key={l.locale} className="lv-choice">
              <span className="lv-choice__name" aria-hidden="true">
                <Flag country={localeCountry(l.locale)} fallback={l.locale} size={20} />
                <span>{l.label}</span>
              </span>
              <Segmented name={`formality:${l.locale}`} legend={l.label} options={options(l.locale)} defaultValue={l.formality} even />
            </li>
          ))}
        </ul>
      ) : null}
      {without.map((l) => (
        // No choice for this language: what is stored stays as it is.
        <input key={l.locale} type="hidden" name={`formality:${l.locale}`} value={l.formality} />
      ))}
      {none.length ? <LanguageLine i18n={i18n} text={t("settings.style.noChoiceFor")} languages={none} /> : null}
      {[...byEngine].map(([engine, list]) => (
        <LanguageLine key={engine} i18n={i18n} text={t("settings.style.engineNoChoiceFor", { engine: ENGINE_NAMES[engine] })} languages={list} />
      ))}
    </s-stack>
  );
}

/** A sentence with {languages}: each language with its flag, joined as the interface language joins a list. */
function LanguageLine({ i18n, text, languages }: { i18n: I18n; text: string; languages: ReadonlyArray<{ locale: string; label: string }> }) {
  const [before, after = ""] = text.split("{languages}");
  const parts = new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).formatToParts(languages.map((l) => l.label));
  let index = 0;
  return (
    <p className="lv-language-line">
      {before}
      {parts.map((part, i) => {
        if (part.type !== "element") return <Fragment key={i}>{part.value}</Fragment>;
        const language = languages[index++]!;
        return (
          <span key={i} className="lv-language-line__item">
            <Flag country={localeCountry(language.locale)} fallback={language.locale} size={20} />
            {part.value}
          </span>
        );
      })}
      {after}
    </p>
  );
}

// ─── Translation memory ───────────────────────────────────────────────────────

function MemoryCard({ data, i18n, fetcher }: { data: Data; i18n: I18n; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const { t } = i18n;
  const busy = fetcher.state !== "idle";
  const choose = (enabled: boolean) => fetcher.submit({ intent: "reuse-memory", enabled: String(enabled) }, { method: "post" });
  return (
    <SettingSection
      id="settings-memory"
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
    </SettingSection>
  );
}

// ─── AI permission ────────────────────────────────────────────────────────────

/**
 * The permission's lead on the Own key plan: the merchant's own keys, under its own contract with
 * each service; with several, their order and the failover (as the operator's multi-engine notice).
 */
function ownKeyLead(i18n: I18n, tokens: readonly ConsentToken[]): string {
  if (tokens.length > 1) return i18n.t("settings.ai.lead.ownKey.multi", { processors: processorsText(i18n, tokens), ...orderTexts(i18n, tokens) });
  return i18n.t("settings.ai.lead.ownKey.one", { processors: processorsText(i18n, tokens) });
}

function PermissionCard({
  data,
  i18n,
  fetcher,
  primary,
  top,
}: {
  data: Data;
  i18n: I18n;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  primary: boolean;
  /** Above the card: the way back to a job stopped for the permission, once it is given. */
  top?: ReactNode;
}) {
  const { t } = i18n;
  const busy = fetcher.state !== "idle";
  const revoke = () => fetcher.submit({ intent: "revoke-consent" }, { method: "post" });
  const tokens = data.engines.text;
  const deeplOnly = isDeepLOnly(tokens);
  const changed = fetcher.data && "error" in fetcher.data && fetcher.data.error === "CONSENT_CHANGED";
  // Own key plan: the own-key notice (a different notice from Linguva's, asked for separately).
  const own = Boolean(data.ownKeys?.plan);
  // Before the first usable key there is nothing to allow.
  const noKey = own && data.engines.configured.length === 0;
  const lead = (shown: readonly ConsentToken[]) => (own ? ownKeyLead(i18n, shown) : consentLead(i18n, shown));
  return (
    <SettingSection
      id="settings-ai"
      heading={t("settings.ai.heading")}
      state={data.consent ? { label: t("common.state.allowed"), icon: "check-circle", tone: "success" } : { label: t("settings.ai.notAllowed"), icon: "minus-circle", tone: "warning" }}
      // Since when: "Allowed  since November 3, 2026".
      extra={data.consent && data.consentAt ? <s-text color="subdued">{t("settings.ai.since", { date: i18n.date(data.consentAt, "long") })}</s-text> : null}
      lead={noKey ? undefined : lead(tokens)}
      top={top}
    >
      {changed ? (
        <s-banner tone="warning">
          <s-paragraph>{t("settings.ai.changed")}</s-paragraph>
        </s-banner>
      ) : null}
      <More summary={t("settings.ai.detailsSummary")}>
        <s-paragraph>{deeplOnly ? t("settings.ai.personal") : t("settings.ai.personal.multi")}</s-paragraph>
        <s-paragraph>{t("settings.ai.details")}</s-paragraph>
      </More>
      <s-stack direction="inline">
        {data.consent ? (
          <Button commandFor={REVOKE_MODAL} command="--show" {...(busy ? { loading: true } : {})}>
            {t("settings.ai.withdraw")}
          </Button>
        ) : noKey ? (
          <StateLine icon="connect">{t("settings.ai.noKey")}</StateLine>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="grant-consent" />
            <ConsentTokensInput data={data} />
            <Button type="submit" variant={primary ? "primary" : "secondary"} {...(busy ? { loading: true } : {})}>
              {t("settings.ai.allow")}
            </Button>
          </fetcher.Form>
        )}
      </s-stack>
      {data.consent && data.engines.missing.length ? (
        // Engines added after the shop's consent: used only once the merchant allows them too.
        <s-box padding="base" border="base" borderRadius="base">
          <s-stack direction="block" gap="small-200">
            <s-heading>{t("settings.ai.extra.heading")}</s-heading>
            <s-paragraph>
              {own
                ? t("settings.ai.extra.body.ownKey", { processors: processorsText(i18n, data.engines.missing), consented: enginesText(i18n, tokens) })
                : t("settings.ai.extra.body", { processors: processorsText(i18n, data.engines.missing), consented: enginesText(i18n, tokens) })}
            </s-paragraph>
            {/* The notice the stored version stands for: every service in use, their order and the failover. */}
            <s-paragraph>{lead(data.engines.configured)}</s-paragraph>
            <s-paragraph>{t("settings.ai.personal.multi")}</s-paragraph>
            <s-stack direction="inline">
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="grant-consent" />
                <input type="hidden" name="extend" value="true" />
                <ConsentTokensInput data={data} />
                <Button type="submit" {...(busy ? { loading: true } : {})}>
                  {t("settings.ai.extra.action")}
                </Button>
              </fetcher.Form>
            </s-stack>
          </s-stack>
        </s-box>
      ) : null}
      {/* The operator's engines only: an own-key shop without a key adds one instead (the keys card). */}
      {!data.aiAvailable && !data.ownKeys?.plan ? (
        <s-banner tone="warning" heading={t("settings.ai.notConfigured.heading")}>
          <s-paragraph>{t("settings.ai.notConfigured.body")}</s-paragraph>
        </s-banner>
      ) : null}
      <s-modal id={REVOKE_MODAL} heading={t("settings.ai.revoke.heading")} accessibilityLabel={t("settings.ai.revoke.heading")}>
        <s-paragraph>{deeplOnly ? t("settings.ai.revoke.body") : t("settings.ai.revoke.body.multi", { engines: enginesText(i18n, tokens) })}</s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" commandFor={REVOKE_MODAL} command="--hide" onClick={revoke}>
          {t("settings.ai.withdraw")}
        </s-button>
        <s-button slot="secondary-actions" commandFor={REVOKE_MODAL} command="--hide">
          {t("common.action.cancel")}
        </s-button>
      </s-modal>
    </SettingSection>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
