import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadEditorData, resolveEditorContext, runEditorAction } from "../.server/translation/resource-editor";
import { ResourceTranslationEditor } from "../components/ResourceTranslationEditor";
import { contentTypeBySlug } from "../lib/resource-kinds";

function typeOf(slug: string | undefined) {
  const type = contentTypeBySlug(slug ?? "");
  if (!type) throw new Response("Not found", { status: 404 });
  return type;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) =>
  loadEditorData(await resolveEditorContext(request, typeOf(params.type), params.ref));

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await resolveEditorContext(request, typeOf(params.type), params.ref);
  return runEditorAction(context, await request.formData());
};

export default ResourceTranslationEditor;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
