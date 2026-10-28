/**
 * Search engine listing for one language: live length checks for the SEO
 * title and description, and a preview of the search result. Values come
 * from the editor form as the merchant types.
 */
import {
  checkSeoField,
  plainText,
  SEO_DESCRIPTION_KEY,
  SEO_LIMITS,
  SEO_TITLE_KEY,
  seoWidth,
  truncateForPreview,
} from "../lib/seo";
import { useI18n } from "../i18n/react";
import { issueName } from "../i18n/labels";

export interface SeoPanelProps {
  /** Current value per field key (translation as typed, or the draft). */
  value: (key: string) => string;
  /** Source value per field key. */
  source: (key: string) => string;
  hasField: (key: string) => boolean;
  shopDomain: string;
  locale: string;
  /** "products" or "collections". */
  pathSegment: string;
}

export function SeoCounter({ fieldKey, value, source }: { fieldKey: string; value: string; source: string }) {
  const i18n = useI18n();
  const limits = SEO_LIMITS[fieldKey as keyof typeof SEO_LIMITS];
  if (!limits) return null;
  const width = seoWidth(value);
  const issues = checkSeoField(fieldKey, source, value);
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-text tone={width > limits.max ? "critical" : "neutral"}>
        {width} / {limits.max}
      </s-text>
      {issues.map((i) => (
        <s-badge key={i.code} tone="warning">
          {issueName(i18n, i.code)}
        </s-badge>
      ))}
    </s-stack>
  );
}

export function SeoPreview(props: SeoPanelProps) {
  const { t } = useI18n();
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = props.value(k).trim();
      if (v) return { text: v, fallback: k !== keys[0] };
    }
    return { text: "", fallback: true };
  };
  const title = pick(SEO_TITLE_KEY, "title");
  const descriptionValue = props.value(SEO_DESCRIPTION_KEY).trim();
  const description = descriptionValue || plainText(props.value("body_html") || props.source("body_html"));
  const handle = props.value("handle").trim() || props.source("handle");
  const url = `${props.shopDomain}/${props.locale.toLowerCase()}/${props.pathSegment}/${handle}`;

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{url}</s-text>
        <s-heading>{truncateForPreview(title.text || props.source("title"), SEO_LIMITS[SEO_TITLE_KEY].max)}</s-heading>
        <s-paragraph>{truncateForPreview(description, SEO_LIMITS[SEO_DESCRIPTION_KEY].max)}</s-paragraph>
      </s-stack>
      <s-stack direction="block" gap="small-300">
        {title.fallback && props.hasField(SEO_TITLE_KEY) === false ? (
          <s-text color="subdued">{t("editor.seo.noTitle")}</s-text>
        ) : null}
        {!descriptionValue ? (
          <s-text color="subdued">{t("editor.seo.noDescription")}</s-text>
        ) : null}
        <s-text color="subdued">{t("editor.seo.exampleAddress")}</s-text>
      </s-stack>
    </s-box>
  );
}
