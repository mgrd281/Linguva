/**
 * Error boundary for every page of the embedded app. Shopify's own
 * authentication responses (App Bridge bounce pages, session token retries)
 * still go to the library's boundary; every other error gets a clear
 * message with a way forward, never internal details.
 */
import { isRouteErrorResponse, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

function describe(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        heading: "We couldn't find this page",
        body: "It may have been deleted in Shopify, or the link is out of date.",
        retry: false,
      };
    }
    if (error.status === 403) {
      return {
        heading: "Linguva doesn't have access to this",
        body: "Shopify refused the request. Approve the app's permissions again from Shopify's Apps page, then reload.",
        retry: true,
      };
    }
    if (error.status === 504) {
      return {
        heading: "Shopify is taking too long",
        body: "Shopify didn't answer in time, so Linguva stopped waiting. Nothing was changed by this page. Try again in a moment.",
        retry: true,
      };
    }
    if (error.status === 429 || error.status >= 500) {
      return {
        heading: "Shopify didn't respond",
        body: "Shopify is busy or temporarily unavailable. Nothing was changed. Try again in a moment.",
        retry: true,
      };
    }
  }
  return {
    heading: "Something went wrong",
    body: "This page couldn't be loaded. Nothing was changed in your store. Try again, and contact support if it keeps happening.",
    retry: true,
  };
}

/** Shopify's authentication flow throws responses that its boundary must handle. */
export function isShopifyAuthResponse(error: unknown) {
  return isRouteErrorResponse(error) && (error.status < 400 || error.status === 401);
}

export function RouteErrorContent({ error }: { error: unknown }) {
  const revalidator = useRevalidator();
  const { heading, body, retry } = describe(error);
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
                Try again
              </s-button>
            ) : null}
            <s-button href="/app">Go to Overview</s-button>
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
