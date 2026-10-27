/**
 * Translation editor UI shared by the product and collection pages. The
 * route supplies the loader and action (see .server/translation/resource-editor).
 */
import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";

type EditorLoader = () => ReturnType<typeof loadEditorData>;
type EditorAction = () => ReturnType<typeof runEditorAction>;

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

export function ResourceTranslationEditor() {
  const data = useLoaderData<EditorLoader>();
  const aiFetcher = useFetcher<EditorAction>();
  const saveFetcher = useFetcher<EditorAction>();
  const consentFetcher = useFetcher<EditorAction>();
  const memoryFetcher = useFetcher<EditorAction>();
  const restoreFetcher = useFetcher<EditorAction>();
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
      <s-link slot="breadcrumb-actions" href={`${data.kind.path}?locale=${encodeURIComponent(data.target.locale)}`}>
        {data.kind.label}
      </s-link>

      {data.ai.available && !data.ai.consent ? (
        <s-banner tone="info" heading="Allow AI translation">
          <s-paragraph>
            To translate with AI, the {data.kind.singular} text you choose is sent to our
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
              ? "The earlier translation is published again."
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
                {field.outdated && draft === undefined && field.translation ? (
                  <s-checkbox
                    name={`confirm:${field.key}`}
                    label="The source changed, but this translation is still correct"
                  />
                ) : null}
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

