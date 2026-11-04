/**
 * Signing out of the admin console (POST /admin/logout, the frame's plain
 * form with the CSRF token): ends the session, removes the cookie, back to
 * the sign-in page. No page, so a resource route: its answers carry the
 * console's headers themselves (adminRedirect; requireAdmin's refusals do
 * too). A GET (a typed or followed link) signs nobody out: it answers like
 * any console URL, 404 while the console is off or on another host, else
 * the sign-in page or the console.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { signOut } from "../.server/admin/login";
import { adminRedirect } from "../.server/lib/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request, "view");
  throw adminRedirect(request, "/admin");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request, "view");
  return adminRedirect(request, "/admin/login", { status: 303, headers: { "Set-Cookie": await signOut(request) } });
};
