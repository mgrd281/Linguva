/**
 * Activity (/admin/activity): the list price changes (who, when, why) and
 * the recent sign-ins to the console.
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { loadActivity } from "../.server/admin/activity";
import { requireAdmin } from "../.server/admin/auth";
import { adminTitle } from "../admin/meta";
import { ActivityView } from "../components/admin/ActivityView";
import { AdminPageError } from "../components/admin/AdminPageError";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  return loadActivity();
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.activity");

export default function AdminActivity() {
  const data = useLoaderData<typeof loader>();
  return <ActivityView priceChanges={data.priceChanges} signIns={data.signIns} />;
}

export const ErrorBoundary = AdminPageError;
