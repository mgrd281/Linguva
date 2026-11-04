/**
 * The admin console's overview (/admin): KPIs, the plan mix, trials ending
 * soon, the newest stores. `?refresh=1` reads the database again instead of
 * the directory kept for a minute.
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { loadDirectory } from "../.server/admin/directory";
import { summarize } from "../.server/admin/overview";
import { adminTitle } from "../admin/meta";
import { AdminPageError } from "../components/admin/AdminPageError";
import { OverviewView } from "../components/admin/OverviewView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const now = new Date();
  const dir = await loadDirectory({ force, now });
  return { summary: summarize(dir, now), builtAt: dir.builtAt };
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.overview");

export default function AdminOverview() {
  const data = useLoaderData<typeof loader>();
  return <OverviewView summary={data.summary} builtAt={data.builtAt} />;
}

export const ErrorBoundary = AdminPageError;
