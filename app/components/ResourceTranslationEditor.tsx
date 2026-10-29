/**
 * Translation editor UI shared by the product and collection pages. The
 * route supplies the loader and action (see .server/translation/resource-editor).
 */
import { useEffect, useRef, useState } from "react";
import { Form, useBlocker, useFetcher, useLoaderData } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";

import { useResultToast, useSaveBar } from "./app-bridge";
import { AttachedResourcesPanel } from "./AttachedResourcesPanel";
import { HtmlPreview } from "./HtmlPreview";
import { StructuredEditor, StructuredView } from "./StructuredValue";
import { SeoCounter, SeoPreview } from "./SeoPanel";
import { isSeoKey } from "../lib/seo";
import { isStructuredValueType } from "../lib/structured-preview";
import { MAX_HANDLE_LENGTH, suggestHandle, validateHandle } from "../lib/handles";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { fieldName, hasMessage, issueName, kindLabel, kindSingular } from "../i18n/labels";

type EditorLoader = () => ReturnType<typeof loadEditorData>;
type EditorAction = () => ReturnType<typeof runEditorAction>;

/** Text for an AI or memory error code (editor.aiError.*). */
function aiErrorMessage(i18n: I18n, code: string) {
  const key = `editor.aiError.${code}`;
  return hasMessage(key) ? i18n.t(key) : i18n.t("editor.aiError.generic");
}

/** Text for why an AI result was discarded (editor.rejection.*). */
function rejectionMessage(i18n: I18n, reason: string) {
  const key = `editor.rejection.${reason}`;
  return hasMessage(key) ? i18n.t(key) : i18n.t("editor.field.discarded");
}

/** Text for a field that wasn't saved: a known code in the language, else the server's message. */
function saveErrorMessage(i18n: I18n, outcome: { message?: string; code?: string }) {
  const key = `editor.handle.problem.${outcome.code ?? ""}`;
  if (outcome.code && hasMessage(key)) return i18n.t(key, { max: MAX_HANDLE_LENGTH });
  const saveKey = `editor.saveError.${outcome.code ?? ""}`;
  if (outcome.code && hasMessage(saveKey)) return i18n.t(saveKey, { detail: outcome.message ?? "" });
  return outcome.message ?? i18n.t("editor.field.notSaved");
}

const EDITOR_SAVE_BAR = "linguva-editor-save-bar";

export function ResourceTranslationEditor() {
  const data = useLoaderData<EditorLoader>();
  const i18n = useI18n();
  const sourceName = i18n.language(data.sourceLocale, data.sourceName);
  const targetName = i18n.language(data.target.locale, data.target.name);
  const { t } = i18n;
  const singular = kindSingular(i18n, data.kind.type);
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
  // "Discard" in the save bar drops the drafts shown and what was typed.
  const [discarded, setDiscarded] = useState<unknown>(null);
  const [resetCount, setResetCount] = useState(0);
  const filled = filledFrom === "memory" ? memoryResult : aiResult;
  const ai = filled && filled !== discarded ? filled : null;
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
    // The Polaris button may not be ready to take focus in the first frame: retry briefly.
    let frame = 0;
    let tries = 0;
    const focusStay = () => {
      const stay = document.getElementById("editor-stay");
      stay?.focus();
      if (document.activeElement !== stay && tries++ < 30) frame = requestAnimationFrame(focusStay);
    };
    focusStay();
    return () => cancelAnimationFrame(frame);
  }, [blocker.state]);
  // The admin's save bar while there is something to publish (Publish / Discard).
  const saveFormRef = useRef<HTMLFormElement>(null);
  useSaveBar(EDITOR_SAVE_BAR, unpublished);
  const discard = () => {
    setDiscarded(filled);
    setTyped({ base: null, values: {} });
    setResetCount((n) => n + 1);
  };
  // Success is confirmed with a toast; problems stay on the page as banners.
  const savedAll = saveFetcher.data?.kind === "saved" && saveFetcher.data.outcomes.every((o) => o.status === "saved");
  useResultToast(
    saveFetcher.data,
    savedAll && saveFetcher.data?.kind === "saved"
      ? saveFetcher.data.outcomes.length
        ? t("editor.saved.toast", { count: saveFetcher.data.outcomes.length })
        : t("editor.saved.nothingHeading")
      : null,
  );
  useEffect(() => {
    if (!unpublished) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unpublished]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ lang: data.target.locale, page: String(page) });
    if (data.paging?.query) params.set("q", data.paging.query);
    return `?${params.toString()}`;
  };
  const remaining = Math.max(0, Math.min(data.ai.limit - data.ai.used, data.ai.dailyLimit - data.ai.usedToday));

  return (
    <s-page heading={data.title}>
      <s-link slot="breadcrumb-actions" href={`${data.kind.path}?lang=${encodeURIComponent(data.target.locale)}`}>
        {kindLabel(i18n, data.kind.type)}
      </s-link>

      {blocker.state === "blocked" ? (
        <s-banner tone="warning" heading={t("editor.leave.heading")}>
          <s-paragraph>{t("editor.leave.body")}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button id="editor-stay" variant="primary" onClick={() => blocker.reset()}>
              {t("editor.leave.stay")}
            </s-button>
            <s-button tone="critical" onClick={() => blocker.proceed()}>
              {t("editor.leave.leave")}
            </s-button>
          </s-stack>
        </s-banner>
      ) : null}

      {data.ai.available && !data.ai.consent ? (
        <s-banner tone="info" heading={t("editor.consent.heading")}>
          <s-paragraph>{t("editor.consent.body", { singular })}</s-paragraph>
          <consentFetcher.Form method="post">
            <input type="hidden" name="intent" value="grant-consent" />
            <s-button type="submit" {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("editor.consent.allow")}
            </s-button>
          </consentFetcher.Form>
        </s-banner>
      ) : null}

      {removed ? (
        <s-banner
          tone={removed.status === "removed" ? "success" : "warning"}
          heading={removed.status === "removed" ? t("editor.removed.heading") : t("editor.removed.failedHeading")}
        >
          <s-paragraph>
            {removed.status === "removed" ? t("editor.removed.body") : t("editor.reloadAndRetry")}
          </s-paragraph>
        </s-banner>
      ) : null}

      {restored ? (
        <s-banner
          tone={restored === "restored" ? "success" : "warning"}
          heading={restored === "restored" ? t("editor.restored.heading") : t("editor.restored.failedHeading")}
        >
          <s-paragraph>
            {restored === "restored"
              ? t("editor.restored.body")
              : restored === "source_changed"
                ? t("editor.restored.sourceChanged")
                : t("editor.reloadAndRetry")}
          </s-paragraph>
        </s-banner>
      ) : null}

      {actionError ? (
        <s-banner
          tone={actionError.code.startsWith("RATE_LIMITED") ? "warning" : "critical"}
          heading={filledFrom === "memory" ? t("editor.aiError.memoryHeading") : t("editor.aiError.heading")}
        >
          <s-paragraph>
            {aiErrorMessage(i18n, actionError.code)}
            {"retryAfterSeconds" in actionError && actionError.retryAfterSeconds
              ? ` ${t("editor.aiError.retryAfter", { seconds: Number(actionError.retryAfterSeconds) })}`
              : ""}
          </s-paragraph>
        </s-banner>
      ) : null}

      {saved && !saved.every((o) => o.status === "saved") ? (
        <s-banner tone="warning" heading={t("editor.saved.partialHeading")}>
          <s-paragraph>{t("editor.saved.partialBody")}</s-paragraph>
        </s-banner>
      ) : null}

      {data.caution === "legal" ? (
        <s-banner tone="warning" heading={t("editor.caution.legalHeading")}>
          <s-paragraph>{t("editor.caution.legalBody")}</s-paragraph>
        </s-banner>
      ) : null}
      {data.caution === "liquid" ? (
        <s-banner tone="warning" heading={t("editor.caution.liquidHeading")}>
          <s-paragraph>{t("editor.caution.liquidBody")}</s-paragraph>
        </s-banner>
      ) : null}

      {data.target.rtl ? (
        <s-banner tone="info" heading={t("editor.rtl.heading")}>
          <s-paragraph>{t("editor.rtl.body")}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={`${sourceName} → ${targetName}`}>
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
              {t("editor.toolbar.translateAi")}
            </s-button>
          </aiFetcher.Form>
          {seoMachineKeys.length ? (
            <aiFetcher.Form method="post" onSubmit={() => setFilledFrom("ai")}>
              <input type="hidden" name="intent" value="ai-translate" />
              {seoMachineKeys.map((k) => (
                <input key={k} type="hidden" name="key" value={k} />
              ))}
              <s-button type="submit" disabled={!data.ai.available || !data.ai.consent}>
                {t("editor.toolbar.translateSeo")}
              </s-button>
            </aiFetcher.Form>
          ) : null}
          <memoryFetcher.Form method="post" onSubmit={() => setFilledFrom("memory")}>
            <input type="hidden" name="intent" value="memory-suggest" />
            <s-button type="submit" {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("editor.toolbar.fillMemory")}
            </s-button>
          </memoryFetcher.Form>
          <s-text color="subdued">
            {data.ai.available
              ? remaining === Math.max(0, data.ai.limit - data.ai.used)
                ? t("editor.toolbar.leftThisMonth", { remaining, limit: data.ai.limit })
                : t("editor.toolbar.leftToday", {
                    remaining,
                    monthRemaining: Math.max(0, data.ai.limit - data.ai.used),
                    limit: data.ai.limit,
                  })
              : t("editor.toolbar.notConfigured")}
          </s-text>
        </s-stack>
        {ai ? (
          <s-paragraph>
            {ai.provider === "memory"
              ? Object.keys(ai.drafts).length
                ? t("editor.fill.memory")
                : t("editor.fill.memoryNone")
              : ai.memoryHits
                ? t("editor.fill.aiWithMemory", { count: ai.memoryHits })
                : t("editor.fill.ai")}
          </s-paragraph>
        ) : null}
      </s-section>

      {data.paging ? (
        <s-section heading={t("editor.paging.texts", { count: data.paging.total })}>
          <s-stack direction="block" gap="small">
            <Form method="get">
              <input type="hidden" name="lang" value={data.target.locale} />
              <s-stack direction="inline" gap="small" alignItems="end">
                <s-search-field
                  name="q"
                  label={t("editor.paging.findLabel")}
                  placeholder={t("editor.paging.findPlaceholder")}
                  value={data.paging.query}
                />
                <s-button type="submit">{t("common.action.search")}</s-button>
              </s-stack>
            </Form>
            <s-text color="subdued">
              {data.paging.matching === 0
                ? t("editor.paging.noMatch")
                : t(data.paging.query ? "editor.paging.showingMatching" : "editor.paging.showing", {
                    from: (data.paging.page - 1) * data.paging.pageSize + 1,
                    to: Math.min(data.paging.page * data.paging.pageSize, data.paging.matching),
                    total: data.paging.matching,
                  })}
            </s-text>
            <s-stack direction="inline" gap="small">
              {data.paging.page > 1 ? <s-button href={pageHref(data.paging.page - 1)}>{t("common.action.previous")}</s-button> : null}
              {data.paging.page < data.paging.pages ? <s-button href={pageHref(data.paging.page + 1)}>{t("common.action.next")}</s-button> : null}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <ui-save-bar id={EDITOR_SAVE_BAR}>
        <button variant="primary" onClick={() => saveFormRef.current?.requestSubmit()} {...(saving ? { loading: "" } : {})}>
          {t("editor.publish")}
        </button>
        <button onClick={discard}>{t("editor.discard")}</button>
      </ui-save-bar>

      <saveFetcher.Form ref={saveFormRef} method="post" onInput={onFormInput} onChange={onFormInput}>
        <input type="hidden" name="intent" value="save" />
        {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
        {data.fields.filter((f) => !data.seoPreview || !isSeoKey(f.key)).map((field) => renderField(field))}
        {data.seoPreview ? (
          <s-section heading={t("editor.seo.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("editor.seo.intro", { singular, language: targetName })}</s-paragraph>
              <SeoPreview
                value={currentValue}
                source={(k) => fieldByKey.get(k)?.source ?? ""}
                hasField={(k) => fieldByKey.has(k)}
                shopDomain={data.shopDomain}
                locale={data.target.locale}
                pathSegment={data.kind.plural}
              />
              {seoFields.length === 0 ? (
                <s-paragraph>{t("editor.seo.noFields", { singular })}</s-paragraph>
              ) : null}
            </s-stack>
          </s-section>
        ) : null}
        {data.seoPreview ? seoFields.map((field) => renderField(field)) : null}
        <s-stack direction="inline" gap="base">
          <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
            {t("editor.publish")}
          </s-button>
        </s-stack>
      </saveFetcher.Form>

      <AttachedResourcesPanel data={data} errorMessage={(code) => aiErrorMessage(i18n, code)} />
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
    // Rich text, lists and links (e.g. metaobject fields): shown readably, never as JSON.
    const structured = isStructuredValueType(field.type);
    const label = fieldName(i18n, field.key);
    const error =
      status?.status === "conflict"
        ? "reason" in status && status.reason === "TRANSLATION_CHANGED"
          ? t("editor.field.translationChanged")
          : t("editor.field.conflict")
        : status?.status === "error"
          ? saveErrorMessage(i18n, status)
          : rejected
            ? rejectionMessage(i18n, rejected)
            : undefined;

    return (
      <s-section key={field.key} heading={label}>
        <input type="hidden" name={`digest:${field.key}`} value={field.digest} />
        <input type="hidden" name={`current:${field.key}`} value={field.currentDigest} />
        {draft !== undefined ? <input type="hidden" name={`origin:${field.key}`} value="AI" /> : null}
        <s-stack direction="block" gap="base">
          {/* The field's state first, where the eye lands: one badge, plus notes. */}
          <s-stack direction="inline" gap="small" alignItems="center">
            {draft !== undefined ? (
              <s-badge tone="info">
                {ai?.provider === "memory" ? t("editor.badge.memoryMatch", { score: ai.scores?.[field.key] ?? "" }) : t("editor.badge.aiDraft")}
              </s-badge>
            ) : status?.status === "saved" ? (
              <s-badge tone="success">{t("common.state.published")}</s-badge>
            ) : field.outdated && field.translation ? (
              <s-badge tone="warning">{t("common.translationStatus.outdated")}</s-badge>
            ) : field.translation ? (
              <s-badge tone="success">{t("common.translationStatus.translated")}</s-badge>
            ) : (
              <s-badge>{t("common.translationStatus.missing")}</s-badge>
            )}
            {warnings?.length ? (
              <s-badge tone="warning">{t("editor.badge.review", { issues: warnings.map((code) => issueName(i18n, code)).join(", ") })}</s-badge>
            ) : null}
            {!field.machine ? <s-badge>{t("editor.badge.manualOnly")}</s-badge> : null}
          </s-stack>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                  <s-text color="subdued">{t("editor.field.original", { language: sourceName })}</s-text>
                  {field.sourcePreview !== null ? (
                    <s-button variant="tertiary" onClick={() => toggleCode(field.key)}>
                      {showCode ? t("editor.field.showPreview") : t("editor.field.showHtml")}
                    </s-button>
                  ) : null}
                </s-stack>
                {structured ? (
                  <StructuredView
                    type={field.type}
                    value={field.source}
                    title={t("editor.field.originalFrame", { field: label, language: sourceName })}
                    lang={data.sourceLocale}
                  />
                ) : field.sourcePreview !== null && !showCode ? (
                  <HtmlPreview
                    html={field.sourcePreview}
                    title={t("editor.field.originalFrame", { field: label, language: sourceName })}
                    lang={data.sourceLocale}
                  />
                ) : (
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>{field.source}</s-paragraph>
                  </s-box>
                )}
              </s-stack>
              <s-stack direction="block" gap="small">
                {structured ? (
                  <StructuredEditor
                    key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                    type={field.type}
                    source={field.source}
                    value={value}
                    name={`value:${field.key}`}
                    language={targetName}
                    title={t("editor.field.previewFrame", { field: label, language: targetName })}
                    locale={data.target.locale}
                    rtl={data.target.rtl}
                    {...(error ? { error } : {})}
                    onValue={(next) => setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), [field.key]: next } }))}
                  />
                ) : (
                <div lang={data.target.locale} {...textDirection(field)}>
                  {multiline ? (
                    <s-text-area
                      key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                      name={`value:${field.key}`}
                      label={targetName}
                      value={value}
                      rows={field.type === "HTML" ? 8 : 3}
                      {...(error ? { error } : {})}
                      {...(field.type === "HTML" ? { details: t("editor.field.htmlDetails") } : {})}
                    />
                  ) : (
                    <s-text-field
                      key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                      name={`value:${field.key}`}
                      label={targetName}
                      value={field.key === "handle" ? currentValue("handle") : value}
                      {...(error ? { error } : {})}
                      {...(field.key === "handle" ? { details: t("editor.field.handleDetails") } : {})}
                    />
                  )}
                </div>
                )}
                {field.sourcePreview !== null && !showCode ? (
                  <HtmlPreview
                    html={currentValue(field.key)}
                    title={t("editor.field.previewFrame", { field: label, language: targetName })}
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
                      {t("editor.handle.suggest")}
                    </s-button>
                    {currentValue("handle") && validateHandle(currentValue("handle")) ? (
                      <s-text tone="critical">
                        {t(`editor.handle.problem.${validateHandle(currentValue("handle"))!}`, { max: MAX_HANDLE_LENGTH })}
                      </s-text>
                    ) : null}
                    {field.translation && currentValue("handle") !== field.translation ? (
                      <s-checkbox
                        name="confirm-handle"
                        label={t("editor.handle.confirm", { handle: field.translation, language: targetName })}
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
                    label={t("editor.field.stillCorrect")}
                  />
                ) : null}
                <s-stack direction="inline" gap="small">
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
                      {confirmRemove === field.key ? t("editor.remove.confirm") : t("editor.remove.button")}
                    </s-button>
                  ) : null}
                </s-stack>
              </s-stack>
            </s-grid>
          </s-query-container>
          {field.history.length ? (
            <s-stack direction="block" gap="small">
              <s-button variant="tertiary" onClick={() => toggleHistory(field.key)}>
                {historyOpen.has(field.key)
                  ? t("editor.history.hide")
                  : t("editor.history.show", { count: field.history.length })}
              </s-button>
              {historyOpen.has(field.key) ? (
                <s-stack direction="block" gap="small">
                  {field.history.map((h) => (
                    <s-box key={h.id} padding="small" borderWidth="base" borderRadius="base">
                      <s-text color="subdued">
                        {i18n.dateTime(h.createdAt)}
                        {" · "}
                        {h.origin === "EXTERNAL"
                          ? t("editor.history.origin.external")
                          : h.origin === "AI"
                            ? h.approved
                              ? t("editor.history.origin.aiApproved")
                              : t("editor.history.origin.ai")
                            : t("editor.history.origin.manual")}
                      </s-text>
                      <s-paragraph>{h.value.length > 300 ? `${h.value.slice(0, 300)}…` : h.value}</s-paragraph>
                      {h.restorable ? (
                        <s-button
                          variant="tertiary"
                          onClick={() =>
                            restoreFetcher.submit({ intent: "restore", revisionId: h.id }, { method: "post" })
                          }
                        >
                          {t("editor.history.restore")}
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
