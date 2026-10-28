import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { refuseShop, refuseShopInput } from "../../.server/shopify/require-shop";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // A store this deployment doesn't serve never reaches Shopify's install.
  refuseShop(new URL(request.url).searchParams.get("shop"));
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  refuseShopInput((await request.clone().formData()).get("shop"));
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
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
