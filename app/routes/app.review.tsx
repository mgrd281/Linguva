import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRef, useState } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { storedLocaleNames } from "../.server/locales/shop-locales";
import {
  approveDrafts,
  countPendingDrafts,
  listDraftLocales,
  searchPendingDrafts,
  MAX_DRAFTS_PER_ACTION,
  rejectDrafts,
} from "../.server/review/drafts";
import { editorPathFor, RESOURCE_KINDS } from "../lib/resource-kinds";
import { sanitizeHtml } from "../.server/lib/sanitize-html";
import { HtmlPreview } from "../components/HtmlPreview";
import { richTextPreviewOrNull } from "../lib/rich-text-preview";
import { useI18n } from "../i18n/react";
import { fieldName, issueName, kindLabel } from "../i18n/labels";

const looksLikeHtml = (text: string) => /<\/?[a-z][a-z0-9]*[\s>/]/i.test(text);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const q = (name: string) => url.searchParams.get(name) || null;
  const filter = {
    locale: q("lang"),
    jobId: q("job"),
    group: q("group"),
    resourceType: q("type"),
    flagged: q("flagged") === "1",
    search: q("q"),
  };
  const page = await searchPendingDrafts(shop.id, { ...filter, cursor: q("after"), take: 50 });
  const locales = await listDraftLocales(shop.id);
  const names = await storedLocaleNames(shop.id);
  return {
    names,
    total: await countPendingDrafts(shop.id),
    matching: page.total,
    filter,
    locales,
    nextCursor: page.nextCursor,
    isFirstPage: !q("after"),
    drafts: page.drafts.map((d) => ({
      id: d.id,
      // Images and custom fields are edited on their product's (or page's) editor.
      href: editorPathFor(d.parentGid ?? d.resourceGid, d.locale, d.resourceType),
      // Null: shown as "(untitled)" in the interface language.
      title: d.resourceTitle ?? null,
      locale: d.locale,
      key: d.key,
      customField: Boolean(d.parentGid && d.key === "value"),
      source: d.sourceValue,
      value: d.value,
      // HTML drafts are shown rendered (sanitised here, sandboxed in the page).
      sourcePreview: richTextPreviewOrNull(d.sourceValue) !== null
        ? sanitizeHtml(richTextPreviewOrNull(d.sourceValue)!)
        : looksLikeHtml(d.sourceValue)
          ? sanitizeHtml(d.sourceValue)
          : null,
      // Rich text (JSON): shown rendered, approved as is (no raw JSON to edit).
      valuePreview: richTextPreviewOrNull(d.value) !== null ? sanitizeHtml(richTextPreviewOrNull(d.value)!) : null,
      issues: Array.isArray(d.issues) ? (d.issues as Array<{ code?: string }>).map((i) => i.code ?? "") : [],
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = form.getAll("draft").map(String).slice(0, MAX_DRAFTS_PER_ACTION);

  if (intent === "reject") {
    return { kind: "rejected" as const, count: await rejectDrafts(shop.id, ids, actorId) };
  }
  if (intent === "approve") {
    const edits = new Map<string, string>();
    for (const id of ids) {
      const value = form.get(`value:${id}`);
      if (typeof value === "string" && value.trim()) edits.set(id, value);
    }
    const result = await approveDrafts({ admin, shopId: shop.id, actorId, draftIds: ids, edits });
    return { kind: "approved" as const, ...result };
  }
  return { kind: "error" as const };
};

export default function Review() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const formRef = useRef<HTMLFormElement>(null);
  const filtered = Boolean(
    data.filter.search || data.filter.locale || data.filter.group || data.filter.resourceType || data.filter.flagged,
  );
  const pageHref = (after: string | null) => {
    const params = new URLSearchParams();
    if (data.filter.jobId) params.set("job", data.filter.jobId);
    if (data.filter.search) params.set("q", data.filter.search);
    if (data.filter.locale) params.set("lang", data.filter.locale);
    if (data.filter.group) params.set("group", data.filter.group);
    if (data.filter.resourceType) params.set("type", data.filter.resourceType);
    if (data.filter.flagged) params.set("flagged", "1");
    if (after) params.set("after", after);
    const query = params.toString();
    return query ? `/app/review?${query}` : "/app/review";
  };
  // Edited translations, for the live preview of HTML drafts.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const onDraftInput = (event: { target: EventTarget | null }) => {
    const el = event.target as (Element & { value?: string }) | null;
    const name = el?.getAttribute?.("name");
    if (name?.startsWith("value:") && typeof el?.value === "string") {
      const id = name.slice("value:".length);
      setEdited((e) => ({ ...e, [id]: el.value! }));
    }
  };
  const submit = (intent: "approve" | "reject") => {
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("intent") as HTMLInputElement).value = intent;
    fetcher.submit(form);
  };

  return (
    <s-page heading={t("review.page.heading")}>
      <s-section>
        <s-paragraph>
          {data.total === 0 ? t("review.intro.empty") : t("review.intro.waiting", { count: data.total })}
        </s-paragraph>
      </s-section>

      {result?.kind === "approved" ? (
        <s-banner tone={result.stale || result.failed ? "warning" : "success"} heading={t("review.saved.heading")}>
          <s-paragraph>
            {[
              t("review.saved.published", { count: result.published }),
              result.stale ? t("review.saved.stale", { count: result.stale }) : null,
              result.failed ? t("review.saved.failed", { count: result.failed }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </s-paragraph>
        </s-banner>
      ) : null}
      {result?.kind === "rejected" ? (
        <s-banner tone="info" heading={t("review.rejected.heading")}>
          <s-paragraph>{t("review.rejected.body", { count: result.count })}</s-paragraph>
        </s-banner>
      ) : null}

      {data.total > 0 ? (
        <s-section>
          <Form method="get">
            {data.filter.jobId ? <input type="hidden" name="job" value={data.filter.jobId} /> : null}
            <s-stack direction="block" gap="base">
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, (inline-size > 760px) 2fr 1fr 1fr 1fr, 1fr" gap="base" alignItems="end">
                  <s-search-field
                    name="q"
                    label={t("common.action.search")}
                    placeholder={t("review.filter.searchPlaceholder")}
                    value={data.filter.search ?? ""}
                  />
                  <s-select name="lang" label={t("common.language")} value={data.filter.locale ?? ""}>
                    <s-option value="">{t("common.allLanguages")}</s-option>
                    {data.locales.map((l) => (
                      <s-option key={l} value={l}>
                        {data.names[l] ?? l}
                      </s-option>
                    ))}
                  </s-select>
                  <s-select name="group" label={t("review.filter.fields")} value={data.filter.group ?? ""}>
                    <s-option value="">{t("review.filter.allFields")}</s-option>
                    <s-option value="content">{t("review.filter.group.content")}</s-option>
                    <s-option value="seo">{t("review.filter.group.seo")}</s-option>
                    <s-option value="handle">{t("review.filter.group.handle")}</s-option>
                  </s-select>
                  <s-select name="type" label={t("review.filter.type")} value={data.filter.resourceType ?? ""}>
                    <s-option value="">{t("review.filter.allContent")}</s-option>
                    {Object.keys(RESOURCE_KINDS).map((kind) => (
                      <s-option key={kind} value={kind}>
                        {kindLabel(i18n, kind)}
                      </s-option>
                    ))}
                  </s-select>
                </s-grid>
              </s-query-container>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-checkbox name="flagged" value="1" label={t("review.filter.flagged")} {...(data.filter.flagged ? { checked: true } : {})} />
                <s-button type="submit">{t("review.filter.apply")}</s-button>
                {filtered ? (
                  <s-button href={data.filter.jobId ? `/app/review?job=${data.filter.jobId}` : "/app/review"} variant="tertiary">
                    {t("review.filter.clear")}
                  </s-button>
                ) : null}
              </s-stack>
            </s-stack>
          </Form>
          {filtered ? <s-paragraph>{t("review.filter.matching", { count: data.matching })}</s-paragraph> : null}
        </s-section>
      ) : null}

      {data.drafts.length ? (
        <fetcher.Form method="post" ref={formRef} onInput={onDraftInput}>
          <input type="hidden" name="intent" value="approve" />
          <s-section>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button variant="primary" onClick={() => submit("approve")} {...(busy ? { loading: true } : {})}>
                {t("review.actions.approve")}
              </s-button>
              <s-button tone="critical" onClick={() => submit("reject")} {...(busy ? { loading: true } : {})}>
                {t("review.actions.reject")}
              </s-button>
              <s-text color="subdued">{t("review.actions.onPage", { count: data.drafts.length })}</s-text>
            </s-stack>
          </s-section>
          {data.drafts.map((d) => {
            const title = d.title ?? t("review.draft.untitled");
            const field = d.customField ? t("review.draft.customField") : fieldName(i18n, d.key);
            const language = data.names[d.locale] ?? d.locale;
            return (
              <s-section key={d.id} heading={`${title} · ${field} · ${language}`}>
                <s-stack direction="block" gap="base">
                  <s-checkbox name="draft" value={d.id} label={t("review.draft.include")} defaultChecked />
                  <s-query-container>
                    <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
                      <s-stack direction="block" gap="small">
                        <s-text color="subdued">{t("review.draft.original")}</s-text>
                        {d.sourcePreview !== null ? (
                          <HtmlPreview html={d.sourcePreview} title={t("review.draft.originalTitle", { title, field })} lang="" />
                        ) : (
                          <s-box padding="base" background="subdued" borderRadius="base">
                            <s-paragraph>{d.source}</s-paragraph>
                          </s-box>
                        )}
                      </s-stack>
                      {d.valuePreview !== null ? (
                        <s-stack direction="block" gap="small">
                          <s-text color="subdued">{t("review.draft.richText", { language })}</s-text>
                          <HtmlPreview html={d.valuePreview} title={t("review.draft.previewTitle", { title, field })} lang={d.locale} />
                        </s-stack>
                      ) : (
                      <s-stack direction="block" gap="small">
                        <s-text-area
                          name={`value:${d.id}`}
                          label={t("review.draft.editLabel", { language })}
                          value={d.value}
                          rows={d.value.length > 200 ? 6 : 2}
                        />
                        {d.sourcePreview !== null ? (
                          <HtmlPreview html={edited[d.id] ?? d.value} title={t("review.draft.previewTitle", { title, field })} lang={d.locale} />
                        ) : null}
                      </s-stack>
                      )}
                    </s-grid>
                  </s-query-container>
                  <s-stack direction="inline" gap="small">
                    {d.issues.length ? (
                      <s-badge tone="warning">
                        {t("review.draft.check", { issues: d.issues.map((code) => issueName(i18n, code)).join(", ") })}
                      </s-badge>
                    ) : null}
                    {d.href ? <s-link href={d.href}>{t("review.draft.openEditor")}</s-link> : null}
                  </s-stack>
                </s-stack>
              </s-section>
            );
          })}
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={() => submit("approve")} {...(busy ? { loading: true } : {})}>
              {t("review.actions.approve")}
            </s-button>
            <s-button tone="critical" onClick={() => submit("reject")} {...(busy ? { loading: true } : {})}>
              {t("review.actions.reject")}
            </s-button>
          </s-stack>
        </fetcher.Form>
      ) : null}

      <s-stack direction="inline" gap="base">
        {!data.isFirstPage ? <s-button href={pageHref(null)}>{t("review.pagination.first")}</s-button> : null}
        {data.nextCursor ? <s-button href={pageHref(data.nextCursor)}>{t("review.pagination.next")}</s-button> : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
