/**
 * Signing out of the admin console (POST /admin/logout, the frame's plain
 * form with the CSRF token): ends the session, removes the cookie, back to
 * the sign-in page. Action only, so a resource route: no page renders, the
 * response carries the console's headers itself.
 */
import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../.server/admin/auth";
import { signOut } from "../.server/admin/login";
import { adminHeaders } from "../.server/lib/security-headers";

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request, "view");
  const headers = new Headers({ Location: "/admin/login", "Set-Cookie": await signOut(request) });
  adminHeaders(headers);
  return new Response(null, { status: 303, headers });
};
