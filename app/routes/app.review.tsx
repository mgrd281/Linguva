/**
 * "Übersetzungen prüfen" (/app/review): the AI and imported translations
 * waiting for the merchant's approval, one card per item and language,
 * decided per text, per card or per page. Nothing reaches customers
 * without an explicit press; every action posts exactly the texts it shows
 * with the version shown (tokens), and the page doesn't reload itself
 * after an action, so nothing unseen moves into it.
 *
 * The page reads only the database (review/page.ts); pictures load after
 * it (app.review_.previews.tsx). Approving publishes through the single
 * reviewed write path (approveDraftsDetailed → saveResourceTranslations).
 */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { approveDraftsDetailed, MAX_DRAFTS_PER_ACTION, rejectDraftsDetailed } from "../.server/review/drafts";
import { loadReviewPage } from "../.server/review/page";
import { ReviewPage } from "../components/ReviewPage";
import type { ReviewActionResult } from "../lib/review-view";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  return loadReviewPage(shop.id, new URL(request.url).searchParams);
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ReviewActionResult> => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = form.getAll("draft").map(String).slice(0, MAX_DRAFTS_PER_ACTION);
  // Each draft's version as the page showed it: one replaced since (a newer translation) is left alone.
  const tokens = new Map<string, string>();
  for (const id of ids) {
    const token = form.get(`token:${id}`);
    if (typeof token === "string") tokens.set(id, token);
  }

  if (intent === "reject") {
    const { rejected } = await rejectDraftsDetailed(shop.id, ids, actorId, undefined, tokens);
    const done = new Set(rejected);
    return {
      kind: "rejected",
      count: rejected.length,
      changed: Math.max(0, ids.length - rejected.length),
      outcomes: [...new Set(ids)].map((id) => (done.has(id) ? { id, status: "rejected" as const } : { id, status: "changed" as const })),
    };
  }
  if (intent === "approve") {
    // The texts the merchant edited, as typed: an emptied one is refused (EMPTY_TRANSLATION), never replaced by the draft.
    const edits = new Map<string, string>();
    // New web addresses, each approved on its own after the question that old links stop working.
    const confirmed = new Set<string>();
    for (const id of ids) {
      const value = form.get(`value:${id}`);
      if (typeof value === "string") edits.set(id, value);
      if (form.get(`confirm:${id}`) === "on") confirmed.add(id);
    }
    const result = await approveDraftsDetailed({ admin, shopId: shop.id, actorId, draftIds: ids, edits, tokens, handles: { confirmed } });
    return { kind: "approved", ...result };
  }
  return { kind: "error" };
};

// The page stays as the merchant sees it after an action (each text shows its outcome; nothing new moves in).
export const shouldRevalidate = ({ formMethod, currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formMethod === "POST" && currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;

export default function Review() {
  const data = useLoaderData<typeof loader>();
  return <ReviewPage data={data} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
