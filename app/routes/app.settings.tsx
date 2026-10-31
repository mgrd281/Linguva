import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getConfig } from "../.server/lib/config";
import { ProgressBar } from "../components/ProgressBar";
import { aiLimitsFor, shopBilling } from "../.server/billing/billing";
import { prisma } from "../.server/lib/db";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { getTranslationProvider } from "../.server/providers";
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
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { getQueues } from "../.server/queue/client";
import { requireShop } from "../.server/shopify/require-shop";
import { getDailyUsage, getMonthlyUsage, nextPeriodStart, periodKey } from "../.server/usage/usage-ledger";
import { useResultToast } from "../components/app-bridge";
import { smartErrorText, SmartPreview, SmartStateBanner, smartToast } from "../components/SmartAutoCard";
import { FactList, Glance, InlineNotice, LinkTiles, More, OptionCard, OptionPair, SettingCard, type GlanceTile, type SettingState } from "../components/SettingsParts";
import { Flag } from "../components/Flag";
import { BIG_HEADING, PLAIN_LIST } from "../components/LanguageLayout";
import { FIGURE } from "../components/plan/styles";
import { localeCountry } from "../lib/flags";
import { usageLevel } from "../lib/usage";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { getSmartConfig, setSmartEnabled } from "../.server/smart/config";
import { settleAfterConsent } from "../.server/smart/runs";
import { useI18n } from "../i18n/react";
import { languageList } from "../lib/name-lists";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const [settings, locales, billing] = await Promise.all([
    getShopSettings(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
    shopBilling(admin, shop),
  ]);
  // The same allowance as the Overview, editor and Plan page (the plan's, when billing is on).
  const limits = aiLimitsFor(getConfig(), billing);
  const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
  // The smart schedule (Business): its state and preview; other plans see what it would add.
  const smartState = billing.entitlements.smartAuto ? await smartContext(billing, settings, targets) : null;
  const smart = smartState ? await loadSmartPanel(shop.id, { ...smartState, shopTimeZone: null }) : null;
  return {
    // One Check now per page view (a double click is one check).
    smartCheckKey: crypto.randomUUID(),
    smart: smart
      ? {
          status: smart.status,
          zone: smart.zone,
          config: smart.config,
          nextChecks: smart.nextChecks,
          lastSuccessAt: smart.lastSuccessAt,
          lastRun: smart.lastRun,
          translating: smart.translating,
          estimate: smart.estimate,
          remeasure: smart.remeasure,
          publishing: smart.publishing,
          // Turning on needs both: the card says so instead of a button that is refused.
          cantTurnOn: !smartState!.consent ? ("CONSENT" as const) : !smartState!.available ? ("UNAVAILABLE" as const) : null,
        }
      : null,
    style: {
      languages: locales.locales
        .filter((l) => !l.primary)
        .map((l) => ({ locale: l.locale, name: l.name, formality: formalityFor(settings, l.locale) ?? "default" })),
      storeContext: settings.aiStoreContext ?? "",
      maxContext: AI_STORE_CONTEXT_MAX,
    },
    consent: hasCurrentAiConsent(settings),
    consentAt: settings.aiDataProcessingConsentAt?.toISOString() ?? null,
    publishMode: settings.bulkPublishMode,
    // Shown on the option before it is chosen; the action checks the plan again.
    autoPublishInPlan: billing.entitlements.autoPublish,
    autoPublishEnabledAt: settings.autoPublishEnabledAt?.toISOString() ?? null,
    reuseMachineMemory: settings.reuseMachineMemory,
    auto: {
      enabled: settings.autoTranslateNew,
      locales: settings.autoTranslateLocales,
      // Needs AI, background jobs and a plan that includes bulk translation.
      available: getTranslationProvider() !== null && getQueues() !== null,
      planIncludes: billing.entitlements.bulk,
      // The plan's languages: the first ones in the order listed here, as for bulk jobs and the editor.
      allowedLocales: allowedTargetLocales(
        billing.entitlements,
        locales.locales.filter((l) => !l.primary).map((l) => l.locale),
      ),
      paused: autoTranslatePaused(settings)
        ? { until: settings.autoPausedUntil!.toISOString(), reason: settings.autoPauseReason ?? "PROVIDER" }
        : null,
    },
    aiAvailable: getTranslationProvider() !== null,
    period: periodKey(),
    // When the month's characters renew, said like the Plan page ("on 1 November").
    now: new Date().toISOString(),
    resetsOn: nextPeriodStart().toISOString(),
    used: await getMonthlyUsage(shop.id),
    limit: limits.limit,
    usedToday: await getDailyUsage(shop.id),
    dailyLimit: limits.dailyLimit,
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
      await setBulkPublishMode({
        shopId: shop.id,
        mode: form.get("mode") === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "DRAFT",
        confirmed: form.get("confirm") === "on",
        actorId,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof ConfirmationRequiredError) return { ok: false, error: "CONFIRMATION_REQUIRED" };
      throw error;
    }
  }
  if (intent === "auto") {
    const enabled = form.get("enabled") === "true";
    const billing = await shopBilling(admin, shop);
    const smart = enabled ? await getSmartConfig(shop.id) : null;
    if (enabled) {
      if (!hasCurrentAiConsent(await getShopSettings(shop.id))) return { ok: false, error: "CONSENT_REQUIRED" };
      if (!billing.entitlements.bulk) return { ok: false, error: "PLAN_BULK" };
      // The smart schedule replaces it while on: both would follow the same changes.
      if (smart?.enabled && billing.entitlements.smartAuto) return { ok: false, error: "SMART_ON" };
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
    // Left on from a plan that had it, the smart schedule can't run any more: this replaces it.
    if (smart?.enabled) await setSmartEnabled({ shopId: shop.id, actorId, enabled: false });
    const result = await setAutoTranslate({ shopId: shop.id, enabled, locales: chosen, allowedLocales: allowed, actorId });
    return { ok: true, saved: "auto" as const, autoEnabled: result.enabled };
  }
  if (intent === "reuse-memory") {
    await setReuseMachineMemory({ shopId: shop.id, enabled: form.get("enabled") === "true" });
    return { ok: true };
  }
  if (intent !== "grant-consent" && intent !== "revoke-consent") {
    return { ok: false };
  }
  await setAiConsent({ shopId: shop.id, granted: intent === "grant-consent", actorId });
  // The smart schedule waits for consent no longer than needed.
  if (intent === "grant-consent") await settleAfterConsent({ prisma, adminFor: async () => admin, billingFor: async () => shopBilling(admin, shop) }, shop);
  return { ok: true };
};

/**
 * The pages that aren't in the navigation, beside the settings: the store's
 * languages and countries, every figure in detail, and the tools for
 * wording, reuse, files and the plan. The smart schedule opens from its
 * section.
 */
const TOOLS = [
  { href: "/app/languages", icon: "language", label: "common.languages", detail: "settings.tools.languages.detail" },
  { href: "/app/markets", icon: "globe", label: "settings.tools.markets.label", detail: "settings.tools.markets.detail" },
  { href: "/app/coverage", icon: "chart-donut", label: "settings.tools.coverage.label", detail: "settings.tools.coverage.detail" },
  { href: "/app/glossary", icon: "book-open", label: "common.nav.glossary", detail: "settings.tools.glossary.detail" },
  { href: "/app/memory", icon: "database", label: "common.nav.memory", detail: "settings.tools.memory.detail" },
  { href: "/app/translations", icon: "transfer", label: "transfer.page.heading", detail: "settings.tools.transfer.detail" },
  { href: "/app/plan", icon: "plan", label: "common.nav.plan", detail: "settings.tools.plan.detail" },
] as const;

// Each tool is one link (the whole row, at least 44 px high), its name and what it is for inside.
function ToolsCard() {
  const { t } = useI18n();
  return (
    <SettingCard id="settings-tools" icon="wrench" heading={t("settings.tools.heading")} lead={t("settings.tools.lead")}>
      <LinkTiles
        label={t("settings.tools.heading")}
        links={TOOLS.map((tool) => ({ href: tool.href, icon: tool.icon, name: t(tool.label), detail: t(tool.detail) }))}
      />
    </SettingCard>
  );
}

const AUTO_PAUSE_REASONS = ["DAILY_LIMIT", "PLATFORM_LIMIT", "QUOTA_EXCEEDED"];

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t, date, dateTime, dayMonth, month, number, language } = i18n;
  const fetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
  const styleFetcher = useFetcher<typeof action>();
  const autoFetcher = useFetcher<typeof action>();
  // The smart schedule's actions go to its page's action, which checks the plan again.
  const smartFetcher = useFetcher<{ ok: boolean; done?: string; count?: number; error?: string }>();
  const smartAct = (intent: string, extra: Record<string, string> = {}) =>
    smartFetcher.submit({ intent, ...extra }, { method: "post", action: "/app/settings/automatic" });
  useResultToast(smartFetcher.data, smartToast(t, smartFetcher.data));
  const smartBusy = smartFetcher.state !== "idle";
  // While the smart schedule is on, it replaces automatic translation of changes (no controls for both).
  const smartOn = Boolean(data.smart && data.smart.status.state !== "off");
  const languageNames = new Map(data.style.languages.map((l) => [l.locale, language(l.locale, l.name)]));
  const autoError = autoFetcher.data && "error" in autoFetcher.data ? autoFetcher.data.error : null;
  // Saved settings are confirmed with a toast; problems stay on the page.
  useResultToast(styleFetcher.data, styleFetcher.data && "saved" in styleFetcher.data ? t("settings.style.saved") : null);
  useResultToast(
    autoFetcher.data,
    autoFetcher.data && "autoEnabled" in autoFetcher.data
      ? autoFetcher.data.autoEnabled
        ? t("settings.auto.savedOn")
        : t("settings.auto.savedOff")
      : null,
  );
  // The languages automatic translation really translates into: chosen and in the plan.
  const autoLanguages = data.style.languages
    .filter((l) => data.auto.locales.includes(l.locale) && data.auto.allowedLocales.includes(l.locale))
    .map((l) => language(l.locale, l.name))
    .sort((a, b) => a.localeCompare(b));
  const outsidePlan = data.style.languages
    .filter((l) => !data.auto.allowedLocales.includes(l.locale))
    .map((l) => language(l.locale, l.name));
  const busy = fetcher.state !== "idle";
  const percent = data.limit ? Math.min(100, Math.round((data.used / data.limit) * 100)) : 0;
  const level = usageLevel(data.used, data.limit);
  const usageTone = level === "exhausted" ? "critical" : level === "high" ? "warning" : "success";
  const autoPublish = data.publishMode === "AUTO_PUBLISH";
  const turnOffAuto = () => autoFetcher.submit({ intent: "auto", enabled: "false" }, { method: "post" });
  // The language form shows unless the smart schedule replaces it or something blocks it.
  const autoHidden = smartOn && !data.auto.enabled;

  // ─── States in words, each with its icon ───────────────────────────────────
  const consentState: SettingState = data.consent
    ? { label: t("common.state.allowed"), icon: "check-circle", tone: "success" }
    : { label: t("settings.ai.notAllowed"), icon: "minus-circle", tone: "neutral" };
  const publishState: SettingState = autoPublish
    ? { label: t("settings.publish.autoBadge"), icon: "bolt", tone: "warning" }
    : { label: t("settings.publish.reviewBadge"), icon: "eye-check-mark", tone: "success" };
  const autoState: SettingState = !data.auto.enabled
    ? { label: t("common.state.off"), icon: "minus-circle", tone: "neutral" }
    : data.auto.paused
      ? { label: t("settings.auto.state.paused"), icon: "pause-circle", tone: "warning" }
      : !data.consent
        ? { label: t("settings.auto.state.waiting"), icon: "clock", tone: "warning" }
        : { label: t("common.state.on"), icon: "check-circle", tone: "success" };
  const smartState: SettingState | null = !data.smart
    ? null
    : data.smart.status.state === "on"
      ? { label: t("automatic.state.on"), icon: "check-circle", tone: "success" }
      : data.smart.status.state === "paused"
        ? { label: t("automatic.state.paused"), icon: "pause-circle", tone: "warning" }
        : data.smart.status.state === "waiting"
          ? { label: t("automatic.state.waiting"), icon: "clock", tone: "warning" }
          : { label: t("automatic.state.off"), icon: "minus-circle", tone: "neutral" };

  const glance: GlanceTile[] = [
    {
      href: "#settings-ai",
      icon: "shield-check-mark",
      label: t("settings.ai.heading"),
      state: consentState,
      line: data.consent && data.consentAt ? t("settings.ai.since", { date: date(data.consentAt, "long") }) : t("settings.ai.neededFor"),
    },
    {
      href: "#settings-publish",
      icon: "send",
      label: t("settings.publish.heading"),
      state: publishState,
      line: autoPublish ? t("settings.publish.tile.auto") : t("settings.publish.tile.review"),
    },
    smartOn && smartState
      ? { href: "#settings-smart", icon: "calendar-time", label: t("automatic.name"), state: smartState, line: t("settings.auto.tile.smart") }
      : {
          href: "#settings-auto",
          icon: "automation",
          label: t("settings.auto.heading"),
          state: autoState,
          line: data.auto.enabled && autoLanguages.length ? languageList(i18n, autoLanguages, 3) : t("settings.auto.tile.off"),
        },
    {
      href: "#settings-usage",
      icon: "gauge",
      label: t("settings.usage.short"),
      figure: { value: `${percent} %`, percent, tone: usageTone, label: t("settings.usage.progress") },
      line: t("settings.usage.tile", { used: number(data.used), limit: number(data.limit) }),
    },
  ];

  return (
    <s-page heading={t("common.nav.settings")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-500">
          <h1 style={BIG_HEADING}>{t("common.nav.settings")}</h1>
          <s-text color="subdued">{t("settings.subtitle")}</s-text>
        </s-stack>

        <Glance label={t("settings.glance")} tiles={glance} />

        {/* 1. AI translation: the permission everything with AI needs. */}
        <SettingCard
          id="settings-ai"
          icon="shield-check-mark"
          heading={t("settings.ai.heading")}
          state={consentState}
          meta={data.consent && data.consentAt ? t("settings.ai.since", { date: date(data.consentAt, "long") }) : null}
          lead={t("settings.ai.lead")}
        >
          <More summary={t("settings.ai.detailsSummary")}>
            <s-paragraph>{t("settings.ai.details")}</s-paragraph>
          </More>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={data.consent ? "revoke-consent" : "grant-consent"} />
            <s-stack direction="inline">
              <s-button type="submit" variant={data.consent ? "secondary" : "primary"} {...(busy ? { loading: true } : {})}>
                {data.consent ? t("settings.ai.withdraw") : t("settings.ai.allow")}
              </s-button>
            </s-stack>
          </fetcher.Form>
          {!data.aiAvailable ? (
            <s-banner tone="warning" heading={t("settings.ai.notConfigured.heading")}>
              <s-paragraph>{t("settings.ai.notConfigured.body")}</s-paragraph>
            </s-banner>
          ) : null}
        </SettingCard>

        {/* 2. Translation style: the form of address per language and the store's description. */}
        <SettingCard id="settings-style" icon="chat" heading={t("settings.style.heading")} lead={t("settings.style.lead")}>
          <styleFetcher.Form method="post">
            <input type="hidden" name="intent" value="style" />
            <s-stack direction="block" gap="base">
              {data.style.languages.length ? (
                <s-stack direction="block" gap="small-200">
                  <ul aria-label={t("settings.style.address")} style={PLAIN_LIST}>
                    {data.style.languages.map((l, index) => (
                      <li key={l.locale}>
                        {index > 0 ? <s-divider /> : null}
                        <s-box paddingBlock="small-200">
                          <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(140px, 200px)" gap="base" alignItems="center">
                            <s-stack direction="inline" gap="small-200" alignItems="center">
                              <Flag country={localeCountry(l.locale)} fallback={l.locale} size={20} />
                              <span aria-hidden="true" style={{ fontWeight: 600 }}>
                                {language(l.locale, l.name)}
                              </span>
                            </s-stack>
                            <s-select name={`formality:${l.locale}`} label={language(l.locale, l.name)} labelAccessibilityVisibility="exclusive" value={l.formality}>
                              <s-option value="default">{t("common.automatic")}</s-option>
                              <s-option value="more">{t("settings.style.formal")}</s-option>
                              <s-option value="less">{t("settings.style.informal")}</s-option>
                            </s-select>
                          </s-grid>
                        </s-box>
                      </li>
                    ))}
                  </ul>
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                    <s-icon type="info" color="subdued" />
                    <s-text color="subdued">{t("settings.style.hint")}</s-text>
                  </s-grid>
                </s-stack>
              ) : (
                <s-paragraph>{t("settings.style.noLanguages")}</s-paragraph>
              )}
              <s-text-area
                name="storeContext"
                label={t("settings.style.storeContext.label")}
                details={t("settings.style.storeContext.details", { max: data.style.maxContext })}
                value={data.style.storeContext}
                maxLength={data.style.maxContext}
                rows={2}
              />
              <s-stack direction="inline">
                <s-button type="submit" {...(styleFetcher.state !== "idle" ? { loading: true } : {})}>
                  {t("settings.style.save")}
                </s-button>
              </s-stack>
            </s-stack>
          </styleFetcher.Form>
        </SettingCard>

        {/* 3. Publishing: two choices, the current one marked; switching to automatic needs the confirmation. */}
        <SettingCard id="settings-publish" icon="send" heading={t("settings.publish.heading")} state={publishState} lead={t("settings.publish.lead")}>
          <OptionPair label={t("settings.publish.heading")}>
            <OptionCard
              id="settings-publish-review"
              icon="eye-check-mark"
              title={t("settings.publish.reviewBadge")}
              body={t("settings.publish.reviewBody")}
              current={!autoPublish}
              currentLabel={t("settings.option.current")}
              recommended={t("settings.publish.recommended")}
            >
              {autoPublish ? (
                <modeFetcher.Form method="post">
                  <input type="hidden" name="intent" value="publish-mode" />
                  <input type="hidden" name="mode" value="DRAFT" />
                  <s-button type="submit" {...(modeFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("settings.publish.switchBack")}
                  </s-button>
                </modeFetcher.Form>
              ) : null}
            </OptionCard>
            <OptionCard
              id="settings-publish-auto"
              icon="bolt"
              title={t("settings.publish.autoBadge")}
              body={
                autoPublish && data.autoPublishEnabledAt
                  ? t("settings.publish.autoBodySince", { date: date(data.autoPublishEnabledAt, "long") })
                  : t("settings.publish.autoBody")
              }
              current={autoPublish}
              currentLabel={t("settings.option.current")}
            >
              {autoPublish ? null : data.autoPublishInPlan ? (
                <modeFetcher.Form method="post">
                  <input type="hidden" name="intent" value="publish-mode" />
                  <input type="hidden" name="mode" value="AUTO_PUBLISH" />
                  <s-stack direction="block" gap="small-200">
                    <s-checkbox name="confirm" label={t("settings.publish.confirm")} />
                    <s-stack direction="inline">
                      <s-button type="submit" {...(modeFetcher.state !== "idle" ? { loading: true } : {})}>
                        {t("settings.publish.enable")}
                      </s-button>
                    </s-stack>
                  </s-stack>
                </modeFetcher.Form>
              ) : (
                <s-stack direction="block" gap="small-200">
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                    <s-icon type="lock" color="subdued" />
                    <s-text color="subdued">{t("settings.publish.planNote")}</s-text>
                  </s-grid>
                  <s-stack direction="inline">
                    <s-button href="/app/plan">{t("common.action.seePlans")}</s-button>
                  </s-stack>
                </s-stack>
              )}
            </OptionCard>
          </OptionPair>
          {modeFetcher.data && "error" in modeFetcher.data ? (
            modeFetcher.data.error === "PLAN_AUTO_PUBLISH" ? (
              <s-banner tone="info" heading={t("settings.publish.planHeading")}>
                <s-paragraph>
                  <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                </s-paragraph>
              </s-banner>
            ) : (
              <s-banner tone="critical" heading={t("settings.publish.confirmHeading")}>
                <s-paragraph>{t("settings.publish.confirmBody")}</s-paragraph>
              </s-banner>
            )
          ) : null}
        </SettingCard>

        {/* 4. Automatic translation of changes. */}
        <SettingCard
          id="settings-auto"
          icon="automation"
          heading={t("settings.auto.heading")}
          state={autoHidden ? { label: t("settings.auto.state.replaced"), icon: "calendar-time", tone: "info" } : autoState}
          lead={t("settings.auto.lead")}
        >
          {smartOn ? (
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
              <s-icon type="calendar-time" color="subdued" />
              <s-text>{t("automatic.basic.replacedOn")}</s-text>
            </s-grid>
          ) : data.smart ? (
            <s-text color="subdued">{t("automatic.basic.replaced")}</s-text>
          ) : null}
          {autoHidden ? null : (
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
              <s-icon type={data.auto.enabled ? "language" : "play-circle"} color="subdued" />
              <s-text>
                {!data.auto.enabled
                  ? t("settings.auto.offBody")
                  : autoLanguages.length
                    ? t("settings.auto.languagesLine", { languages: languageList(i18n, autoLanguages, Infinity) })
                    : t("settings.auto.noActiveLanguages")}
              </s-text>
            </s-grid>
          )}
          {autoHidden ? null : (
            <FactList
              label={t("settings.auto.how.label")}
              facts={[
                { icon: "check", text: t("settings.auto.how.missing") },
                { icon: autoPublish ? "bolt" : "eye-check-mark", text: autoPublish ? t("settings.auto.how.auto") : t("settings.auto.how.review") },
                { icon: "clock", text: t("settings.auto.how.later") },
                { icon: "gauge", text: t("settings.auto.how.allowance") },
              ]}
            />
          )}
          {data.auto.enabled && data.auto.paused ? (
            <s-banner tone="warning" heading={t("settings.auto.paused.heading")}>
              <s-paragraph>
                {t(
                  `settings.auto.paused.${AUTO_PAUSE_REASONS.includes(data.auto.paused.reason) ? data.auto.paused.reason : "PROVIDER"}` as "settings.auto.paused.PROVIDER",
                  { date: dateTime(data.auto.paused.until) },
                )}
              </s-paragraph>
            </s-banner>
          ) : null}
          {/* Consent withdrawn while it was on: nothing is sent until it is allowed again. */}
          {data.auto.enabled && !data.consent ? (
            <s-banner tone="warning" heading={t("settings.auto.waitingConsent.heading")}>
              <s-paragraph>{t("settings.auto.waitingConsent.body")}</s-paragraph>
            </s-banner>
          ) : null}
          {autoHidden ? null : !data.auto.available || !data.auto.planIncludes ? (
            <s-stack direction="block" gap="small-200">
              {!data.auto.available ? (
                <InlineNotice icon="disabled" heading={t("settings.auto.unavailable.heading")}>
                  {t("settings.auto.unavailable.body")}
                </InlineNotice>
              ) : (
                <InlineNotice icon="lock" heading={t("settings.auto.planHeading")} action={<s-button href="/app/plan">{t("common.action.seePlans")}</s-button>} />
              )}
              {/* Still on from before (a downgrade, AI removed): it can always be turned off. */}
              {data.auto.enabled ? (
                <s-stack direction="inline">
                  <s-button type="button" onClick={turnOffAuto}>
                    {t("settings.auto.turnOff")}
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          ) : data.style.languages.length === 0 ? (
            <s-stack direction="block" gap="small-200">
              <InlineNotice icon="language" heading={t("settings.auto.noLanguages")} action={<s-button href="/app/languages">{t("common.languages")}</s-button>} />
              {/* Every language removed in Shopify while it was on: it can still be turned off. */}
              {data.auto.enabled ? (
                <s-stack direction="inline">
                  <s-button type="button" onClick={turnOffAuto}>
                    {t("settings.auto.turnOff")}
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          ) : (
            <autoFetcher.Form method="post">
              <input type="hidden" name="intent" value="auto" />
              <input type="hidden" name="enabled" value="true" />
              <s-box background="subdued" borderRadius="large-100" padding="base">
                <s-stack direction="block" gap="small-200">
                  <s-choice-list name="locale" label={t("settings.auto.languages")} multiple>
                    {data.style.languages
                      .filter((l) => data.auto.allowedLocales.includes(l.locale))
                      .map((l) => (
                        <s-choice key={l.locale} value={l.locale} defaultSelected={data.auto.locales.includes(l.locale)}>
                          {language(l.locale, l.name)}
                        </s-choice>
                      ))}
                  </s-choice-list>
                  {/* Named in a sentence rather than as disabled choices: those can't be focused, and their text is faint. */}
                  {outsidePlan.length ? (
                    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                      <s-icon type="lock" color="subdued" />
                      <s-text color="subdued">
                        {t("settings.auto.outsidePlan", { languages: languageList(i18n, outsidePlan, Infinity), count: outsidePlan.length })}{" "}
                        <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                      </s-text>
                    </s-grid>
                  ) : null}
                  <s-stack direction="inline" gap="small-200">
                    <s-button type="submit" variant={data.auto.enabled ? "secondary" : "primary"} {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                      {data.auto.enabled ? t("settings.auto.saveLanguages") : t("settings.auto.turnOn")}
                    </s-button>
                    {data.auto.enabled ? (
                      <s-button type="button" onClick={turnOffAuto}>
                        {t("settings.auto.turnOff")}
                      </s-button>
                    ) : null}
                  </s-stack>
                </s-stack>
              </s-box>
            </autoFetcher.Form>
          )}
          {autoError === "CONSENT_REQUIRED" ? (
            <s-banner tone="critical" heading={t("settings.auto.consent.heading")}>
              <s-paragraph>{t("settings.auto.consent.body")}</s-paragraph>
            </s-banner>
          ) : autoError === "NO_LANGUAGE" ? (
            <s-banner tone="critical" heading={t("settings.auto.noLanguage.heading")}>
              <s-paragraph>{t("settings.auto.noLanguage.body")}</s-paragraph>
            </s-banner>
          ) : autoError === "PLAN_LANGUAGE" ? (
            <s-banner tone="info" heading={t("settings.auto.planLanguage.heading")}>
              <s-paragraph>
                {t("settings.auto.planLanguage.body")} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
              </s-paragraph>
            </s-banner>
          ) : autoError === "PLAN_BULK" ? (
            <s-banner tone="info" heading={t("settings.auto.planHeading")}>
              <s-paragraph>
                <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
              </s-paragraph>
            </s-banner>
          ) : null}
        </SettingCard>

        {/* 5. The smart schedule (Business), or what it would add on other plans. */}
        {data.smart ? (
          <SettingCard
            id="settings-smart"
            icon="calendar-time"
            heading={t("automatic.name")}
            state={smartState}
            extra={<s-badge tone="info">{t("automatic.business")}</s-badge>}
            lead={t("automatic.card.body")}
          >
            <SmartStateBanner status={data.smart.status} zone={data.smart.zone} />
            {data.smart.config ? <SmartPreview data={data.smart} languageNames={languageNames} /> : null}
            <s-stack direction="inline" gap="small-200">
              {!data.smart.config ? (
                <s-button variant="primary" href="/app/settings/automatic">
                  {t("automatic.action.setUp")}
                </s-button>
              ) : data.smart.status.state === "off" ? (
                <>
                  <s-button
                    variant="primary"
                    disabled={data.smart.cantTurnOn !== null}
                    onClick={() => smartAct("turn-on")}
                    {...(smartBusy ? { loading: true } : {})}
                  >
                    {t("automatic.action.turnOn")}
                  </s-button>
                  <s-button href="/app/settings/automatic">{t("automatic.action.options")}</s-button>
                </>
              ) : (
                <>
                  <s-button
                    variant="primary"
                    disabled={data.smart.status.state !== "on"}
                    onClick={() => smartAct("check-now", { key: data.smartCheckKey })}
                    {...(smartBusy ? { loading: true } : {})}
                  >
                    {t("automatic.action.checkNow")}
                  </s-button>
                  {data.smart.status.state === "paused" ? (
                    <s-button onClick={() => smartAct("resume")}>{t("automatic.action.resume")}</s-button>
                  ) : (
                    <s-button onClick={() => smartAct("pause")}>{t("automatic.action.pause")}</s-button>
                  )}
                  <s-button href="/app/settings/automatic">{t("automatic.action.options")}</s-button>
                </>
              )}
            </s-stack>
            {data.smart.config && data.smart.status.state === "off" && data.smart.cantTurnOn ? (
              <s-text color="subdued">{smartErrorText(i18n, data.smart.cantTurnOn)}</s-text>
            ) : null}
            {smartFetcher.data && !smartFetcher.data.ok && smartFetcher.data.error ? (
              <s-banner tone="critical" heading={t("automatic.error.actionHeading")}>
                <s-paragraph>{smartErrorText(i18n, smartFetcher.data.error)}</s-paragraph>
              </s-banner>
            ) : null}
          </SettingCard>
        ) : (
          <SettingCard
            id="settings-smart"
            icon="calendar-time"
            heading={t("automatic.upsell.heading")}
            extra={
              <s-badge tone="info" icon="lock">
                {t("automatic.business")}
              </s-badge>
            }
            lead={t("automatic.upsell.body")}
          >
            <s-stack direction="inline">
              <s-button href="/app/plan">{t("automatic.upsell.cta")}</s-button>
            </s-stack>
          </SettingCard>
        )}

        {/* 6. Translation memory: two choices, the current one marked. */}
        <SettingCard id="settings-memory" icon="database" heading={t("common.nav.memory")} lead={t("settings.memory.lead")}>
          <OptionPair label={t("common.nav.memory")}>
            <OptionCard
              id="settings-memory-approved"
              icon="check-circle"
              title={t("settings.memory.approved.title")}
              body={t("settings.memory.approved.details")}
              current={!data.reuseMachineMemory}
              currentLabel={t("settings.option.current")}
            >
              {data.reuseMachineMemory ? (
                <memoryFetcher.Form method="post">
                  <input type="hidden" name="intent" value="reuse-memory" />
                  <input type="hidden" name="enabled" value="false" />
                  <s-button type="submit" {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("settings.memory.approvedOnly")}
                  </s-button>
                </memoryFetcher.Form>
              ) : null}
            </OptionCard>
            <OptionCard
              id="settings-memory-machine"
              icon="wand"
              title={t("settings.memory.machine.title")}
              body={t("settings.memory.machine.details")}
              current={data.reuseMachineMemory}
              currentLabel={t("settings.option.current")}
            >
              {data.reuseMachineMemory ? null : (
                <memoryFetcher.Form method="post">
                  <input type="hidden" name="intent" value="reuse-memory" />
                  <input type="hidden" name="enabled" value="true" />
                  <s-button type="submit" {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("settings.memory.alsoMachine")}
                  </s-button>
                </memoryFetcher.Form>
              )}
            </OptionCard>
          </OptionPair>
        </SettingCard>

        {/* 7. AI usage this month: the same allowance as the Overview and the Plan page. */}
        <SettingCard id="settings-usage" icon="gauge" heading={t("settings.usage.heading", { month: month(data.period) })}>
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" justifyContent="space-between" alignItems="baseline" gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="baseline">
                <span style={FIGURE}>{number(data.used)}</span>
                <s-text color="subdued">{t("settings.usage.ofLimit", { limit: number(data.limit) })}</s-text>
              </s-stack>
              <s-text color="subdued">{t("plan.usage.percent", { percent })}</s-text>
            </s-stack>
            <ProgressBar value={percent} label={t("settings.usage.progress")} tone={usageTone} />
            {level !== "ok" ? (
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                <s-icon type="alert-triangle" tone={level === "exhausted" ? "critical" : "caution"} />
                <s-text tone={level === "exhausted" ? "critical" : "caution"}>
                  {level === "exhausted"
                    ? t("plan.usage.exhausted", { date: dayMonth(data.resetsOn, data.now) })
                    : t("plan.usage.high", { left: Math.max(0, data.limit - data.used), date: dayMonth(data.resetsOn, data.now) })}
                </s-text>
              </s-grid>
            ) : null}
          </s-stack>
          <FactList
            label={t("settings.usage.facts")}
            facts={[
              { icon: "clock", text: t("settings.usage.today", { used: number(data.usedToday), limit: number(data.dailyLimit) }) },
              { icon: "calendar", text: t("plan.usage.resets", { date: dayMonth(data.resetsOn, data.now) }) },
              { icon: "database", text: t("settings.usage.notCounted") },
            ]}
          />
          <s-stack direction="inline">
            <s-button href="/app/plan" icon="plan">
              {t("settings.usage.plan")}
            </s-button>
          </s-stack>
        </SettingCard>

        <ToolsCard />
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
