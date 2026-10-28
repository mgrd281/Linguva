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
import { getTranslationProvider } from "../.server/providers";
import {
  AI_STORE_CONTEXT_MAX,
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
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const [settings, locales, billing] = await Promise.all([
    getShopSettings(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
    shopBilling(admin, shop),
  ]);
  // The same allowance as the Overview, editor and Plan page (the plan's, when billing is on).
  const limits = aiLimitsFor(getConfig(), billing);
  return {
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
    if (enabled) {
      if (!hasCurrentAiConsent(await getShopSettings(shop.id))) return { ok: false, error: "CONSENT_REQUIRED" };
      if (!(await shopBilling(admin, shop)).entitlements.bulk) return { ok: false, error: "PLAN_BULK" };
    }
    const locales = await fetchAndSyncShopLocales(admin, shop.id);
    const result = await setAutoTranslate({
      shopId: shop.id,
      enabled,
      // s-choice-list submits its selected values as one comma-separated value.
      locales: form.getAll("locale").flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean),
      allowedLocales: locales.locales.filter((l) => !l.primary).map((l) => l.locale),
      actorId,
    });
    if (enabled && !result.enabled) return { ok: false, error: "NO_LANGUAGE" };
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
  const { t, date, month, number, language } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
  const styleFetcher = useFetcher<typeof action>();
  const autoFetcher = useFetcher<typeof action>();
  const autoError = autoFetcher.data && "error" in autoFetcher.data ? autoFetcher.data.error : null;
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
              {styleFetcher.data && "saved" in styleFetcher.data && styleFetcher.state === "idle" ? (
                <s-text tone="success">{t("settings.style.saved")}</s-text>
              ) : null}
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

      <s-section heading={t("settings.auto.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {data.publishMode === "AUTO_PUBLISH" ? t("settings.auto.bodyAutoPublish") : t("settings.auto.bodyReview")}
          </s-paragraph>
          {data.auto.enabled ? (
            <s-paragraph>
              <s-badge tone="success">{t("common.state.on")}</s-badge>{" "}
              {data.style.languages
                .filter((l) => data.auto.locales.includes(l.locale))
                .map((l) => language(l.locale, l.name))
                .join(", ")}
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge>{t("common.state.off")}</s-badge> {t("settings.auto.offBody")}
            </s-paragraph>
          )}
          {!data.auto.available ? (
            <s-banner tone="info" heading={t("settings.auto.unavailable.heading")}>
              <s-paragraph>{t("settings.auto.unavailable.body")}</s-paragraph>
            </s-banner>
          ) : !data.auto.planIncludes ? (
            <s-banner tone="info" heading={t("settings.auto.planHeading")}>
              <s-paragraph>
                <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
              </s-paragraph>
            </s-banner>
          ) : data.style.languages.length === 0 ? (
            <s-paragraph>{t("settings.auto.noLanguages")}</s-paragraph>
          ) : (
            <autoFetcher.Form method="post">
              <input type="hidden" name="intent" value="auto" />
              <input type="hidden" name="enabled" value="true" />
              <s-stack direction="block" gap="small">
                <s-choice-list name="locale" label={t("settings.auto.languages")} multiple>
                  {data.style.languages.map((l) => (
                    <s-choice key={l.locale} value={l.locale} defaultSelected={data.auto.locales.includes(l.locale)}>
                      {language(l.locale, l.name)}
                    </s-choice>
                  ))}
                </s-choice-list>
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
          ) : autoError === "PLAN_BULK" ? (
            <s-banner tone="info" heading={t("settings.auto.planHeading")}>
              <s-paragraph>
                <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
              </s-paragraph>
            </s-banner>
          ) : autoFetcher.data && "autoEnabled" in autoFetcher.data ? (
            <s-banner tone="success" heading={t("common.state.saved")}>
              <s-paragraph>
                {autoFetcher.data.autoEnabled ? t("settings.auto.savedOn") : t("settings.auto.savedOff")}
              </s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

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
