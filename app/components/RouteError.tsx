/**
 * Error boundary for every page of the embedded app. Shopify's own
 * authentication responses (App Bridge bounce pages, session token retries)
 * still go to the library's boundary; every other error gets a clear
 * message with a way forward, never internal details.
 */
import { isRouteErrorResponse, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useI18n } from "../i18n/react";

type ErrorCase = "notFound" | "forbidden" | "timeout" | "unavailable" | "generic";

function describe(error: unknown): { kind: ErrorCase; retry: boolean } {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return { kind: "notFound", retry: false };
    if (error.status === 403) return { kind: "forbidden", retry: true };
    if (error.status === 504) return { kind: "timeout", retry: true };
    if (error.status === 429 || error.status >= 500) return { kind: "unavailable", retry: true };
  }
  return { kind: "generic", retry: true };
}

/** Shopify's authentication flow throws responses that its boundary must handle. */
export function isShopifyAuthResponse(error: unknown) {
  return isRouteErrorResponse(error) && (error.status < 400 || error.status === 401);
}

export function RouteErrorContent({ error }: { error: unknown }) {
  const revalidator = useRevalidator();
  const { t } = useI18n();
  const { kind, retry } = describe(error);
  const heading = t(`common.error.${kind}.heading`);
  const body = t(`common.error.${kind}.body`);
  return (
    <s-page heading={heading}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-banner tone="critical" heading={heading}>
            <s-paragraph>{body}</s-paragraph>
          </s-banner>
          <s-stack direction="inline" gap="base">
            {retry ? (
              <s-button
                variant="primary"
                onClick={() => revalidator.revalidate()}
                {...(revalidator.state !== "idle" ? { loading: true } : {})}
              >
                {t("common.error.tryAgain")}
              </s-button>
            ) : null}
            <s-button href="/app">{t("common.error.toOverview")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isShopifyAuthResponse(error)) return boundary.error(error);
  return <RouteErrorContent error={error} />;
}
