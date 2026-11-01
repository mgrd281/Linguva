/**
 * "Images and custom fields" section of the translation editor: image alt
 * text and translatable metafields of the edited resource. The server
 * decides which images and metafields belong to the resource; field names
 * here only label the values.
 */
import { useFetcher } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";
import { isStructuredValueType } from "../lib/structured-preview";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { fieldName as fieldLabel, hasMessage, issueName } from "../i18n/labels";
import { useResultToast } from "./app-bridge";
import { StructuredEditor, StructuredView } from "./StructuredValue";

type EditorData = Awaited<ReturnType<typeof loadEditorData>>;
type EditorAction = () => ReturnType<typeof runEditorAction>;

// Mirrors attachedFieldName / attachedRef on the server.
const fieldName = (part: string, id: string, key: string) => `${part}:${id}:${key}`;
const refOf = (id: string, key: string) => `${id}:${key}`;

export function AttachedResourcesPanel({
  data,
  errorMessage,
}: {
  data: EditorData;
  /** Text for an AI error code, in the interface language (an own key's stop names its engine). */
  errorMessage: (code: string, engine?: string | null) => string;
}) {
  const i18n = useI18n();
  const sourceName = i18n.language(data.sourceLocale, data.sourceName);
  const targetName = i18n.language(data.target.locale, data.target.name);
  const { t } = i18n;
  const aiFetcher = useFetcher<EditorAction>();
  const saveFetcher = useFetcher<EditorAction>();
  const attached = data.attached;
  const ai = aiFetcher.data?.kind === "attached-ai" ? aiFetcher.data : null;
  const aiError = aiFetcher.data?.kind === "error" ? aiFetcher.data : null;
  const saved = saveFetcher.data?.kind === "attached-saved" ? saveFetcher.data.outcomes : null;
  const saveStatus = new Map(saved?.map((o) => [o.ref, o]) ?? []);
  // Success is confirmed with a toast; problems stay on the page.
  useResultToast(
    saveFetcher.data,
    saved && saved.every((o) => o.status === "saved")
      ? saved.length
        ? t("editor.saved.toast", { count: saved.length })
        : t("editor.saved.nothingHeading")
      : null,
  );
  const canAi = data.ai.available && data.ai.consent;
  // Images are named by the app; metafields by their definition (merchant data).
  const itemLabel = (item: { kind: string; label: string }) => (item.kind === "IMAGE" ? t("editor.attached.image") : item.label);
  const hasMachine = attached.items.some((i) => i.fields.some((f) => f.machine && (!f.translation || f.outdated)));

  if (!attached.available) {
    return (
      <s-section heading={t("editor.attached.heading")}>
        <s-paragraph>{t("editor.attached.unavailable")}</s-paragraph>
      </s-section>
    );
  }
  if (!attached.items.length && !attached.imagesWithoutAlt && !attached.unsupported) return null;

  return (
    <s-section heading={t("editor.attached.heading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("editor.attached.intro")}</s-paragraph>
        {attached.imagesWithoutAlt ? (
          <s-banner tone="info" heading={t("editor.attached.noAlt", { count: attached.imagesWithoutAlt })}>
            <s-paragraph>{t("editor.attached.noAltBody")}</s-paragraph>
          </s-banner>
        ) : null}
        {attached.unsupported ? (
          <s-paragraph>{t("editor.attached.unsupported", { count: attached.unsupported })}</s-paragraph>
        ) : null}
        {aiError || ai?.stopped ? (
          <s-banner tone="critical" heading={t("editor.aiError.heading")}>
            <s-paragraph>
              {errorMessage(aiError?.code ?? ai?.stopped ?? "", (aiError && "engine" in aiError && typeof aiError.engine === "string" ? aiError.engine : null) ?? ai?.engine ?? null)}
              {ai?.stopped && Object.keys(ai.drafts).length ? ` ${t("editor.attached.stoppedDrafts")}` : ""}
            </s-paragraph>
          </s-banner>
        ) : null}
        {saved && !saved.every((o) => o.status === "saved") ? (
          <s-banner tone="warning" heading={t("editor.saved.partialHeading")}>
            <s-paragraph>
              {t("editor.attached.savedCount", { saved: saved.filter((o) => o.status === "saved").length, total: saved.length })}
            </s-paragraph>
          </s-banner>
        ) : null}
        {hasMachine ? (
          <aiFetcher.Form method="post">
            <input type="hidden" name="intent" value="ai-translate-attached" />
            <s-button type="submit" disabled={!canAi} {...(aiFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("editor.attached.translateAi")}
            </s-button>
          </aiFetcher.Form>
        ) : null}

        <saveFetcher.Form method="post">
          <input type="hidden" name="intent" value="save-attached" />
          {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
          {/* Each draft's own engine: items can be translated by different engines. */}
          {ai ? Object.keys(ai.drafts).map((ref) => <input key={ref} type="hidden" name={`provider:${ref}`} value={ai.providers?.[ref] ?? ai.provider} />) : null}
          <s-stack direction="block" gap="base">
            {attached.items.map((item) => (
              <s-box key={item.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    {item.previewUrl ? (
                      <s-thumbnail src={`${item.previewUrl}${item.previewUrl.includes("?") ? "&" : "?"}width=96`} alt="" size="small" />
                    ) : null}
                    <s-text type="strong">{item.kind === "IMAGE" ? fieldLabel(i18n, "alt") : item.label}</s-text>
                    {item.valueType ? <s-badge>{valueTypeLabel(i18n, item.valueType)}</s-badge> : null}
                    {item.detail ? <s-text color="subdued">{item.detail}</s-text> : null}
                  </s-stack>
                  {item.fields.map((field) => {
                    const ref = refOf(item.id, field.key);
                    const draft = ai?.drafts[ref];
                    const status = saveStatus.get(ref);
                    const rejected = ai?.rejected[ref];
                    const warnings = ai?.warnings[ref];
                    const error =
                      status?.status === "conflict"
                        ? status.code === "TRANSLATION_CHANGED"
                          ? t("editor.field.translationChanged")
                          : t("editor.field.conflict")
                        : status?.status === "error"
                          ? saveErrorText(i18n, status)
                          : rejected
                            ? t("editor.field.discarded")
                            : undefined;
                    const multiline = field.type === "MULTI_LINE_TEXT_FIELD" || field.type === "HTML" || field.source.length > 120;
                    // (key goes on the element itself, not through a spread.)
                    const fieldProps = {
                      name: fieldName("value", item.id, field.key),
                      label: targetName,
                      value: draft ?? field.translation,
                      ...(error ? { error } : {}),
                    };
                    const fieldKey = `${ref}:${draft ?? "base"}`;
                    // Rich text, lists and links: shown readably, lists and links edited item by item.
                    const structured = isStructuredValueType(field.type);
                    return (
                      <s-stack key={ref} direction="block" gap="small">
                        <input type="hidden" name={fieldName("digest", item.id, field.key)} value={field.digest} />
                        <input type="hidden" name={fieldName("current", item.id, field.key)} value={field.currentDigest} />
                        {draft !== undefined ? <input type="hidden" name={fieldName("origin", item.id, field.key)} value="AI" /> : null}
                        <s-query-container>
                          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
                            <s-stack direction="block" gap="small">
                              <s-text color="subdued">{t("editor.field.original", { language: sourceName })}</s-text>
                              {structured ? (
                                <StructuredView
                                  type={field.type}
                                  value={field.source}
                                  title={t("editor.field.originalFrame", { field: itemLabel(item), language: sourceName })}
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
                                  key={fieldKey}
                                  type={field.type}
                                  source={field.source}
                                  value={draft ?? field.translation}
                                  name={fieldProps.name}
                                  language={targetName}
                                  title={t("editor.field.previewFrame", { field: itemLabel(item), language: targetName })}
                                  locale={data.target.locale}
                                  rtl={data.target.rtl}
                                  {...(error ? { error } : {})}
                                />
                              ) : (
                                <div lang={data.target.locale} {...(data.target.rtl ? { dir: "rtl" } : {})}>
                                  {multiline ? <s-text-area key={fieldKey} {...fieldProps} rows={3} /> : <s-text-field key={fieldKey} {...fieldProps} />}
                                </div>
                              )}
                              {field.outdated && draft === undefined && field.translation ? (
                                <s-checkbox
                                  name={fieldName("confirm", item.id, field.key)}
                                  label={t("editor.field.stillCorrect")}
                                />
                              ) : null}
                              <s-stack direction="inline" gap="small">
                                {field.outdated && draft === undefined ? (
                                  <s-badge tone="warning">{t("common.translationStatus.outdated")}</s-badge>
                                ) : null}
                                {draft !== undefined ? <s-badge tone="info">{t("editor.badge.aiDraft")}</s-badge> : null}
                                {warnings?.length ? (
                                  <s-badge tone="warning">
                                    {t("editor.badge.review", { issues: warnings.map((code) => issueName(i18n, code)).join(", ") })}
                                  </s-badge>
                                ) : null}
                                {status?.status === "saved" ? <s-badge tone="success">{t("common.state.published")}</s-badge> : null}
                                {!field.machine ? <s-badge>{t("editor.badge.manualOnly")}</s-badge> : null}
                              </s-stack>
                            </s-stack>
                          </s-grid>
                        </s-query-container>
                      </s-stack>
                    );
                  })}
                </s-stack>
              </s-box>
            ))}
            {attached.items.length ? (
              <s-button type="submit" variant="primary" {...(saveFetcher.state !== "idle" ? { loading: true } : {})}>
                {t("editor.attached.publish")}
              </s-button>
            ) : null}
          </s-stack>
        </saveFetcher.Form>
      </s-stack>
    </s-section>
  );
}

/** Readable metafield type: "multi_line_text_field" → "Long text". Unknown types stay technical. */
function valueTypeLabel(i18n: I18n, type: string) {
  if (type === "json") return "JSON";
  const key = `editor.valueType.${type}`;
  return hasMessage(key) ? i18n.t(key) : type.replace(/^list\./, "list of ").replace(/_/g, " ");
}

/** Why a value wasn't saved: a known code in the interface language, else the server's message. */
function saveErrorText(i18n: I18n, outcome: { message?: string; code?: string }) {
  const key = `editor.saveError.${outcome.code ?? ""}`;
  if (outcome.code && hasMessage(key)) return i18n.t(key, { detail: outcome.message ?? "" });
  return outcome.message ?? i18n.t("editor.field.notSaved");
}
