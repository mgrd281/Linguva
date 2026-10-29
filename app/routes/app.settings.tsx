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
import { getDailyUsage, getMonthlyUsage, periodKey } from "../.server/usage/usage-ledger";
import { useResultToast } from "../components/app-bridge";
import { smartErrorText, SmartPreview, SmartStateBadge, SmartStateBanner, smartToast } from "../components/SmartAutoCard";
import { loadSmartPanel, smartContext } from "../.server/smart/panel";
import { getSmartConfig, setSmartEnabled } from "../.server/smart/config";
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
  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t, date, dateTime, month, number, language } = i18n;
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

  return (
    <s-page heading={t("common.nav.settings")}>
      <s-section heading={t("settings.ai.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.ai.body")}</s-paragraph>
          {data.consent ? (
            <s-paragraph>
              <s-badge tone="success">{t("common.state.allowed")}</s-badge>{" "}
              {data.consentAt ? t("settings.ai.since", { date: date(data.consentAt, "long") }) : null}
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge>{t("settings.ai.notAllowed")}</s-badge>
            </s-paragraph>
          )}
          <fetcher.Form method="post">
            <input
              type="hidden"
              name="intent"
              value={data.consent ? "revoke-consent" : "grant-consent"}
            />
            <s-button
              type="submit"
              variant={data.consent ? "secondary" : "primary"}
              {...(busy ? { loading: true } : {})}
            >
              {data.consent ? t("settings.ai.withdraw") : t("settings.ai.allow")}
            </s-button>
          </fetcher.Form>
          {!data.aiAvailable ? (
            <s-banner tone="warning" heading={t("settings.ai.notConfigured.heading")}>
              <s-paragraph>{t("settings.ai.notConfigured.body")}</s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading={t("settings.style.heading")}>
        <styleFetcher.Form method="post">
          <input type="hidden" name="intent" value="style" />
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("settings.style.body")}</s-paragraph>
            {data.style.languages.length ? (
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, (inline-size > 640px) 1fr 1fr 1fr, 1fr" gap="base">
                  {data.style.languages.map((l) => (
                    <s-select key={l.locale} name={`formality:${l.locale}`} label={language(l.locale, l.name)} value={l.formality}>
                      <s-option value="default">{t("common.automatic")}</s-option>
                      <s-option value="more">{t("settings.style.formal")}</s-option>
                      <s-option value="less">{t("settings.style.informal")}</s-option>
                    </s-select>
                  ))}
                </s-grid>
              </s-query-container>
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
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="submit" {...(styleFetcher.state !== "idle" ? { loading: true } : {})}>
                {t("settings.style.save")}
              </s-button>
            </s-stack>
          </s-stack>
        </styleFetcher.Form>
      </s-section>

      <s-section heading={t("settings.publish.heading")}>
        <s-stack direction="block" gap="base">
          {data.publishMode === "AUTO_PUBLISH" ? (
            <s-paragraph>
              <s-badge tone="warning">{t("settings.publish.autoBadge")}</s-badge>{" "}
              {data.autoPublishEnabledAt
                ? t("settings.publish.autoBodySince", { date: date(data.autoPublishEnabledAt, "long") })
                : t("settings.publish.autoBody")}
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge tone="success">{t("settings.publish.reviewBadge")}</s-badge> {t("settings.publish.reviewBody")}
            </s-paragraph>
          )}
          <modeFetcher.Form method="post">
            <input type="hidden" name="intent" value="publish-mode" />
            {data.publishMode === "AUTO_PUBLISH" ? (
              <>
                <input type="hidden" name="mode" value="DRAFT" />
                <s-button type="submit">{t("settings.publish.switchBack")}</s-button>
              </>
            ) : (
              <s-stack direction="block" gap="small">
                <input type="hidden" name="mode" value="AUTO_PUBLISH" />
                <s-checkbox name="confirm" label={t("settings.publish.confirm")} />
                <s-button type="submit" variant="secondary">
                  {t("settings.publish.enable")}
                </s-button>
              </s-stack>
            )}
          </modeFetcher.Form>
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
        </s-stack>
      </s-section>

      {data.smart ? (
        <s-section heading={t("automatic.name")}>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <SmartStateBadge status={data.smart.status} />
              <s-badge tone="info">{t("automatic.business")}</s-badge>
            </s-stack>
            <s-paragraph>{t("automatic.card.body")}</s-paragraph>
            <SmartStateBanner status={data.smart.status} zone={data.smart.zone} />
            {data.smart.config ? <SmartPreview data={data.smart} languageNames={languageNames} /> : null}
            <s-stack direction="inline" gap="small">
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
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading={t("settings.auto.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {data.publishMode === "AUTO_PUBLISH" ? t("settings.auto.bodyAutoPublish") : t("settings.auto.bodyReview")}
          </s-paragraph>
          {smartOn ? (
            <s-paragraph>{t("automatic.basic.replacedOn")}</s-paragraph>
          ) : data.smart ? (
            <s-text color="subdued">{t("automatic.basic.replaced")}</s-text>
          ) : null}
          {smartOn && !data.auto.enabled ? null : data.auto.enabled ? (
            <s-paragraph>
              <s-badge tone="success">{t("common.state.on")}</s-badge>{" "}
              {autoLanguages.length ? languageList(i18n, autoLanguages, Infinity) : t("settings.auto.noActiveLanguages")}
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge>{t("common.state.off")}</s-badge> {t("settings.auto.offBody")}
            </s-paragraph>
          )}
          {data.auto.enabled && data.auto.paused ? (
            <s-banner tone="warning" heading={t("settings.auto.paused.heading")}>
              <s-paragraph>
                {t(
                  `settings.auto.paused.${["DAILY_LIMIT", "PLATFORM_LIMIT", "QUOTA_EXCEEDED"].includes(data.auto.paused.reason) ? data.auto.paused.reason : "PROVIDER"}` as "settings.auto.paused.PROVIDER",
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
          {smartOn && !data.auto.enabled ? null : !data.auto.available || !data.auto.planIncludes ? (
            <s-stack direction="block" gap="small">
              {!data.auto.available ? (
                <s-banner tone="info" heading={t("settings.auto.unavailable.heading")}>
                  <s-paragraph>{t("settings.auto.unavailable.body")}</s-paragraph>
                </s-banner>
              ) : (
                <s-banner tone="info" heading={t("settings.auto.planHeading")}>
                  <s-paragraph>
                    <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                  </s-paragraph>
                </s-banner>
              )}
              {/* Still on from before (a downgrade, AI removed): it can always be turned off. */}
              {data.auto.enabled ? (
                <s-stack direction="inline">
                  <s-button type="button" onClick={() => autoFetcher.submit({ intent: "auto", enabled: "false" }, { method: "post" })}>
                    {t("settings.auto.turnOff")}
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          ) : data.style.languages.length === 0 ? (
            <s-stack direction="block" gap="small">
              <s-paragraph>{t("settings.auto.noLanguages")}</s-paragraph>
              {/* Every language removed in Shopify while it was on: it can still be turned off. */}
              {data.auto.enabled ? (
                <s-stack direction="inline">
                  <s-button type="button" onClick={() => autoFetcher.submit({ intent: "auto", enabled: "false" }, { method: "post" })}>
                    {t("settings.auto.turnOff")}
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          ) : (
            <autoFetcher.Form method="post">
              <input type="hidden" name="intent" value="auto" />
              <input type="hidden" name="enabled" value="true" />
              <s-stack direction="block" gap="small">
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
                  <s-paragraph>
                    {t("settings.auto.outsidePlan", { languages: languageList(i18n, outsidePlan, Infinity), count: outsidePlan.length })}{" "}
                    <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
                  </s-paragraph>
                ) : null}
                <s-stack direction="inline" gap="small">
                  <s-button type="submit" variant="secondary" {...(autoFetcher.state !== "idle" ? { loading: true } : {})}>
                    {data.auto.enabled ? t("settings.auto.saveLanguages") : t("settings.auto.turnOn")}
                  </s-button>
                  {data.auto.enabled ? (
                    <s-button
                      type="button"
                      onClick={() => autoFetcher.submit({ intent: "auto", enabled: "false" }, { method: "post" })}
                    >
                      {t("settings.auto.turnOff")}
                    </s-button>
                  ) : null}
                </s-stack>
              </s-stack>
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
        </s-stack>
      </s-section>

      {data.smart ? null : (
        <s-section heading={t("automatic.upsell.heading")}>
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="info">{t("automatic.business")}</s-badge>
            </s-stack>
            <s-paragraph>{t("automatic.upsell.body")}</s-paragraph>
            <s-stack direction="inline">
              <s-button href="/app/plan">{t("automatic.upsell.cta")}</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("common.nav.memory")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.memory.body")}</s-paragraph>
          <memoryFetcher.Form method="post">
            <input type="hidden" name="intent" value="reuse-memory" />
            <input type="hidden" name="enabled" value={data.reuseMachineMemory ? "false" : "true"} />
            <s-button type="submit">
              {data.reuseMachineMemory ? t("settings.memory.approvedOnly") : t("settings.memory.alsoMachine")}
            </s-button>
          </memoryFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading={t("settings.usage.heading", { month: month(data.period) })}>
        <s-stack direction="block" gap="base">
          <ProgressBar value={percent} label={t("settings.usage.progress")} tone={percent >= 100 ? "critical" : percent >= 80 ? "warning" : "success"} />
          <s-paragraph>
            {t("settings.usage.month", { used: number(data.used), limit: number(data.limit), percent })}
          </s-paragraph>
          <s-paragraph>
            {t("settings.usage.today", { used: number(data.usedToday), limit: number(data.dailyLimit) })}
          </s-paragraph>
          <s-paragraph>{t("settings.usage.notCounted")}</s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
