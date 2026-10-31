import type { LoaderFunctionArgs } from "react-router";

import { sitePage } from "../.server/site/pages";

// Help, contact and FAQ (en, de; FAQ at #faq). 404 unless PUBLIC_PAGES=on.
export const loader = async ({ request }: LoaderFunctionArgs) => sitePage(request, "support");
