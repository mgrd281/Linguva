import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { getPriceTable } from "../../.server/admin/prices";
import { getConfig } from "../../.server/lib/config";
import { sitePage } from "../../.server/site/pages";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify opens the app here with the shop in the address.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // The list prices: the admin console's (read at most every 30 s), else the defaults; never an error page.
  return sitePage(request, "home", getConfig(), await getPriceTable());
};
