/**
 * The old list of blog posts (`/app/articles`): the app has one list per area, the
 * area's (`/app/languages/<locale>/blog`), in the language this list would have
 * opened in (`?lang`, else the first visible one); without a language, Content.
 * The editors (`/app/articles/<id>`) stay where they are.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirectToAreaList } from "../.server/translation/resource-list";

export const loader = ({ request }: LoaderFunctionArgs) => redirectToAreaList(request, "blog");
