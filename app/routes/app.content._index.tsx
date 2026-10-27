import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadContentHub, requestableScopes, type HubStatus } from "../.server/translation/content-hub";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, scopes } = await requireShop(request);
  const granted = (await scopes.query()).granted;
  const entries = await loadContentHub(admin, granted);
  const groups = [...new Set(entries.map((e) => e.group))].map((group) => ({
    group,
    entries: entries.filter((e) => e.group === group),
  }));
  return { groups, counts: { withContent: entries.filter((e) => e.status === "has-content").length, total: entries.length } };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { scopes } = await requireShop(request);
  const form = await request.formData();
  const scope = String(form.get("scope") ?? "");
  // Only the optional scopes declared for content types, never anything else.
  if (form.get("intent") !== "request-scope" || !requestableScopes().includes(scope)) return { ok: false };
  // Redirects to Shopify's permission screen; returns if already granted.
  await scopes.request([scope]);
  return { ok: true };
};

const STATUS: Record<HubStatus, { label: string; tone?: "success" | "info" | "warning" }> = {
  "has-content": { label: "Ready to translate", tone: "success" },
  empty: { label: "Nothing in your store yet" },
  "needs-permission": { label: "Needs your permission", tone: "warning" },
  unavailable: { label: "Not available", tone: "info" },
};

export default function ContentHub() {
  const { groups, counts } = useLoaderData<typeof loader>();
  const permission = useFetcher<typeof action>();

  return (
    <s-page heading="All content">
      <s-section>
        <s-paragraph>
          Everything in your store that Shopify lets you translate. {counts.withContent} of {counts.total} content types
          have something to translate. Products and collections have their own pages in the navigation.
        </s-paragraph>
      </s-section>
      {groups.map(({ group, entries }) => (
        <s-section key={group} heading={group} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Content</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header>Translate all</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entries.map((e) => (
                <s-table-row key={e.type}>
                  <s-table-cell>
                    {e.status === "has-content" ? <s-link href={e.path}>{e.label}</s-link> : e.label}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge {...(STATUS[e.status].tone ? { tone: STATUS[e.status].tone } : {})}>{STATUS[e.status].label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{e.bulk ? "Yes" : e.caution === "legal" ? "One by one (legal text)" : "One by one"}</s-table-cell>
                  <s-table-cell>
                    {e.status === "needs-permission" && e.scope ? (
                      <permission.Form method="post">
                        <input type="hidden" name="intent" value="request-scope" />
                        <input type="hidden" name="scope" value={e.scope} />
                        <s-button type="submit" variant="secondary" accessibilityLabel={`Allow access to ${e.label}`}>
                          Allow access
                        </s-button>
                      </permission.Form>
                    ) : e.status === "has-content" ? (
                      <s-button href={e.path} accessibilityLabel={`Translate ${e.label}`}>
                        Translate
                      </s-button>
                    ) : null}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
