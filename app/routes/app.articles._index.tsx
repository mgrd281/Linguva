import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";
import { ResourceList } from "../components/ResourceList";

export const loader = ({ request }: LoaderFunctionArgs) => loadResourceList(request, "ARTICLE");

export const action = ({ request }: ActionFunctionArgs) => runResourceListAction(request, "ARTICLE");

export default ResourceList;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
