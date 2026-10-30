/**
 * Content ("Inhalte", `/app/content`): everything in the store Linguva can
 * translate, in the language page's areas, and how far one language is in
 * each. A row of flags picks the language (kept in `?lang`); each area is
 * one card that opens its list. One card asks for every missing permission
 * at once; what isn't in the store or can't be read is folded away.
 *
 * The page's only buttons: "Allow access" (the primary one), counting when
 * the language needs it, "Load again" when Shopify didn't answer, and
 * "Show" beside the select of a store with many languages. It reloads every
 * few seconds only while a count reads the language; the areas' pictures
 * load after the page (the language page's previews).
 */
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadContentPage, type ContentArea } from "../.server/content/content-page";
import { clearContentHubCache, scopesToRequest } from "../.server/translation/content-hub";
import { startMeasurement } from "../.server/coverage/dashboard";
import type { clientLoader as previewsLoader } from "./app.languages_.$locale_.previews";
import { AccessCard, Areas, CountCard, Folds, LanguageChips, LanguageMeta, MoreTexts, NoLanguagesCard, NothingCard, partName, countNotice, type TilePictures } from "../components/ContentTiles";
import { BIG_HEADING, languageErrorText } from "../components/LanguageLayout";
import { useI18n } from "../i18n/react";
import { languageList } from "../lib/name-lists";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const url = new URL(request.url);
  const granted = (await scopes.query()).granted;
  return loadContentPage(admin, shop, { granted, lang: url.searchParams.get("lang"), open: url.searchParams.get("open") });
};

/**
 * Ask Shopify for the missing optional permissions (intent "request-scope",
 * one or more allow-listed scopes, all on one Shopify screen), or count the
 * store (intent "run"). The shop comes from the verified session only.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, scopes, actorId } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "request-scope") {
    // Only the optional scopes declared for content types, every value checked: anything else asks for nothing.
    const wanted = scopesToRequest(form.getAll("scope"));
    if (!wanted) return { ok: false as const };
    clearContentHubCache(shop.id);
    // Redirects to Shopify's permission screen; returns when all are granted already.
    await scopes.request(wanted);
    return { ok: true as const };
  }
  if (intent === "run") return startMeasurement(admin, shop, { idempotencyKey: String(form.get("idempotencyKey") ?? ""), requestedBy: actorId });
  return { ok: false as const };
};

/** How often the page reloads while a count reads the chosen language (never otherwise). */
const POLL_MS = 5_000;

export default function ContentPage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const grant = useFetcher<typeof action>();
  const counter = useFetcher<typeof action>();
  const previews = useFetcher<typeof previewsLoader>();
  const revalidator = useRevalidator();
  const locale = data.language?.locale ?? null;

  // Follow a count of this language while it runs.
  useEffect(() => {
    if (!data.scanning) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [data.scanning, revalidator]);

  // Pictures of a few items per area, once the page is shown (the language page's previews, kept a minute).
  const withPictures = data.areas.some((a) => a.pictures);
  const loadPreviews = previews.load;
  useEffect(() => {
    if (locale && withPictures) loadPreviews(`/app/languages/${encodeURIComponent(locale)}/previews`);
  }, [locale, withPictures, loadPreviews]);

  const picturesOf = (area: ContentArea): TilePictures => {
    if (!area.pictures) return undefined;
    if (previews.state !== "idle" || !previews.data) return null;
    const preview = previews.data[area.id];
    if (!preview || preview.error) return [];
    return preview.items.flatMap((item) => (item.image ? [{ url: item.image.url }] : [])).slice(0, 4);
  };

  const countError = counter.data && "error" in counter.data ? counter.data.error : null;
  const access = data.access.length > 0;
  // "Allow access" is the page's one primary button while it shows; without a language, adding one comes first.
  const accessPrimary = access && data.language !== null;

  return (
    <s-page heading={t("common.nav.content")}>
      <s-query-container>
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-500">
            <h1 style={BIG_HEADING}>{t("common.nav.content")}</h1>
            <s-text color="subdued">{t("content.subtitle")}</s-text>
          </s-stack>

          {data.language ? (
            <s-stack direction="block" gap="small-200">
              <LanguageChips languages={data.languages} current={data.language.locale} i18n={i18n} />
              <LanguageMeta data={data} i18n={i18n} />
            </s-stack>
          ) : (
            <NoLanguagesCard i18n={i18n} />
          )}

          {access ? <AccessCard rows={data.access} fetcher={grant} i18n={i18n} primary={accessPrimary} /> : null}

          {countNotice(data) ? <CountCard data={data} i18n={i18n} counter={counter} primary={!access} /> : null}
          {countError ? (
            <s-banner tone="critical">
              <s-paragraph>{languageErrorText(i18n, countError)}</s-paragraph>
            </s-banner>
          ) : null}
          {data.unknown.length ? (
            <s-banner tone="warning" heading={t("content.unknown.heading")}>
              <s-paragraph>{t("content.unknown.body", { parts: languageList(i18n, data.unknown.map((type) => partName(i18n, type))) })}</s-paragraph>
              <s-button slot="secondary-actions" onClick={() => revalidator.revalidate()} {...(revalidator.state !== "idle" ? { loading: true } : {})}>
                {t("content.unknown.retry")}
              </s-button>
            </s-banner>
          ) : null}

          {data.nothing ? (
            <NothingCard i18n={i18n} />
          ) : (
            <Areas areas={data.areas} i18n={i18n} picturesOf={picturesOf} withKey={data.language !== null} />
          )}
          <MoreTexts key={`${locale}|${data.open}`} extras={data.extras} open={data.open} i18n={i18n} />
          <Folds empty={data.empty} unavailable={data.unavailable} i18n={i18n} />
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
