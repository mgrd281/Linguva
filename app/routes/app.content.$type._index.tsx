import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";
import { ResourceList } from "../components/ResourceList";
import { contentTypeBySlug } from "../lib/resource-kinds";

function typeOf(slug: string | undefined) {
  const type = contentTypeBySlug(slug ?? "");
  if (!type) throw new Response("Not found", { status: 404 });
  return type;
}

export const loader = ({ request, params }: LoaderFunctionArgs) => loadResourceList(request, typeOf(params.type));

export const action = ({ request, params }: ActionFunctionArgs) => runResourceListAction(request, typeOf(params.type));

export default ResourceList;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
