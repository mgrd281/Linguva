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
  ConfirmationRequiredError,
  getShopSettings,
  hasCurrentAiConsent,
  setAiConsent,
  setBulkPublishMode,
  setReuseMachineMemory,
} from "../.server/settings/shop-settings";
import { requireShop } from "../.server/shopify/require-shop";
import { getMonthlyUsage, periodKey } from "../.server/usage/usage-ledger";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const settings = await getShopSettings(shop.id);
  return {
    consent: hasCurrentAiConsent(settings),
    consentAt: settings.aiDataProcessingConsentAt?.toISOString() ?? null,
    publishMode: settings.bulkPublishMode,
    autoPublishEnabledAt: settings.autoPublishEnabledAt?.toISOString() ?? null,
    reuseMachineMemory: settings.reuseMachineMemory,
    aiAvailable: getTranslationProvider() !== null,
    period: periodKey(),
    used: await getMonthlyUsage(shop.id),
    limit: getConfig().AI_MONTHLY_CHAR_LIMIT,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "publish-mode") {
    try {
      await setBulkPublishMode({
        shopId: shop.id,
        mode: form.get("mode") === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "DRAFT",
        confirmed: form.get("confirm") === "on",
        actorId,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof ConfirmationRequiredError) return { ok: false, error: "CONFIRMATION_REQUIRED" };
      throw error;
    }
  }
  if (intent === "reuse-memory") {
    await setReuseMachineMemory({ shopId: shop.id, enabled: form.get("enabled") === "true" });
    return { ok: true };
  }
  if (intent !== "grant-consent" && intent !== "revoke-consent") {
    return { ok: false };
  }
  await setAiConsent({ shopId: shop.id, granted: intent === "grant-consent", actorId });
  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const memoryFetcher = useFetcher<typeof action>();
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

      <s-section heading="Bulk translation publishing">
        <s-stack direction="block" gap="base">
          {data.publishMode === "AUTO_PUBLISH" ? (
            <s-paragraph>
              <s-badge tone="warning">Automatic publishing</s-badge> Bulk translations that pass the quality checks go
              live without review
              {data.autoPublishEnabledAt
                ? ` (enabled ${new Date(data.autoPublishEnabledAt).toLocaleDateString(undefined, { dateStyle: "long" })})`
                : ""}
              .
            </s-paragraph>
          ) : (
            <s-paragraph>
              <s-badge tone="success">Review first</s-badge> Bulk translations wait in Review until you approve them.
            </s-paragraph>
          )}
          <modeFetcher.Form method="post">
            <input type="hidden" name="intent" value="publish-mode" />
            {data.publishMode === "AUTO_PUBLISH" ? (
              <>
                <input type="hidden" name="mode" value="DRAFT" />
                <s-button type="submit">Switch back to review first</s-button>
              </>
            ) : (
              <s-stack direction="block" gap="small">
                <input type="hidden" name="mode" value="AUTO_PUBLISH" />
                <s-checkbox
                  name="confirm"
                  label="I understand that machine translations will be published to my storefront without my review."
                />
                <s-button type="submit" variant="secondary">
                  Enable automatic publishing
                </s-button>
              </s-stack>
            )}
          </modeFetcher.Form>
          {modeFetcher.data && "error" in modeFetcher.data ? (
            <s-banner tone="critical" heading="Please confirm">
              <s-paragraph>Tick the confirmation box to enable automatic publishing.</s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Translation memory">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Approved translations are always reused for identical text. You
            can also reuse unreviewed machine translations, which keeps wording
            consistent and avoids paying twice for the same sentence.
          </s-paragraph>
          <memoryFetcher.Form method="post">
            <input type="hidden" name="intent" value="reuse-memory" />
            <input type="hidden" name="enabled" value={data.reuseMachineMemory ? "false" : "true"} />
            <s-button type="submit">
              {data.reuseMachineMemory ? "Reuse approved translations only" : "Also reuse machine translations"}
            </s-button>
          </memoryFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading={`Usage in ${data.period}`}>
        <s-paragraph>
          {data.used.toLocaleString()} of {data.limit.toLocaleString()} AI
          characters used ({percent}%).
        </s-paragraph>
        <s-paragraph>
          Text reused from your translation memory, repeated sentences and
          glossary-only text aren&apos;t sent to AI and don&apos;t count
          towards this limit.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
