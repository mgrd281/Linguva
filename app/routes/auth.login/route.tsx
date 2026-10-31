import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { refuseShop, refuseShopInput } from "../../.server/shopify/require-shop";
import { loginErrorMessage } from "./error.server";

// Merchants install and open Linguva from Shopify (App Store requirement
// 2.3.1): typing a shop domain is only offered in development. Elsewhere a
// request without a valid shop goes to the start page, which says where to
// start; one with a shop still goes through Shopify's login().
const shopForm = () => process.env.NODE_ENV === "development";

function formOrStart(errors: ReturnType<typeof loginErrorMessage>) {
  if (!shopForm()) throw redirect("/");
  return { errors };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop && !shopForm()) throw redirect("/");
  // A store this deployment doesn't serve never reaches Shopify's install.
  refuseShop(shop);
  return formOrStart(loginErrorMessage(await login(request)));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = (await request.clone().formData()).get("shop");
  if (!shop && !shopForm()) throw redirect("/");
  refuseShopInput(shop);
  return formOrStart(loginErrorMessage(await login(request)));
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page>
        <Form method="post">
        <s-section heading="Log in">
          <s-text-field
            name="shop"
            label="Shop domain"
            details="example.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.currentTarget.value)}
            autocomplete="on"
            error={errors.shop}
          ></s-text-field>
          <s-button type="submit">Log in</s-button>
        </s-section>
        </Form>
      </s-page>
    </>
  );
}
