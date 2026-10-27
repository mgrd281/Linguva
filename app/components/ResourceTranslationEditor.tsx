/**
 * Translation editor UI shared by the product and collection pages. The
 * route supplies the loader and action (see .server/translation/resource-editor).
 */
import { useEffect, useState } from "react";
import { Form, useBlocker, useFetcher, useLoaderData } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";

import { AttachedResourcesPanel } from "./AttachedResourcesPanel";
import { HtmlPreview } from "./HtmlPreview";
import { SeoCounter, SeoPreview } from "./SeoPanel";
import { isSeoKey } from "../lib/seo";
import { HANDLE_PROBLEM_MESSAGES, suggestHandle, validateHandle } from "../lib/handles";
import { issueLabel } from "../lib/issue-labels";

type EditorLoader = () => ReturnType<typeof loadEditorData>;
type EditorAction = () => ReturnType<typeof runEditorAction>;

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI translation isn't configured for this app yet.",
  CONSENT_REQUIRED: "Allow AI processing below before translating with AI.",
  QUOTA_EXCEEDED: "This month's AI translation allowance is used up.",
  DAILY_LIMIT: "Today's AI translation allowance is used up. It resets at midnight UTC.",
  PLATFORM_LIMIT: "AI translation is paused for today because of high demand. Please try again tomorrow.",
  REQUEST_TOO_LARGE: "This is too much text for one request. Translate fewer fields at a time, or use bulk translation.",
  PLAN_LANGUAGE: "Your plan doesn't include AI translation into this language. Change your plan under Plan, or translate by hand.",
  RATE_LIMITED_USER: "You're translating very quickly. Please wait a moment and try again.",
  RATE_LIMITED_SHOP: "Your team is sending many AI requests right now. Please wait a moment and try again.",
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
  const removeFetcher = useFetcher<EditorAction>();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const removed = removeFetcher.data?.kind === "removed" ? removeFetcher.data : null;
  const [filledFrom, setFilledFrom] = useState<"ai" | "memory">("ai");
  // HTML fields show a rendered preview; the merchant can switch to the code.
  const [codeView, setCodeView] = useState<ReadonlySet<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleHistory = (key: string) =>
    setHistoryOpen((v) => {
      const next = new Set(v);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toggleCode = (key: string) =>
    setCodeView((v) => {
      const next = new Set(v);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // The latest of AI translation or memory suggestions fills the form.
  const aiResult = aiFetcher.data?.kind === "ai" ? aiFetcher.data : null;
  const memoryResult = memoryFetcher.data?.kind === "ai" ? memoryFetcher.data : null;
  const ai = filledFrom === "memory" ? memoryResult : aiResult;
  const restored = restoreFetcher.data?.kind === "restored" ? restoreFetcher.data.status : null;
  // Errors of the action that ran last (AI translation or memory suggestions).
  const lastData = filledFrom === "memory" ? memoryFetcher.data : aiFetcher.data;
  const actionError = lastData?.kind === "error" ? lastData : null;
  const saved = saveFetcher.data?.kind === "saved" ? saveFetcher.data.outcomes : null;
  const saveStatus = new Map(saved?.map((o) => [o.key, o]) ?? []);
  const translating = aiFetcher.state !== "idle";
  const saving = saveFetcher.state !== "idle";
  const machineKeys = data.fields.filter((f) => f.machine).map((f) => f.key);
  const seoMachineKeys = machineKeys.filter(isSeoKey);
  const seoFields = data.fields.filter((f) => isSeoKey(f.key));

  // What the merchant has typed, for live SEO checks and the preview. It
  // belongs to the drafts it was typed over, so new drafts start fresh.
  const [typedState, setTyped] = useState<{ base: unknown; values: Record<string, string> }>({ base: null, values: {} });
  const typed = typedState.base === ai ? typedState.values : {};
  const fieldByKey = new Map(data.fields.map((f) => [f.key, f]));
  const currentValue = (key: string) => typed[key] ?? ai?.drafts[key] ?? fieldByKey.get(key)?.translation ?? "";
  // Right-to-left languages are typed right to left. URL handles stay left to
  // right; HTML follows its first letter (usually a tag, so left to right).
  const textDirection = (field: { key: string; type: string }): { dir?: "rtl" | "auto" } =>
    !data.target.rtl || field.key === "handle" ? {} : { dir: field.type === "HTML" ? "auto" : "rtl" };
  const onFormInput = (event: { target: EventTarget | null }) => {
    const el = event.target as (Element & { value?: string }) | null;
    const name = el?.getAttribute?.("name");
    if (name?.startsWith("value:") && typeof el?.value === "string") {
      const key = name.slice("value:".length);
      setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), [key]: el.value! } }));
    }
  };
  // Typed text or AI drafts that differ from what is published would be lost
  // by leaving the page: ask first (in-app navigation and reloads).
  const unpublished =
    !saving &&
    [...new Set([...Object.keys(typed), ...Object.keys(ai?.drafts ?? {})])].some(
      (key) => currentValue(key) !== (fieldByKey.get(key)?.translation ?? ""),
    );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unpublished && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    window.scrollTo({ top: 0 });
    document.getElementById("editor-stay")?.focus();
  }, [blocker.state]);
  useEffect(() => {
    if (!unpublished) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unpublished]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ locale: data.target.locale, page: String(page) });
    if (data.paging?.query) params.set("q", data.paging.query);
    return `?${params.toString()}`;
  };
  const remaining = Math.max(0, Math.min(data.ai.limit - data.ai.used, data.ai.dailyLimit - data.ai.usedToday));

  return (
    <s-page heading={data.title}>
      <s-link slot="breadcrumb-actions" href={`${data.kind.path}?locale=${encodeURIComponent(data.target.locale)}`}>
        {data.kind.label}
      </s-link>

      {blocker.state === "blocked" ? (
        <s-banner tone="warning" heading="Leave without publishing?">
          <s-paragraph>Your changes to this translation aren&apos;t published yet. They will be lost if you leave.</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button id="editor-stay" variant="primary" onClick={() => blocker.reset()}>
              Stay on this page
            </s-button>
            <s-button tone="critical" onClick={() => blocker.proceed()}>
              Leave without publishing
            </s-button>
          </s-stack>
        </s-banner>
      ) : null}

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

      {removed ? (
        <s-banner tone={removed.status === "removed" ? "success" : "warning"} heading={removed.status === "removed" ? "Translation removed" : "Couldn't remove the translation"}>
          <s-paragraph>
            {removed.status === "removed"
              ? "Customers now see the original text for this field. The removed version is kept in the history."
              : "Please reload the page and try again."}
          </s-paragraph>
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

      {actionError ? (
        <s-banner
          tone={actionError.code.startsWith("RATE_LIMITED") ? "warning" : "critical"}
          heading={filledFrom === "memory" ? "Memory suggestions failed" : "AI translation failed"}
        >
          <s-paragraph>
            {ERROR_MESSAGES[actionError.code] ?? "Something went wrong."}
            {"retryAfterSeconds" in actionError && actionError.retryAfterSeconds
              ? ` Try again in ${actionError.retryAfterSeconds} s.`
              : ""}
          </s-paragraph>
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

      {data.caution === "legal" ? (
        <s-banner tone="warning" heading="Legal text">
          <s-paragraph>
            Policies are legal documents. Have every translation checked by someone qualified before you publish it.
            AI results are drafts and are never published on their own.
          </s-paragraph>
        </s-banner>
      ) : null}
      {data.caution === "liquid" ? (
        <s-banner tone="warning" heading="Template with Liquid code">
          <s-paragraph>
            Only the visible text is translated; Liquid tags and variables are kept exactly as in the original. Send
            yourself a test notification after publishing.
          </s-paragraph>
        </s-banner>
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
          {seoMachineKeys.length ? (
            <aiFetcher.Form method="post" onSubmit={() => setFilledFrom("ai")}>
              <input type="hidden" name="intent" value="ai-translate" />
              {seoMachineKeys.map((k) => (
                <input key={k} type="hidden" name="key" value={k} />
              ))}
              <s-button type="submit" disabled={!data.ai.available || !data.ai.consent}>
                Translate SEO fields only
              </s-button>
            </aiFetcher.Form>
          ) : null}
          <memoryFetcher.Form method="post" onSubmit={() => setFilledFrom("memory")}>
            <input type="hidden" name="intent" value="memory-suggest" />
            <s-button type="submit" {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}>
              Fill from memory
            </s-button>
          </memoryFetcher.Form>
          <s-text color="subdued">
            {data.ai.available
              ? remaining === Math.max(0, data.ai.limit - data.ai.used)
                ? `${remaining.toLocaleString("en-US")} of ${data.ai.limit.toLocaleString("en-US")} AI characters left this month`
                : `${remaining.toLocaleString("en-US")} AI characters left today (${Math.max(0, data.ai.limit - data.ai.used).toLocaleString("en-US")} of ${data.ai.limit.toLocaleString("en-US")} this month)`
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

      {data.paging ? (
        <s-section heading={`${data.paging.total.toLocaleString()} texts`}>
          <s-stack direction="block" gap="small">
            <Form method="get">
              <input type="hidden" name="locale" value={data.target.locale} />
              <s-stack direction="inline" gap="small" alignItems="end">
                <s-search-field name="q" label="Find a text" placeholder="Key, original or translation" value={data.paging.query} />
                <s-button type="submit">Search</s-button>
              </s-stack>
            </Form>
            <s-text color="subdued">
              {data.paging.matching === 0
                ? "No texts match your search."
                : `Showing ${((data.paging.page - 1) * data.paging.pageSize + 1).toLocaleString()}–${Math.min(data.paging.page * data.paging.pageSize, data.paging.matching).toLocaleString()} of ${data.paging.matching.toLocaleString()}${data.paging.query ? " matching" : ""}. Publish each page before moving on.`}
            </s-text>
            <s-stack direction="inline" gap="small">
              {data.paging.page > 1 ? <s-button href={pageHref(data.paging.page - 1)}>Previous</s-button> : null}
              {data.paging.page < data.paging.pages ? <s-button href={pageHref(data.paging.page + 1)}>Next</s-button> : null}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <saveFetcher.Form method="post" onInput={onFormInput} onChange={onFormInput}>
        <input type="hidden" name="intent" value="save" />
        {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
        {data.fields.filter((f) => !data.seoPreview || !isSeoKey(f.key)).map((field) => renderField(field))}
        {data.seoPreview ? (
          <s-section heading="Search engine listing">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                How this {data.kind.singular} may appear in search results in {data.target.name}.
              </s-paragraph>
              <SeoPreview
                value={currentValue}
                source={(k) => fieldByKey.get(k)?.source ?? ""}
                hasField={(k) => fieldByKey.has(k)}
                shopDomain={data.shopDomain}
                locale={data.target.locale}
                pathSegment={data.kind.plural}
              />
              {seoFields.length === 0 ? (
                <s-paragraph>
                  This {data.kind.singular} has no SEO title or description of its own. Add them in Shopify to
                  control search results per language.
                </s-paragraph>
              ) : null}
            </s-stack>
          </s-section>
        ) : null}
        {data.seoPreview ? seoFields.map((field) => renderField(field)) : null}
        <s-stack direction="inline" gap="base">
          <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
            Publish translations
          </s-button>
        </s-stack>
      </saveFetcher.Form>

      <AttachedResourcesPanel data={data} errorMessages={ERROR_MESSAGES} />
    </s-page>
  );

  function renderField(field: (typeof data.fields)[number]) {
    const draft = ai?.drafts[field.key];
    const value = draft ?? field.translation;
    const status = saveStatus.get(field.key);
    const rejected = ai?.rejected[field.key];
    const warnings = ai?.warnings[field.key];
    const showCode = codeView.has(field.key);
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
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                  <s-text color="subdued">{data.sourceName} (original)</s-text>
                  {field.sourcePreview !== null ? (
                    <s-button variant="tertiary" onClick={() => toggleCode(field.key)}>
                      {showCode ? "Show preview" : "Show HTML"}
                    </s-button>
                  ) : null}
                </s-stack>
                {field.sourcePreview !== null && !showCode ? (
                  <HtmlPreview html={field.sourcePreview} title={`${field.label}, ${data.sourceName} original`} lang={data.sourceLocale} />
                ) : (
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>{field.source}</s-paragraph>
                  </s-box>
                )}
              </s-stack>
              <s-stack direction="block" gap="small">
                <div lang={data.target.locale} {...textDirection(field)}>
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
                      value={field.key === "handle" ? currentValue("handle") : value}
                      {...(error ? { error } : {})}
                      {...(field.key === "handle" ? { details: "Changing a URL handle changes the page address for this language." } : {})}
                    />
                  )}
                </div>
                {field.sourcePreview !== null && !showCode ? (
                  <HtmlPreview
                    html={currentValue(field.key)}
                    title={`${field.label}, ${data.target.name} preview`}
                    lang={data.target.locale}
                    dir={data.target.rtl ? "rtl" : "auto"}
                  />
                ) : null}
                {field.key === "handle" ? (
                  <s-stack direction="block" gap="small">
                    <s-button
                      variant="tertiary"
                      onClick={() => {
                        const title = currentValue("title") || fieldByKey.get("title")?.source || "";
                        const suggestion = suggestHandle(title, data.target.locale);
                        if (suggestion) setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), handle: suggestion } }));
                      }}
                    >
                      Suggest from the translated title
                    </s-button>
                    {currentValue("handle") && validateHandle(currentValue("handle")) ? (
                      <s-text tone="critical">{HANDLE_PROBLEM_MESSAGES[validateHandle(currentValue("handle"))!]}</s-text>
                    ) : null}
                    {field.translation && currentValue("handle") !== field.translation ? (
                      <s-checkbox
                        name="confirm-handle"
                        label={`Change the published address. Links to …/${field.translation} in ${data.target.name} will stop working.`}
                      />
                    ) : null}
                  </s-stack>
                ) : null}
                {isSeoKey(field.key) ? (
                  <SeoCounter fieldKey={field.key} value={currentValue(field.key)} source={field.source} />
                ) : null}
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
                  {warnings?.length ? (
                      <s-badge tone="warning">Review: {warnings.map(issueLabel).join(", ")}</s-badge>
                    ) : null}
                  {status?.status === "saved" ? <s-badge tone="success">Published</s-badge> : null}
                  {field.translation && !(removed?.status === "removed" && removed.key === field.key) ? (
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => {
                        if (confirmRemove !== field.key) {
                          setConfirmRemove(field.key);
                          return;
                        }
                        setConfirmRemove(null);
                        removeFetcher.submit({ intent: "remove", key: field.key }, { method: "post" });
                      }}
                    >
                      {confirmRemove === field.key ? "Click again to remove the translation" : "Remove translation"}
                    </s-button>
                  ) : null}
                  {!field.machine ? <s-badge>Manual only</s-badge> : null}
                </s-stack>
              </s-stack>
            </s-grid>
          </s-query-container>
          {field.history.length ? (
            <s-stack direction="block" gap="small">
              <s-button variant="tertiary" onClick={() => toggleHistory(field.key)}>
                {historyOpen.has(field.key) ? "Hide history" : `Show history (${field.history.length})`}
              </s-button>
              {historyOpen.has(field.key) ? (
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
              ) : null}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>
    );
  }
}
