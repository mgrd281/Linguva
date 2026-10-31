import type { LoaderFunctionArgs } from "react-router";

import { sitePage } from "../.server/site/pages";

export const loader = async ({ request }: LoaderFunctionArgs) => sitePage(request, "imprint");
