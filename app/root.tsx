import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import { resolveLocale } from "./i18n/i18n";

// Page title for assistive technology and browser tabs (the admin shows each page's heading).
export const meta: MetaFunction = () => [{ title: "Linguva" }];

/**
 * The interface language, from Shopify's `locale` parameter on the page
 * request (the admin user's language), else the browser's languages.
 */
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return { locale: resolveLocale(url.searchParams.get("locale"), request.headers.get("accept-language")) };
};

// Decided once per page load: navigation inside the app doesn't carry `locale`.
export const shouldRevalidate = () => false;

export default function App() {
  const { locale } = useLoaderData<typeof loader>();
  return (
    <html lang={locale}>
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
