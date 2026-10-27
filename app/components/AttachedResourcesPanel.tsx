/**
 * "Images and custom fields" section of the translation editor: image alt
 * text and translatable metafields of the edited resource. The server
 * decides which images and metafields belong to the resource; field names
 * here only label the values.
 */
import { useFetcher } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";
import { issueLabel } from "../lib/issue-labels";
import { richTextPreviewOrNull } from "../lib/rich-text-preview";
import { HtmlPreview } from "./HtmlPreview";

type EditorData = Awaited<ReturnType<typeof loadEditorData>>;
type EditorAction = () => ReturnType<typeof runEditorAction>;

// Mirrors attachedFieldName / attachedRef on the server.
const fieldName = (part: string, id: string, key: string) => `${part}:${id}:${key}`;
const refOf = (id: string, key: string) => `${id}:${key}`;

export function AttachedResourcesPanel({
  data,
  errorMessages,
}: {
  data: EditorData;
  errorMessages: Record<string, string>;
}) {
  const aiFetcher = useFetcher<EditorAction>();
  const saveFetcher = useFetcher<EditorAction>();
  const attached = data.attached;
  const ai = aiFetcher.data?.kind === "attached-ai" ? aiFetcher.data : null;
  const aiError = aiFetcher.data?.kind === "error" ? aiFetcher.data : null;
  const saved = saveFetcher.data?.kind === "attached-saved" ? saveFetcher.data.outcomes : null;
  const saveStatus = new Map(saved?.map((o) => [o.ref, o]) ?? []);
  const canAi = data.ai.available && data.ai.consent;
  const hasMachine = attached.items.some((i) => i.fields.some((f) => f.machine && (!f.translation || f.outdated)));

  if (!attached.available) {
    return (
      <s-section heading="Images and custom fields">
        <s-paragraph>Image alt text and custom fields couldn&apos;t be loaded. Reload the page to try again.</s-paragraph>
      </s-section>
    );
  }
  if (!attached.items.length && !attached.imagesWithoutAlt && !attached.unsupported) return null;

  return (
    <s-section heading="Images and custom fields">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Alt text describes images for screen readers and image search. Custom fields are metafields that
          Shopify marks as translatable.
        </s-paragraph>
        {attached.imagesWithoutAlt ? (
          <s-banner tone="info" heading={`${attached.imagesWithoutAlt} image${attached.imagesWithoutAlt === 1 ? " has" : "s have"} no alt text`}>
            <s-paragraph>Add alt text in Shopify first; then it can be translated here.</s-paragraph>
          </s-banner>
        ) : null}
        {attached.unsupported ? (
          <s-paragraph>
            {attached.unsupported} custom field{attached.unsupported === 1 ? "" : "s"} with rich text, lists, links or
            files can&apos;t be edited here yet.
          </s-paragraph>
        ) : null}
        {aiError || ai?.stopped ? (
          <s-banner tone="critical" heading="AI translation failed">
            <s-paragraph>
              {errorMessages[aiError?.code ?? ai?.stopped ?? ""] ?? "Something went wrong."}
              {ai?.stopped && Object.keys(ai.drafts).length ? " The drafts created before the problem are filled in below." : ""}
            </s-paragraph>
          </s-banner>
        ) : null}
        {saved ? (
          <s-banner
            tone={saved.every((o) => o.status === "saved") ? "success" : "warning"}
            heading={
              saved.length === 0
                ? "Nothing to save"
                : saved.every((o) => o.status === "saved")
                  ? "Translations published"
                  : "Some fields weren't saved"
            }
          >
            <s-paragraph>
              {saved.length === 0
                ? "No fields were changed."
                : `${saved.filter((o) => o.status === "saved").length} of ${saved.length} saved to Shopify.`}
            </s-paragraph>
          </s-banner>
        ) : null}
        {hasMachine ? (
          <aiFetcher.Form method="post">
            <input type="hidden" name="intent" value="ai-translate-attached" />
            <s-button type="submit" disabled={!canAi} {...(aiFetcher.state !== "idle" ? { loading: true } : {})}>
              Translate missing alt text and fields with AI
            </s-button>
          </aiFetcher.Form>
        ) : null}

        <saveFetcher.Form method="post">
          <input type="hidden" name="intent" value="save-attached" />
          {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
          <s-stack direction="block" gap="base">
            {attached.items.map((item) => (
              <s-box key={item.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    {item.previewUrl ? (
                      <s-thumbnail src={`${item.previewUrl}${item.previewUrl.includes("?") ? "&" : "?"}width=96`} alt="" size="small" />
                    ) : null}
                    <s-text type="strong">{item.kind === "IMAGE" ? "Image alt text" : item.label}</s-text>
                    {item.valueType ? <s-badge>{valueTypeLabel(item.valueType)}</s-badge> : null}
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
                        ? "The source text changed in Shopify. Reload and translate again."
                        : status?.status === "error"
                          ? status.message ?? "Not saved."
                          : rejected
                            ? "The AI result was discarded."
                            : undefined;
                    const multiline = field.type === "MULTI_LINE_TEXT_FIELD" || field.type === "HTML" || field.source.length > 120;
                    // (key goes on the element itself, not through a spread.)
                    const fieldProps = {
                      name: fieldName("value", item.id, field.key),
                      label: data.target.name,
                      value: draft ?? field.translation,
                      ...(error ? { error } : {}),
                    };
                    const fieldKey = `${ref}:${draft ?? "base"}`;
                    const richText = field.type === "RICH_TEXT_FIELD";
                    return (
                      <s-stack key={ref} direction="block" gap="small">
                        <input type="hidden" name={fieldName("digest", item.id, field.key)} value={field.digest} />
                        {draft !== undefined ? <input type="hidden" name={fieldName("origin", item.id, field.key)} value="AI" /> : null}
                        <s-query-container>
                          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
                            <s-stack direction="block" gap="small">
                              <s-text color="subdued">{data.sourceName} (original)</s-text>
                              {richText ? (
                                <HtmlPreview html={richTextPreviewOrNull(field.source) ?? ""} title={`${item.label}, ${data.sourceName} original`} lang={data.sourceLocale} />
                              ) : (
                                <s-box padding="base" background="subdued" borderRadius="base">
                                  <s-paragraph>{field.source}</s-paragraph>
                                </s-box>
                              )}
                            </s-stack>
                            <s-stack direction="block" gap="small">
                              {richText ? (
                                <s-stack direction="block" gap="small">
                                  <s-text color="subdued">{data.target.name}</s-text>
                                  <HtmlPreview
                                    html={richTextPreviewOrNull(draft ?? field.translation) ?? ""}
                                    title={`${item.label}, ${data.target.name} preview`}
                                    lang={data.target.locale}
                                    dir={data.target.rtl ? "rtl" : "auto"}
                                  />
                                  {/* Only an AI draft is sent; formatting is checked again on the server. */}
                                  {draft !== undefined ? <input type="hidden" name={fieldProps.name} value={draft} /> : null}
                                  <s-text color="subdued">Rich text keeps its formatting. Change the wording in Shopify&apos;s editor, or translate it with AI here.</s-text>
                                  {error ? <s-text tone="critical">{error}</s-text> : null}
                                </s-stack>
                              ) : (
                                <div lang={data.target.locale} {...(data.target.rtl ? { dir: "rtl" } : {})}>
                                  {multiline ? <s-text-area key={fieldKey} {...fieldProps} rows={3} /> : <s-text-field key={fieldKey} {...fieldProps} />}
                                </div>
                              )}
                              {field.outdated && draft === undefined && field.translation ? (
                                <s-checkbox
                                  name={fieldName("confirm", item.id, field.key)}
                                  label="The source changed, but this translation is still correct"
                                />
                              ) : null}
                              <s-stack direction="inline" gap="small">
                                {field.outdated && draft === undefined ? <s-badge tone="warning">Outdated</s-badge> : null}
                                {draft !== undefined ? <s-badge tone="info">AI draft</s-badge> : null}
                                {warnings?.length ? <s-badge tone="warning">Review: {warnings.map(issueLabel).join(", ")}</s-badge> : null}
                                {status?.status === "saved" ? <s-badge tone="success">Published</s-badge> : null}
                                {!field.machine ? <s-badge>Manual only</s-badge> : null}
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
                Publish alt text and fields
              </s-button>
            ) : null}
          </s-stack>
        </saveFetcher.Form>
      </s-stack>
    </s-section>
  );
}

const VALUE_TYPES: Record<string, string> = {
  single_line_text_field: "Text",
  multi_line_text_field: "Long text",
  rich_text_field: "Rich text",
  json: "JSON",
  url: "Link",
  "list.single_line_text_field": "List of texts",
};

/** Readable metafield type: "multi_line_text_field" → "Long text". */
function valueTypeLabel(type: string) {
  return VALUE_TYPES[type] ?? type.replace(/^list\./, "list of ").replace(/_/g, " ");
}
