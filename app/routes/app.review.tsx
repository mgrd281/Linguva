import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import {
  approveDrafts,
  countPendingDrafts,
  listPendingDrafts,
  MAX_DRAFTS_PER_ACTION,
  rejectDrafts,
} from "../.server/review/drafts";
import { editorPath } from "../lib/resource-kinds";
import { fieldLabel } from "../lib/field-labels";
import { issueLabel } from "../lib/issue-labels";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? undefined;
  const jobId = url.searchParams.get("job") ?? undefined;
  const drafts = await listPendingDrafts(shop.id, { locale, jobId, take: 50 });
  return {
    total: await countPendingDrafts(shop.id),
    filter: { locale: locale ?? null, jobId: jobId ?? null },
    drafts: drafts.map((d) => ({
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

      {data.drafts.length ? (
        <fetcher.Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="approve" />
          {data.drafts.map((d) => (
            <s-section key={d.id} heading={`${d.title} · ${d.label} · ${d.locale}`}>
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
