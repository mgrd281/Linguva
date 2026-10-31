import type { LoaderFunctionArgs } from "react-router";

import { sitePage } from "../.server/site/pages";

// The app's privacy policy (en, de). 404 unless PUBLIC_PAGES=on.
export const loader = async ({ request }: LoaderFunctionArgs) => sitePage(request, "appPrivacy");
