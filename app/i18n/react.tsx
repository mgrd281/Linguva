import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import { translator, type AppLocale, type I18n } from "./i18n";

const I18nContext = createContext<I18n>(translator("en"));

/**
 * Texts in `locale`; instants in the store's `timeZone`, which comes from
 * loader data (never from the browser), so the server and the browser render
 * the same text. Without a zone, instants are shown in UTC, named as such.
 */
export function I18nProvider({ locale, timeZone, children }: { locale: AppLocale; timeZone?: string | null; children: ReactNode }) {
  const value = useMemo(() => translator(locale, { timeZone }), [locale, timeZone]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Texts, numbers and dates in the merchant's language, instants in the store's time zone. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** The language resolved by the root loader on the page request. */
export function useAppLocale(): AppLocale {
  const data = useRouteLoaderData("root") as { locale?: AppLocale } | undefined;
  return data?.locale ?? "en";
}
