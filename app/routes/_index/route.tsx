import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

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
  {
    title: "Every part of your store",
    text: "Products, collections, pages, blogs, menus, theme texts, policies, image alt text and custom fields: all 30 kinds of content Shopify lets apps translate.",
  },
  {
    title: "AI you stay in control of",
    text: "Your glossary, translation memory and tone of voice are applied. Results wait for your review unless you choose otherwise, and nothing you wrote is overwritten.",
  },
  {
    title: "Found in every language",
    text: "Search engine titles, descriptions and URLs are translated and checked, with a preview of how each page appears in search results.",
  },
];

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading="Linguva">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>Translate your Shopify store, carefully</s-heading>
            <s-paragraph>
              Linguva translates your store into the languages your customers speak, with AI you can review, and
              shows you when a translation no longer matches its original.
            </s-paragraph>
            <s-paragraph>
              To get started, install Linguva from the Shopify App Store, or open it from the Apps section of your
              Shopify admin.
            </s-paragraph>
          </s-stack>
        </s-section>
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr 1fr, 1fr" gap="base">
            {FEATURES.map((f) => (
              <s-section key={f.title} heading={f.title}>
                <s-paragraph>{f.text}</s-paragraph>
              </s-section>
            ))}
          </s-grid>
        </s-query-container>
        {showForm ? (
          <s-section heading="Open a development store">
            <Form method="post" action="/auth/login">
              <s-stack direction="block" gap="base">
                <s-text-field name="shop" label="Shop domain" details="example.myshopify.com" />
                <s-button type="submit">Log in</s-button>
              </s-stack>
            </Form>
          </s-section>
        ) : null}
      </s-page>
    </>
  );
}
