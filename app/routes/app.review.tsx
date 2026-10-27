import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRef } from "react";
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
import { editorPath, RESOURCE_KINDS } from "../lib/resource-kinds";
import { fieldLabel } from "../lib/field-labels";
import { issueLabel } from "../lib/issue-labels";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const q = (name: string) => url.searchParams.get(name) || null;
  const filter = {
    locale: q("locale"),
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
      href: editorPath(d.resourceGid, d.locale),
      title: d.resourceTitle ?? "(untitled)",
      locale: d.locale,
      key: d.key,
      label: fieldLabel(d.key),
      source: d.sourceValue,
      value: d.value,
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
    if (data.filter.locale) params.set("locale", data.filter.locale);
    if (data.filter.group) params.set("group", data.filter.group);
    if (data.filter.resourceType) params.set("type", data.filter.resourceType);
    if (data.filter.flagged) params.set("flagged", "1");
    if (after) params.set("after", after);
    const query = params.toString();
    return query ? `/app/review?${query}` : "/app/review";
  };
  const submit = (intent: "approve" | "reject") => {
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("intent") as HTMLInputElement).value = intent;
    fetcher.submit(form);
  };

  return (
    <s-page heading="Review translations">
      <s-section>
        <s-paragraph>
          {data.total === 0
            ? "Nothing to review. Bulk translations appear here before they are published."
            : `${data.total} translation${data.total === 1 ? "" : "s"} waiting for review. Nothing is visible to customers until you approve it.`}
        </s-paragraph>
      </s-section>

      {result?.kind === "approved" ? (
        <s-banner tone={result.stale || result.failed ? "warning" : "success"} heading="Review saved">
          <s-paragraph>
            Published: {result.published}
            {result.stale ? ` · Source changed, not published: ${result.stale}` : ""}
            {result.failed ? ` · Failed: ${result.failed}` : ""}
          </s-paragraph>
        </s-banner>
      ) : null}
      {result?.kind === "rejected" ? (
        <s-banner tone="info" heading="Drafts rejected">
          <s-paragraph>{result.count} draft(s) discarded. They won&apos;t be published.</s-paragraph>
        </s-banner>
      ) : null}

      {data.total > 0 ? (
        <s-section>
          <Form method="get">
            {data.filter.jobId ? <input type="hidden" name="job" value={data.filter.jobId} /> : null}
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-search-field name="q" label="Search" placeholder="Title, original or translation" value={data.filter.search ?? ""} />
              <s-select name="locale" label="Language" value={data.filter.locale ?? ""}>
                <s-option value="">All languages</s-option>
                {data.locales.map((l) => (
                  <s-option key={l} value={l}>
                    {data.names[l] ?? l}
                  </s-option>
                ))}
              </s-select>
              <s-select name="group" label="Fields" value={data.filter.group ?? ""}>
                <s-option value="">All fields</s-option>
                <s-option value="content">Content</s-option>
                <s-option value="seo">Search engine listing</s-option>
                <s-option value="handle">URL handles</s-option>
              </s-select>
              <s-select name="type" label="Type" value={data.filter.resourceType ?? ""}>
                <s-option value="">All content</s-option>
                {Object.entries(RESOURCE_KINDS).map(([kind, meta]) => (
                  <s-option key={kind} value={kind}>
                    {meta.label}
                  </s-option>
                ))}
              </s-select>
              <s-checkbox name="flagged" value="1" label="Only with warnings" {...(data.filter.flagged ? { checked: true } : {})} />
              <s-button type="submit">Apply</s-button>
              {filtered ? <s-button href={data.filter.jobId ? `/app/review?job=${data.filter.jobId}` : "/app/review"} variant="tertiary">Clear</s-button> : null}
            </s-stack>
          </Form>
          {filtered ? <s-paragraph>{data.matching} matching.</s-paragraph> : null}
        </s-section>
      ) : null}

      {data.drafts.length ? (
        <fetcher.Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="approve" />
          <s-section>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button variant="primary" onClick={() => submit("approve")} {...(busy ? { loading: true } : {})}>
                Approve and publish selected
              </s-button>
              <s-button tone="critical" onClick={() => submit("reject")} {...(busy ? { loading: true } : {})}>
                Reject selected
              </s-button>
              <s-text color="subdued">
                {data.drafts.length} on this page. Untick the ones you don&apos;t want to change.
              </s-text>
            </s-stack>
          </s-section>
          {data.drafts.map((d) => (
            <s-section key={d.id} heading={`${d.title} · ${d.label} · ${data.names[d.locale] ?? d.locale}`}>
              <s-stack direction="block" gap="base">
                <s-checkbox name="draft" value={d.id} label="Include" defaultChecked />
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-text color="subdued">Source</s-text>
                  <s-paragraph>{d.source}</s-paragraph>
                </s-box>
                <s-text-area
                  name={`value:${d.id}`}
                  label="Translation (you can edit before approving)"
                  value={d.value}
                  rows={d.value.length > 200 ? 6 : 2}
                />
                <s-stack direction="inline" gap="small">
                  {d.issues.length ? <s-badge tone="warning">Check: {d.issues.map(issueLabel).join(", ")}</s-badge> : null}
                  {d.href ? <s-link href={d.href}>Open in editor</s-link> : null}
                </s-stack>
              </s-stack>
            </s-section>
          ))}
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={() => submit("approve")} {...(busy ? { loading: true } : {})}>
              Approve and publish selected
            </s-button>
            <s-button tone="critical" onClick={() => submit("reject")} {...(busy ? { loading: true } : {})}>
              Reject selected
            </s-button>
          </s-stack>
        </fetcher.Form>
      ) : null}

      <s-stack direction="inline" gap="base">
        {!data.isFirstPage ? <s-button href={pageHref(null)}>First page</s-button> : null}
        {data.nextCursor ? <s-button href={pageHref(data.nextCursor)}>Next page</s-button> : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
