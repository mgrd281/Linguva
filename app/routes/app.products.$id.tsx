import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getConfig } from "../.server/lib/config";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { getTranslationProvider } from "../.server/providers";
import { TranslationProviderError } from "../.server/providers/types";
import {
  getShopSettings,
  hasCurrentAiConsent,
  setAiConsent,
} from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import {
  getTranslatableResource,
  productGid,
} from "../.server/shopify/translations-api";
import {
  AiConsentRequiredError,
  aiTranslateResource,
  ResourceNotFoundError,
  saveResourceTranslations,
  type TranslationEdit,
} from "../.server/translation/product-translation-service";
import { isMachineTranslatable, segmentField } from "../.server/translation/translate-fields";
import { listRevisions } from "../.server/translation/revisions";
import { restoreRevision } from "../.server/translation/history";
import { fuzzyMatches } from "../.server/memory/translation-memory";
import { resolveGlossary } from "../.server/glossary/glossary";
import { sourceLocaleOf } from "../.server/translation/product-translation-service";
import { getMonthlyUsage, QuotaExceededError } from "../.server/usage/usage-ledger";
import { fieldLabel } from "../lib/field-labels";

async function resolveContext(request: Request, id: string | undefined) {
  const context = await requireShop(request);
  const resourceId = productGid(id ?? "");
  if (!resourceId) throw new Response("Not found", { status: 404 });

  const locales = await fetchAndSyncShopLocales(context.admin, context.shop.id);
  const requested = new URL(request.url).searchParams.get("locale");
  const target = locales.locales.find((l) => !l.primary && l.locale === requested);
  if (!target) throw new Response("Unknown language", { status: 404 });

  return { ...context, resourceId, target, primary: locales.primary };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, resourceId, target, primary } = await resolveContext(request, params.id);
  const resource = await getTranslatableResource(admin, resourceId, target.locale);
  if (!resource) throw new Response("Not found", { status: 404 });

  const config = getConfig();
  const settings = await getShopSettings(shop.id);
  const translations = new Map(resource.translations.map((t) => [t.key, t]));
  const digests = new Map(resource.content.map((c) => [c.key, c.digest]));
  const revisions = await listRevisions(shop.id, resourceId, target.locale);
  const history: Record<string, Array<{ id: string; value: string; origin: string; approved: boolean; createdAt: string; restorable: boolean }>> = {};
  for (const r of revisions) {
    const list = (history[r.key] ??= []);
    if (list.length >= 10) continue;
    list.push({
      id: r.id,
      value: r.value,
      origin: r.origin,
      approved: r.approved,
      createdAt: r.createdAt.toISOString(),
      // Shopify only accepts translations of the current source text.
      restorable: r.sourceDigest === digests.get(r.key) && r.value !== (translations.get(r.key)?.value ?? ""),
    });
  }

  return {
    productId: params.id!,
    title: resource.content.find((c) => c.key === "title")?.value ?? "(untitled)",
    target: { locale: target.locale, name: target.name, rtl: target.rtl },
    sourceName: primary?.name ?? resource.content[0]?.locale ?? "",
    fields: resource.content
      .filter((c) => c.value && c.value.trim() && c.digest)
      .map((c) => ({
        key: c.key,
        label: fieldLabel(c.key),
        type: c.type,
        source: c.value!,
        digest: c.digest!,
        translation: translations.get(c.key)?.value ?? "",
        outdated: translations.get(c.key)?.outdated ?? false,
        machine: isMachineTranslatable({ key: c.key, value: c.value, type: c.type }),
        history: history[c.key] ?? [],
      })),
    ai: {
      available: getTranslationProvider() !== null,
      consent: hasCurrentAiConsent(settings),
      used: await getMonthlyUsage(shop.id),
      limit: config.AI_MONTHLY_CHAR_LIMIT,
    },
  };
};

type ActionResult =
  | {
      kind: "ai";
      drafts: Record<string, string>;
      rejected: Record<string, string>;
      warnings: Record<string, string[]>;
      provider: string;
      memoryHits?: number;
      scores?: Record<string, number>;
    }
  | { kind: "restored"; status: string }
  | { kind: "saved"; outcomes: Array<{ key: string; status: string; message?: string }> }
  | { kind: "consent" }
  | { kind: "error"; code: string };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, session, resourceId, target } = await resolveContext(request, params.id);
  const form = await request.formData();
  const intent = form.get("intent");
  const actorId = session.onlineAccessInfo?.associated_user?.id?.toString() ?? null;

  if (intent === "grant-consent") {
    await setAiConsent({ shopId: shop.id, granted: true, actorId });
    return { kind: "consent" } satisfies ActionResult;
  }

  if (intent === "ai-translate") {
    const provider = getTranslationProvider();
    if (!provider) return { kind: "error", code: "AI_NOT_CONFIGURED" } satisfies ActionResult;
    const keys = form.getAll("key").map(String);
    try {
      const result = await aiTranslateResource({
        admin,
        shopId: shop.id,
        resourceId,
        targetLocale: target.locale,
        keys,
        provider,
        monthlyLimit: getConfig().AI_MONTHLY_CHAR_LIMIT,
      });
      const drafts: Record<string, string> = {};
      const rejected: Record<string, string> = {};
      const warnings: Record<string, string[]> = {};
      for (const o of result.outcomes) {
        if (o.status === "translated") {
          drafts[o.key] = o.value;
          if (o.issues.length) warnings[o.key] = o.issues.map((i) => i.code);
        } else if (o.status === "rejected") {
          rejected[o.key] = o.reason;
        }
      }
      return {
        kind: "ai",
        drafts,
        rejected,
        warnings,
        provider: result.provider,
        memoryHits: result.memoryHits,
      } satisfies ActionResult;
    } catch (error) {
      if (error instanceof AiConsentRequiredError) return { kind: "error", code: "CONSENT_REQUIRED" } satisfies ActionResult;
      if (error instanceof QuotaExceededError) return { kind: "error", code: "QUOTA_EXCEEDED" } satisfies ActionResult;
      if (error instanceof ResourceNotFoundError) throw new Response("Not found", { status: 404 });
      if (error instanceof TranslationProviderError) {
        return { kind: "error", code: `PROVIDER_${error.kind.toUpperCase()}` } satisfies ActionResult;
      }
      throw error;
    }
  }

  if (intent === "memory-suggest") {
    // Fuzzy matches are suggestions: they fill the form, never publish.
    const resource = await getTranslatableResource(admin, resourceId, target.locale);
    if (!resource) throw new Response("Not found", { status: 404 });
    const glossary = await resolveGlossary(shop.id, target.locale);
    const drafts: Record<string, string> = {};
    const scores: Record<string, number> = {};
    for (const field of resource.content) {
      if (!field.value || !isMachineTranslatable(field)) continue;
      const doc = segmentField(field, glossary.protect);
      if (doc.segments.length !== 1) continue;
      const [best] = await fuzzyMatches(
        { shopId: shop.id, sourceLocale: sourceLocaleOf(resource), targetLocale: target.locale },
        doc.segments[0]!.source,
        { threshold: 0.6, limit: 1 },
      );
      if (!best) continue;
      try {
        drafts[field.key] = doc.render(new Map([[doc.segments[0]!.id, best.targetText]]));
        scores[field.key] = Math.round(best.score * 100);
      } catch {
        // The suggestion's formatting doesn't fit this source; skip it.
      }
    }
    const none: Record<string, never> = {};
    return { kind: "ai", drafts, rejected: none, warnings: none, provider: "memory", scores } satisfies ActionResult;
  }

  if (intent === "restore") {
    const result = await restoreRevision({
      admin,
      shopId: shop.id,
      actorId,
      revisionId: String(form.get("revisionId") ?? ""),
    });
    return { kind: "restored", status: result.status } satisfies ActionResult;
  }

  if (intent === "save") {
    const resource = await getTranslatableResource(admin, resourceId, target.locale);
    if (!resource) throw new Response("Not found", { status: 404 });
    const existing = new Map(resource.translations.map((t) => [t.key, t]));
    const edits: TranslationEdit[] = [];
    for (const field of resource.content) {
      const value = form.get(`value:${field.key}`);
      const digest = form.get(`digest:${field.key}`);
      if (typeof value !== "string" || typeof digest !== "string") continue;
      const current = existing.get(field.key);
      // Skip untouched fields: same value and still current, or still empty.
      if ((current?.value ?? "") === value && !current?.outdated) continue;
      if (!value.trim() && !current?.value) continue;
      edits.push({
        key: field.key,
        value,
        digest,
        origin: form.get(`origin:${field.key}`) === "AI" ? "AI" : "MANUAL",
        provider: String(form.get("provider") ?? "") || null,
        // Publishing from the editor means the merchant reviewed it.
        approved: true,
      });
    }
    const outcomes = await saveResourceTranslations({
      admin,
      shopId: shop.id,
      actorId,
      resourceId,
      locale: target.locale,
      edits,
    });
    return data({ kind: "saved", outcomes } satisfies ActionResult);
  }

  return data({ kind: "error", code: "UNKNOWN_INTENT" } satisfies ActionResult, { status: 400 });
};

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI translation isn't configured for this app yet.",
  CONSENT_REQUIRED: "Allow AI processing below before translating with AI.",
  QUOTA_EXCEEDED: "This month's AI translation allowance is used up.",
  PROVIDER_RETRYABLE: "The translation service is busy. Please try again in a moment.",
  PROVIDER_QUOTA: "The translation service quota is exhausted. Please contact support.",
  PROVIDER_AUTH: "The translation service rejected our credentials. Please contact support.",
  PROVIDER_INVALID: "The translation service doesn't support this language pair.",
};

const REJECTION_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "The AI result changed numbers or used forbidden wording, so it was discarded.",
  MISSING_CODE: "The AI result lost part of the formatting, so it was discarded.",
};

export default function ProductTranslation() {
  const data = useLoaderData<typeof loader>();
  const aiFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();
  const consentFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
  const restoreFetcher = useFetcher<typeof action>();
  const [filledFrom, setFilledFrom] = useState<"ai" | "memory">("ai");

  // The latest of AI translation or memory suggestions fills the form.
  const aiResult = aiFetcher.data?.kind === "ai" ? aiFetcher.data : null;
  const memoryResult = memoryFetcher.data?.kind === "ai" ? memoryFetcher.data : null;
  const ai = filledFrom === "memory" ? memoryResult : aiResult;
  const restored = restoreFetcher.data?.kind === "restored" ? restoreFetcher.data.status : null;
  const aiError = aiFetcher.data?.kind === "error" ? aiFetcher.data.code : null;
  const saved = saveFetcher.data?.kind === "saved" ? saveFetcher.data.outcomes : null;
  const saveStatus = new Map(saved?.map((o) => [o.key, o]) ?? []);
  const translating = aiFetcher.state !== "idle";
  const saving = saveFetcher.state !== "idle";
  const machineKeys = data.fields.filter((f) => f.machine).map((f) => f.key);
  const remaining = Math.max(0, data.ai.limit - data.ai.used);

  return (
    <s-page heading={data.title}>
      <s-link slot="breadcrumb-actions" href={`/app/products?locale=${encodeURIComponent(data.target.locale)}`}>
        Products
      </s-link>

      {data.ai.available && !data.ai.consent ? (
        <s-banner tone="info" heading="Allow AI translation">
          <s-paragraph>
            To translate with AI, the product text you choose is sent to our
            translation provider (DeepL SE, Germany) for processing. No
            customer data is sent. You can review every result before it is
            published.
          </s-paragraph>
          <consentFetcher.Form method="post">
            <input type="hidden" name="intent" value="grant-consent" />
            <s-button type="submit" {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
              Allow AI processing
            </s-button>
          </consentFetcher.Form>
        </s-banner>
      ) : null}

      {restored ? (
        <s-banner tone={restored === "restored" ? "success" : "warning"} heading={restored === "restored" ? "Version restored" : "Couldn't restore this version"}>
          <s-paragraph>
            {restored === "restored"
              ? "The earlier translation is published again. Reload to see it in the field."
              : restored === "source_changed"
                ? "The source text has changed since that version, so Shopify won't accept it."
                : "Please reload the page and try again."}
          </s-paragraph>
        </s-banner>
      ) : null}

      {aiError ? (
        <s-banner tone="critical" heading="AI translation failed">
          <s-paragraph>{ERROR_MESSAGES[aiError] ?? "Something went wrong."}</s-paragraph>
        </s-banner>
      ) : null}

      {saved ? (
        saved.every((o) => o.status === "saved") ? (
          <s-banner tone="success" heading={saved.length ? "Translations published" : "Nothing to save"}>
            <s-paragraph>
              {saved.length
                ? `${saved.length} field${saved.length === 1 ? "" : "s"} saved to Shopify and verified.`
                : "No fields were changed."}
            </s-paragraph>
          </s-banner>
        ) : (
          <s-banner tone="warning" heading="Some fields weren't saved">
            <s-paragraph>
              Fields marked below need attention. If the source text changed
              in Shopify, reload this page and translate again.
            </s-paragraph>
          </s-banner>
        )
      ) : null}

      {data.target.rtl ? (
        <s-banner tone="info" heading="Right-to-left language">
          <s-paragraph>Check the storefront layout after publishing.</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={`${data.sourceName} → ${data.target.name}`}>
        <s-stack direction="inline" gap="base" alignItems="center">
          <aiFetcher.Form method="post" onSubmit={() => setFilledFrom("ai")}>
            <input type="hidden" name="intent" value="ai-translate" />
            {machineKeys.map((k) => (
              <input key={k} type="hidden" name="key" value={k} />
            ))}
            <s-button
              type="submit"
              variant="primary"
              disabled={!data.ai.available || !data.ai.consent || machineKeys.length === 0}
              {...(translating ? { loading: true } : {})}
            >
              Translate with AI
            </s-button>
          </aiFetcher.Form>
          <memoryFetcher.Form method="post" onSubmit={() => setFilledFrom("memory")}>
            <input type="hidden" name="intent" value="memory-suggest" />
            <s-button type="submit" {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}>
              Fill from memory
            </s-button>
          </memoryFetcher.Form>
          <s-text color="subdued">
            {data.ai.available
              ? `${remaining.toLocaleString()} of ${data.ai.limit.toLocaleString()} AI characters left this month`
              : "AI translation isn't configured"}
          </s-text>
        </s-stack>
        {ai ? (
          <s-paragraph>
            {ai.provider === "memory"
              ? Object.keys(ai.drafts).length
                ? "Similar translations from your memory are filled in below. Check them carefully, then publish."
                : "No similar translations found in your memory."
              : `AI drafts are filled in below${ai.memoryHits ? ` (${ai.memoryHits} segment${ai.memoryHits === 1 ? "" : "s"} reused from memory at no cost)` : ""}. Review them, then publish.`}
          </s-paragraph>
        ) : null}
      </s-section>

      <saveFetcher.Form method="post">
        <input type="hidden" name="intent" value="save" />
        {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
        {data.fields.map((field) => {
          const draft = ai?.drafts[field.key];
          const value = draft ?? field.translation;
          const status = saveStatus.get(field.key);
          const rejected = ai?.rejected[field.key];
          const warnings = ai?.warnings[field.key];
          const multiline = field.type === "HTML" || field.type === "MULTI_LINE_TEXT_FIELD" || field.source.length > 120;
          const error =
            status?.status === "conflict"
              ? "The source text changed in Shopify. Reload and translate again."
              : status?.status === "error"
                ? status.message ?? "Not saved."
                : rejected
                  ? REJECTION_MESSAGES[rejected] ?? "The AI result was discarded."
                  : undefined;

          return (
            <s-section key={field.key} heading={field.label}>
              <input type="hidden" name={`digest:${field.key}`} value={field.digest} />
              {draft !== undefined ? <input type="hidden" name={`origin:${field.key}`} value="AI" /> : null}
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-text color="subdued">{data.sourceName}</s-text>
                  <s-paragraph>{field.source}</s-paragraph>
                </s-box>
                {multiline ? (
                  <s-text-area
                    key={`${field.key}:${draft ?? "base"}`}
                    name={`value:${field.key}`}
                    label={data.target.name}
                    value={value}
                    rows={field.type === "HTML" ? 8 : 3}
                    {...(error ? { error } : {})}
                    {...(field.type === "HTML" ? { details: "HTML. Formatting must match the source." } : {})}
                  />
                ) : (
                  <s-text-field
                    key={`${field.key}:${draft ?? "base"}`}
                    name={`value:${field.key}`}
                    label={data.target.name}
                    value={value}
                    {...(error ? { error } : {})}
                    {...(field.key === "handle" ? { details: "Changing a URL handle changes the page address for this language." } : {})}
                  />
                )}
                <s-stack direction="inline" gap="small">
                  {field.outdated && draft === undefined ? <s-badge tone="warning">Outdated</s-badge> : null}
                  {draft !== undefined ? (
                    <s-badge tone="info">
                      {ai?.provider === "memory" ? `Memory ${ai.scores?.[field.key] ?? ""}% match` : "AI draft"}
                    </s-badge>
                  ) : null}
                  {warnings?.length ? <s-badge tone="warning">Review: {warnings.join(", ")}</s-badge> : null}
                  {status?.status === "saved" ? <s-badge tone="success">Published</s-badge> : null}
                  {!field.machine ? <s-badge>Manual only</s-badge> : null}
                </s-stack>
                {field.history.length ? (
                  <details>
                    <summary>History ({field.history.length})</summary>
                    <s-stack direction="block" gap="small">
                      {field.history.map((h) => (
                        <s-box key={h.id} padding="small" borderWidth="base" borderRadius="base">
                          <s-text color="subdued">
                            {new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            {" · "}
                            {h.origin === "EXTERNAL" ? "Before Linguva" : h.origin === "AI" ? (h.approved ? "AI, approved" : "AI") : "Manual"}
                          </s-text>
                          <s-paragraph>{h.value.length > 300 ? `${h.value.slice(0, 300)}…` : h.value}</s-paragraph>
                          {h.restorable ? (
                            <s-button
                              variant="tertiary"
                              onClick={() =>
                                restoreFetcher.submit({ intent: "restore", revisionId: h.id }, { method: "post" })
                              }
                            >
                              Restore this version
                            </s-button>
                          ) : null}
                        </s-box>
                      ))}
                    </s-stack>
                  </details>
                ) : null}
              </s-stack>
            </s-section>
          );
        })}
        <s-stack direction="inline" gap="base">
          <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
            Publish translations
          </s-button>
        </s-stack>
      </saveFetcher.Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
