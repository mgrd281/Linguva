import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, useRouteLoaderData } from "react-router";
import { adminDir, adminLocaleOf, isAdminLocale, isAdminUrlPath, type AdminLocale } from "./admin/locale";
import { ADMIN_TITLE } from "./admin/meta";
import { resolveLocale } from "./i18n/i18n";
import uiStyles from "./styles/ui.css?url";

// The app's own controls (buttons, the segmented choice): app/styles/ui.css.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: uiStyles }];

// Page title for assistive technology and browser tabs (the admin shows each page's heading); the admin console's own.
export const meta: MetaFunction = ({ location }) => [{ title: isAdminUrlPath(location.pathname) ? ADMIN_TITLE : "Linguva" }];

/**
 * The interface language, from Shopify's `locale` parameter on the page
 * request (the admin user's language), else the browser's languages. The
 * admin console (/admin) has its own: English or Arabic (app/admin/locale.ts).
 */
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return {
    locale: resolveLocale(url.searchParams.get("locale"), request.headers.get("accept-language")),
    adminLocale: isAdminUrlPath(url.pathname) ? adminLocaleOf(request) : null,
  };
};

// Decided once per page load: navigation inside the app doesn't carry `locale`.
export const shouldRevalidate = () => false;

/** The console's language: what its frame or sign-in page decided, else this document's first answer. */
function useAdminLocale(fallback: AdminLocale | null): AdminLocale | null {
  const frame = useRouteLoaderData<{ locale?: unknown }>("routes/admin");
  const signIn = useRouteLoaderData<{ locale?: unknown }>("routes/admin_.login");
  if (isAdminLocale(frame?.locale)) return frame.locale;
  if (isAdminLocale(signIn?.locale)) return signIn.locale;
  return fallback;
}

export default function App() {
  const { locale, adminLocale: documentAdminLocale } = useLoaderData<typeof loader>();
  const adminLocale = useAdminLocale(documentAdminLocale);
  return (
    <html lang={adminLocale ?? locale} dir={adminLocale ? adminDir(adminLocale) : undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
