/**
 * The old list of collections (`/app/collections`): the app has one list per area, the
 * area's (`/app/languages/<locale>/collections`), in the language this list would have
 * opened in (`?lang`, else the first visible one); without a language, Content.
 * The editors (`/app/collections/<id>`) stay where they are.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirectToAreaList } from "../.server/translation/resource-list";

export const loader = ({ request }: LoaderFunctionArgs) => redirectToAreaList(request, "collections");
