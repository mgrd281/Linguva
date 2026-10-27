import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadContentHub, requestableScopes, type HubStatus } from "../.server/translation/content-hub";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, scopes } = await requireShop(request);
  const granted = (await scopes.query()).granted;
  const entries = await loadContentHub(admin, granted);
  const by = (status: HubStatus) => entries.filter((e) => e.status === status);
  return {
    ready: by("has-content"),
    permission: by("needs-permission"),
    empty: by("empty"),
    unavailable: by("unavailable"),
    total: entries.length,
  };
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

export default function ContentHub() {
  const { ready, permission, empty, unavailable, total } = useLoaderData<typeof loader>();
  const grant = useFetcher<typeof action>();
  const mode = (e: { bulk: boolean; caution: string | null }) =>
    e.bulk ? "Translate all at once" : e.caution === "legal" ? "One by one (legal text)" : "One by one";

  return (
    <s-page heading="All content">
      <s-section>
        <s-paragraph>
          Everything in your store that Shopify lets you translate: {ready.length} of {total} content types have
          something to translate. Products and collections have their own pages in the navigation.
        </s-paragraph>
      </s-section>

      <s-section heading="Ready to translate" padding="none">
        {ready.length ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Content</s-table-header>
              <s-table-header listSlot="secondary">Area</s-table-header>
              <s-table-header>How</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ready.map((e) => (
                <s-table-row key={e.type}>
                  <s-table-cell>
                    <s-link href={e.path}>{e.label}</s-link>
                  </s-table-cell>
                  <s-table-cell>{e.group}</s-table-cell>
                  <s-table-cell>{mode(e)}</s-table-cell>
                  <s-table-cell>
                    <s-button href={e.path} accessibilityLabel={`Translate ${e.label}`}>
                      Translate
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-box padding="base">
            <s-paragraph>Nothing besides products and collections yet.</s-paragraph>
          </s-box>
        )}
      </s-section>

      {permission.length ? (
        <s-section heading="Needs your permission" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Content</s-table-header>
              <s-table-header listSlot="secondary">Area</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {permission.map((e) => (
                <s-table-row key={e.type}>
                  <s-table-cell>{e.label}</s-table-cell>
                  <s-table-cell>{e.group}</s-table-cell>
                  <s-table-cell>
                    <grant.Form method="post">
                      <input type="hidden" name="intent" value="request-scope" />
                      <input type="hidden" name="scope" value={e.scope ?? ""} />
                      <s-button type="submit" variant="primary" accessibilityLabel={`Allow access to ${e.label}`}>
                        Allow access
                      </s-button>
                    </grant.Form>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-text color="subdued">Linguva only asks to read this content. It never changes your originals.</s-text>
          </s-box>
        </s-section>
      ) : null}

      {empty.length ? (
        <s-section heading="Not in your store yet">
          <s-paragraph>
            {empty.map((e) => e.label).join(" · ")}
          </s-paragraph>
          <s-text color="subdued">They appear under Ready to translate as soon as you add them in Shopify.</s-text>
        </s-section>
      ) : null}

      {unavailable.length ? (
        <s-section heading="Not available to apps in this store">
          <s-paragraph>{unavailable.map((e) => e.label).join(" · ")}</s-paragraph>
          <s-text color="subdued">You can translate these in Shopify&apos;s own Translate &amp; Adapt app.</s-text>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
