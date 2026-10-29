import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { translator } from "../../i18n/i18n";
import { useAppLocale } from "../../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Merchants install and open Linguva from Shopify; typing a shop domain
  // is only offered for development.
  return { showForm: Boolean(login) && process.env.NODE_ENV === "development" };
};

const FEATURES = [
  { id: "content", title: "landing.feature.content.title", text: "landing.feature.content.text" },
  { id: "control", title: "landing.feature.control.title", text: "landing.feature.control.text" },
  { id: "seo", title: "landing.feature.seo.title", text: "landing.feature.seo.text" },
] as const;

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  // Outside the app layout, so no I18nProvider: the root loader's language.
  const { t } = translator(useAppLocale());

  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading="Linguva">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>{t("landing.hero.heading")}</s-heading>
            <s-paragraph>{t("landing.hero.body")}</s-paragraph>
            <s-paragraph>{t("landing.hero.start")}</s-paragraph>
          </s-stack>
        </s-section>
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr 1fr, 1fr" gap="base">
            {FEATURES.map((f) => (
              <s-section key={f.id} heading={t(f.title)}>
                <s-paragraph>{t(f.text)}</s-paragraph>
              </s-section>
            ))}
          </s-grid>
        </s-query-container>
        {showForm ? (
          <s-section heading={t("landing.dev.heading")}>
            <Form method="post" action="/auth/login">
              <s-stack direction="block" gap="base">
                <s-text-field name="shop" label={t("landing.dev.shopDomain")} details="example.myshopify.com" />
                <s-button type="submit">{t("landing.dev.logIn")}</s-button>
              </s-stack>
            </Form>
          </s-section>
        ) : null}
      </s-page>
    </>
  );
}
