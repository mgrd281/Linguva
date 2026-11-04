/**
 * What every console page needs from the frame: the interface language with
 * its formatters, and the signed-in admin's CSRF token and capabilities
 * (the layout's loader data; the pages' own loaders check again on the
 * server, these only decide what is shown).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatLanguage,
  formatMonth,
  formatNumber,
  formatPercent,
  formatShortDateTime,
  formatTime,
  formatUsd,
} from "../../admin/format";
import { adminDir, type AdminLocale } from "../../admin/locale";
import { adminT, type AdminMessageKey } from "../../admin/messages";

export interface AdminI18n {
  locale: AdminLocale;
  dir: "ltr" | "rtl";
  t(key: AdminMessageKey, vars?: Record<string, string | number>): string;
  number(value: number): string;
  compact(value: number): string;
  usd(value: number, options?: { cents?: boolean }): string;
  percent(ratio: number): string;
  date(iso: string): string;
  dateTime(iso: string): string;
  shortDateTime(iso: string): string;
  time(iso: string): string;
  month(period: string): string;
  language(code: string): string;
}

export function adminI18n(locale: AdminLocale): AdminI18n {
  return {
    locale,
    dir: adminDir(locale),
    t: (key, vars) => adminT(locale, key, vars),
    number: (value) => formatNumber(locale, value),
    compact: (value) => formatCompact(locale, value),
    usd: (value, options) => formatUsd(locale, value, options),
    percent: (ratio) => formatPercent(locale, ratio),
    date: (iso) => formatDate(locale, iso),
    dateTime: (iso) => formatDateTime(locale, iso),
    shortDateTime: (iso) => formatShortDateTime(locale, iso),
    time: (iso) => formatTime(locale, iso),
    month: (period) => formatMonth(locale, period),
    language: (code) => formatLanguage(locale, code),
  };
}

export interface AdminSessionView {
  email: string;
  role: "OWNER" | "FINANCE" | "SUPPORT" | "READONLY";
  csrfToken: string;
  can: { refresh: boolean; prices: boolean };
}

const I18nContext = createContext<AdminI18n>(adminI18n("en"));
const SessionContext = createContext<AdminSessionView | null>(null);

export function AdminProvider({ locale, session = null, children }: { locale: AdminLocale; session?: AdminSessionView | null; children: ReactNode }) {
  const i18n = useMemo(() => adminI18n(locale), [locale]);
  return (
    <I18nContext.Provider value={i18n}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </I18nContext.Provider>
  );
}

export function useAdminI18n(): AdminI18n {
  return useContext(I18nContext);
}

/** The signed-in admin (null on the sign-in page and error pages outside the frame). */
export function useAdminSession(): AdminSessionView | null {
  return useContext(SessionContext);
}
