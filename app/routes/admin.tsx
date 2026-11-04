/**
 * The admin console's frame (docs/SECURITY_MODEL.md §5s): every page under
 * /admin, for signed-in admins only (requireAdmin: 404 unless the console
 * is on here, else the sign-in page). Header, navigation and the language
 * (`?lang=` stores the choice in a cookie and drops the parameter). Each
 * page's own loader and action check the admin again: React Router runs a
 * child's action without this loader.
 */
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { isRouteErrorResponse, Outlet, redirect, useLoaderData, useRouteError, useRouteLoaderData } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { adminLocaleOf, isAdminLocale, languageSwitch, type AdminLocale } from "../admin/locale";
import { adminTitle } from "../admin/meta";
import { AdminProvider, type AdminSessionView } from "../components/admin/context";
import { AdminErrorView, AdminShell, errorKind, StandalonePage } from "../components/admin/Shell";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await requireAdmin(request, "view");
  const switched = languageSwitch(request);
  if (switched) throw redirect(switched.location, switched.cookie ? { headers: { "Set-Cookie": switched.cookie } } : undefined);
  return {
    user: { email: ctx.user.email },
    role: ctx.user.role,
    csrfToken: ctx.csrfToken,
    locale: adminLocaleOf(request),
    // `can` is a function on the server: the page gets the answers.
    can: { refresh: ctx.can("refresh"), prices: ctx.can("prices") },
  };
};

/**
 * Read once per page load: the admin, the CSRF token and the language don't
 * change while navigating (a language switch is a page load; signing out
 * ends on the sign-in page). Every page's own loader still checks the
 * session on each request.
 */
export const shouldRevalidate = () => false;

/** "Linguva Admin"; each page adds its own name ("Customers · Linguva Admin"). */
export const meta: MetaFunction = ({ matches }) => adminTitle(matches);

export default function AdminLayout() {
  const { user, role, csrfToken, locale, can } = useLoaderData<typeof loader>();
  const session: AdminSessionView = { email: user.email, role, csrfToken, can };
  return (
    <AdminProvider locale={locale} session={session}>
      <AdminShell>
        <Outlet />
      </AdminShell>
    </AdminProvider>
  );
}

/** The frame itself failed (console off: 404; an unexpected error): a page without navigation. */
export function ErrorBoundary() {
  const error = useRouteError();
  const root = useRouteLoaderData<{ adminLocale?: AdminLocale | null }>("root");
  const locale = isAdminLocale(root?.adminLocale) ? root.adminLocale : "en";
  return (
    <AdminProvider locale={locale}>
      <StandalonePage>
        <AdminErrorView kind={errorKind(isRouteErrorResponse(error) ? error.status : null)} backLink={false} />
      </StandalonePage>
    </AdminProvider>
  );
}
