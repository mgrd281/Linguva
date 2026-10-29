import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import { translator, type AppLocale, type I18n } from "./i18n";

const I18nContext = createContext<I18n>(translator("en"));

export function I18nProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  const value = useMemo(() => translator(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Texts, numbers and dates in the merchant's language. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** The language resolved by the root loader on the page request. */
export function useAppLocale(): AppLocale {
  const data = useRouteLoaderData("root") as { locale?: AppLocale } | undefined;
  return data?.locale ?? "en";
}
