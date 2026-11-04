/**
 * The admin console's sign-in page (/admin/login), outside the frame: the
 * console must be on here (requireAdminConsole: 404 otherwise, before
 * anything else); an admin already signed in goes on to the console. The
 * form posts natively (a fresh page load either way); signIn checks the
 * e-mail, password and code, limits attempts and audits each one.
 */
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { requireAdminConsole, safeNext } from "../.server/admin/auth";
import { signIn } from "../.server/admin/login";
import { readSession } from "../.server/admin/session";
import { adminLocaleOf, languageSwitch } from "../admin/locale";
import { adminTitle } from "../admin/meta";
import { AdminProvider } from "../components/admin/context";
import { StandalonePage } from "../components/admin/Shell";
import { SignInView, type SignInError } from "../components/admin/SignInView";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdminConsole(request);
  const switched = languageSwitch(request);
  if (switched) throw redirect(switched.location, switched.cookie ? { headers: { "Set-Cookie": switched.cookie } } : undefined);
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (await readSession(request)) throw redirect(next);
  return { locale: adminLocaleOf(request), next };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdminConsole(request);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const next = safeNext(field("next"));
  const result = await signIn(request, { email: field("email"), password: field("password"), code: field("code") });
  if (result.ok) throw redirect(next, { headers: { "Set-Cookie": result.cookie } });
  // The e-mail is shown again (never the password or the code).
  const email = field("email").trim().slice(0, 254);
  return data({ error: result.error as SignInError, email }, { status: result.error === "INVALID" ? 401 : 429 });
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "login.title");

export default function AdminSignIn() {
  const { locale, next } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <AdminProvider locale={locale}>
      <StandalonePage>
        <SignInView next={next} error={result?.error ?? null} email={result?.email} />
      </StandalonePage>
    </AdminProvider>
  );
}
