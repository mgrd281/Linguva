import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadContentHub, requestableScopes, type HubStatus } from "../.server/translation/content-hub";
import { useI18n } from "../i18n/react";
import { groupLabel, kindLabel } from "../i18n/labels";

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
  const i18n = useI18n();
  const { t } = i18n;
  const mode = (e: { bulk: boolean; caution: string | null }) =>
    e.bulk ? t("content.mode.bulk") : e.caution === "legal" ? t("content.mode.legal") : t("content.mode.single");
  const label = (e: { type: string }) => kindLabel(i18n, e.type);
  // "Online store" groups the pages, blog posts and blogs; the other groups are the content types' own.
  const group = (e: { group: string }) => (e.group === "Online store" ? t("content.group.onlineStore") : groupLabel(i18n, e.group));

  return (
    <s-page heading={t("common.nav.content")}>
      <s-section>
        <s-paragraph>{t("content.intro", { ready: ready.length, total })}</s-paragraph>
      </s-section>

      <s-section heading={t("content.ready.heading")} padding="none">
        {ready.length ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("common.contentType")}</s-table-header>
              <s-table-header listSlot="secondary">{t("content.table.area")}</s-table-header>
              <s-table-header>{t("content.table.how")}</s-table-header>
              <s-table-header>{t("content.table.action")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ready.map((e) => (
                <s-table-row key={e.type}>
                  <s-table-cell>
                    <s-link href={e.path}>{label(e)}</s-link>
                  </s-table-cell>
                  <s-table-cell>{group(e)}</s-table-cell>
                  <s-table-cell>{mode(e)}</s-table-cell>
                  <s-table-cell>
                    <s-button href={e.path} accessibilityLabel={t("content.translateLabel", { label: label(e) })}>
                      {t("content.translate")}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-box padding="base">
            <s-paragraph>{t("content.ready.none")}</s-paragraph>
          </s-box>
        )}
      </s-section>

      {permission.length ? (
        <s-section heading={t("content.permission.heading")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("common.contentType")}</s-table-header>
              <s-table-header listSlot="secondary">{t("content.table.area")}</s-table-header>
              <s-table-header>{t("content.table.action")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {permission.map((e) => (
                <s-table-row key={e.type}>
                  <s-table-cell>{label(e)}</s-table-cell>
                  <s-table-cell>{group(e)}</s-table-cell>
                  <s-table-cell>
                    <grant.Form method="post">
                      <input type="hidden" name="intent" value="request-scope" />
                      <input type="hidden" name="scope" value={e.scope ?? ""} />
                      <s-button
                        type="submit"
                        variant="primary"
                        accessibilityLabel={t("content.permission.allowLabel", { label: label(e) })}
                      >
                        {t("content.permission.allow")}
                      </s-button>
                    </grant.Form>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-text color="subdued">{t("content.permission.note")}</s-text>
          </s-box>
        </s-section>
      ) : null}

      {empty.length ? (
        <s-section heading={t("content.empty.heading")}>
          <s-paragraph>{empty.map(label).join(" · ")}</s-paragraph>
          <s-text color="subdued">{t("content.empty.note")}</s-text>
        </s-section>
      ) : null}

      {unavailable.length ? (
        <s-section heading={t("content.unavailable.heading")}>
          <s-paragraph>{unavailable.map(label).join(" · ")}</s-paragraph>
          <s-text color="subdued">{t("content.unavailable.note")}</s-text>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
