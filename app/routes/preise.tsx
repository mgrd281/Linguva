import type { LoaderFunctionArgs } from "react-router";

import { getPriceTable } from "../.server/admin/prices";
import { getConfig } from "../.server/lib/config";
import { sitePage } from "../.server/site/pages";

// The list prices: the admin console's (read at most every 30 s), else the defaults; never an error page.
export const loader = async ({ request }: LoaderFunctionArgs) => sitePage(request, "pricing", getConfig(), await getPriceTable());
