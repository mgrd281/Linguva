import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { sitePage } from "../../.server/site/pages";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify opens the app here with the shop in the address.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return sitePage(request, "home");
};
