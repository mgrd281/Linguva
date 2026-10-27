import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  loadEditorData,
  resolveEditorContext,
  runEditorAction,
} from "../.server/translation/resource-editor";
import { ResourceTranslationEditor } from "../components/ResourceTranslationEditor";

export const loader = async ({ request, params }: LoaderFunctionArgs) =>
  loadEditorData(await resolveEditorContext(request, "BLOG", params.id));

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await resolveEditorContext(request, "BLOG", params.id);
  return runEditorAction(context, await request.formData());
};

export default ResourceTranslationEditor;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
