/**
 * Rich text, lists and links (metafields, metaobject fields) in the editor
 * and on Review: shown readably, never as raw JSON. List and link texts are
 * translated item by item; the number of items and the link addresses stay
 * those of the original. Rich text is translated with AI and shown as a
 * preview. The server checks the structure again before anything is saved.
 */
import { useState } from "react";
import { useI18n } from "../i18n/react";
import { richTextPreviewOrNull } from "../lib/rich-text-preview";
import { RICH_TEXT_TYPE, structuredItems, withTexts } from "../lib/structured-preview";
import { HtmlPreview } from "./HtmlPreview";

/** The original (or a read-only translation): rich text rendered, lists and links as a list. */
export function StructuredView({ type, value, title, lang, dir }: { type: string; value: string; title: string; lang: string; dir?: "rtl" | "auto" }) {
  if (type === RICH_TEXT_TYPE) return <HtmlPreview html={richTextPreviewOrNull(value) ?? ""} title={title} lang={lang} {...(dir ? { dir } : {})} />;
  const items = structuredItems(type, value);
  return (
    <div lang={lang || undefined} {...(dir === "rtl" ? { dir: "rtl" } : {})}>
      <s-box padding="base" background="subdued" borderRadius="base">
        {items ? <StructuredList items={items} /> : <s-paragraph>{value}</s-paragraph>}
      </s-box>
    </div>
  );
}

/**
 * The translation of a structured value. Rich text: a preview of the AI
 * draft or the published translation. Lists and links: one text field per
 * item, rebuilt into the original's shape once the merchant types. The
 * value goes to the form as `name`.
 */
export function StructuredEditor({
  type,
  source,
  value,
  name,
  language,
  title,
  locale,
  rtl,
  error,
  onValue,
}: {
  type: string;
  source: string;
  value: string;
  name: string;
  /** The target language's name, for labels. */
  language: string;
  title: string;
  locale: string;
  rtl: boolean;
  error?: string;
  onValue?: (value: string) => void;
}) {
  const { t } = useI18n();
  const sourceItems = structuredItems(type, source);
  const shown = structuredItems(type, value);
  const initial = (sourceItems ?? []).map((_, i) => (shown && shown.length === sourceItems!.length ? shown[i]!.text : ""));
  // Null until the merchant types: the value is then sent exactly as it came
  // (an unchanged translation is not saved again, outdated ones still need
  // the "still correct" confirmation).
  const [texts, setTexts] = useState<string[] | null>(null);
  const valueOf = (next: string[] | null) => (next === null || next.every((text, i) => text === initial[i]) ? value : withTexts(type, source, next));

  if (type === RICH_TEXT_TYPE || !sourceItems) {
    return (
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{language}</s-text>
        {value ? (
          <HtmlPreview html={richTextPreviewOrNull(value) ?? ""} title={title} lang={locale} dir={rtl ? "rtl" : "auto"} />
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text color="subdued">{t("editor.structured.notTranslated")}</s-text>
          </s-box>
        )}
        {value ? <input type="hidden" name={name} value={value} /> : null}
        <s-text color="subdued">{t("editor.structured.richTextNote")}</s-text>
        {error ? <s-text tone="critical">{error}</s-text> : null}
      </s-stack>
    );
  }

  const current = texts ?? initial;
  const partly = current.some((text) => text.trim()) && current.some((text, i) => !text.trim() && sourceItems[i]!.text.trim());
  const multiline = type === "LIST_MULTI_LINE_TEXT_FIELD";
  return (
    <s-stack direction="block" gap="small">
      <input type="hidden" name={name} value={valueOf(texts)} />
      <div lang={locale} {...(rtl ? { dir: "rtl" } : {})}>
        <s-stack direction="block" gap="small">
          {sourceItems.map((item, i) => {
            const props = {
              label: sourceItems.length > 1 ? t("editor.structured.item", { language, n: i + 1 }) : language,
              value: current[i] ?? "",
              ...(item.url ? { details: t("editor.structured.linksTo", { url: item.url }) } : {}),
              ...(partly && !current[i]?.trim() && item.text.trim() ? { error: t("editor.structured.itemRequired") } : {}),
              onInput: (event: Event) => {
                const next = [...current];
                next[i] = (event.currentTarget as HTMLInputElement).value;
                setTexts(next);
                onValue?.(valueOf(next));
              },
            };
            return multiline ? <s-text-area key={i} {...props} rows={2} /> : <s-text-field key={i} {...props} />;
          })}
        </s-stack>
      </div>
      <s-text color="subdued">{t("editor.structured.note")}</s-text>
      {error ? <s-text tone="critical">{error}</s-text> : null}
    </s-stack>
  );
}

/** Texts of a list or link value; link addresses shown as plain text (never followed from here). */
function StructuredList({ items }: { items: Array<{ text: string; url?: string }> }) {
  return (
    <s-unordered-list>
      {items.map((item, i) => (
        <s-list-item key={i}>
          {item.text}
          {item.url ? <s-text color="subdued"> ({item.url})</s-text> : null}
        </s-list-item>
      ))}
    </s-unordered-list>
  );
}
