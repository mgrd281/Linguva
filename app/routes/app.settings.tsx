import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getConfig } from "../.server/lib/config";
import { getTranslationProvider } from "../.server/providers";
import {
  getShopSettings,
  hasCurrentAiConsent,
  setAiConsent,
} from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { getMonthlyUsage, periodKey } from "../.server/usage/usage-ledger";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const settings = await getShopSettings(shop.id);
  return {
    consent: hasCurrentAiConsent(settings),
    consentAt: settings.aiDataProcessingConsentAt?.toISOString() ?? null,
    aiAvailable: getTranslationProvider() !== null,
    period: periodKey(),
    used: await getMonthlyUsage(shop.id),
    limit: getConfig().AI_MONTHLY_CHAR_LIMIT,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "grant-consent" && intent !== "revoke-consent") {
    return { ok: false };
  }
  await setAiConsent({
    shopId: shop.id,
    granted: intent === "grant-consent",
    actorId: session.onlineAccessInfo?.associated_user?.id?.toString() ?? null,
  });
  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const percent = data.limit ? Math.min(100, Math.round((data.used / data.limit) * 100)) : 0;

  return (
    <s-page heading="Settings">
      <s-section heading="AI translation">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            When you translate with AI, the product text you select is sent to
            DeepL SE (Germany) for processing. Linguva sends no customer
            data. Every AI result is a draft until you publish it.
          </s-paragraph>
          {data.consent ? (
            <s-paragraph>
              <s-badge tone="success">Allowed</s-badge>{" "}
              {data.consentAt
                ? `since ${new Date(data.consentAt).toLocaleDateString(undefined, { dateStyle: "long" })}`
                : null}
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge>Not allowed</s-badge>
            </s-paragraph>
          )}
          <fetcher.Form method="post">
            <input
              type="hidden"
              name="intent"
              value={data.consent ? "revoke-consent" : "grant-consent"}
            />
            <s-button
              type="submit"
              variant={data.consent ? "secondary" : "primary"}
              {...(busy ? { loading: true } : {})}
            >
              {data.consent ? "Withdraw permission" : "Allow AI processing"}
            </s-button>
          </fetcher.Form>
          {!data.aiAvailable ? (
            <s-banner tone="warning" heading="AI provider not configured">
              <s-paragraph>
                The app operator hasn&apos;t configured a translation provider yet.
                Manual translation works without it.
              </s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading={`Usage in ${data.period}`}>
        <s-paragraph>
          {data.used.toLocaleString()} of {data.limit.toLocaleString()} AI
          characters used ({percent}%).
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
