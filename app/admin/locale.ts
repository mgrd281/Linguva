/**
 * The admin console's interface language (client-safe): English or Arabic,
 * chosen with `?lang=` on any console page and kept in the `lv_admin_lang`
 * cookie for a year; without one, the browser's preferred language decides
 * (Arabic when it prefers Arabic, else English). Arabic is right to left,
 * with Western digits.
 */

export const ADMIN_LOCALES = ["en", "ar"] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const ADMIN_LANG_COOKIE = "lv_admin_lang";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function isAdminLocale(value: unknown): value is AdminLocale {
  return value === "en" || value === "ar";
}

export function adminDir(locale: AdminLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** /admin and below, as the console's routes match them (not /administrator, not /app). */
export function isAdminUrlPath(pathname: string): boolean {
  return /^\/admin(?:[/.]|$)/i.test(pathname);
}

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

/** The browser's choice between English and Arabic: the preferred one of the two (by q), English when neither is listed. */
export function localeFromAcceptLanguage(header: string | null): AdminLocale {
  const ranked = (header ?? "")
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { primary: tag.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.q > 0 && (entry.primary === "ar" || entry.primary === "en"))
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.primary === "ar" ? "ar" : "en";
}

/** `?lang=en|ar` on the request, if valid. */
export function requestedLocale(request: Request): AdminLocale | null {
  const lang = new URL(request.url).searchParams.get("lang");
  return isAdminLocale(lang) ? lang : null;
}

/** The language of this request: `?lang=`, else the cookie, else the browser's languages. */
export function adminLocaleOf(request: Request): AdminLocale {
  const cookie = cookieValue(request.headers.get("cookie"), ADMIN_LANG_COOKIE);
  return requestedLocale(request) ?? (isAdminLocale(cookie) ? cookie : localeFromAcceptLanguage(request.headers.get("accept-language")));
}

function viaHttps(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto")?.split(",").at(-1)?.trim().toLowerCase() === "https";
}

/** Set-Cookie for the chosen language: the console's paths only, a year, Lax (a link from elsewhere keeps the language), Secure over https. */
export function adminLangCookie(locale: AdminLocale, request: Request): string {
  return [`${ADMIN_LANG_COOKIE}=${locale}`, "Path=/admin", `Max-Age=${ONE_YEAR_SECONDS}`, "SameSite=Lax", ...(viaHttps(request) ? ["Secure"] : [])].join("; ");
}

/**
 * For a page asked for with `?lang=`: where to go without it (same path and
 * other parameters) and the cookie that keeps the choice; null without the
 * parameter.
 */
export function languageSwitch(request: Request): { location: string; cookie: string | null } | null {
  const locale = requestedLocale(request);
  if (!locale && !new URL(request.url).searchParams.has("lang")) return null;
  const url = new URL(request.url);
  url.searchParams.delete("lang");
  const location = `${url.pathname}${url.search}`;
  // An unknown value is dropped without changing the choice.
  return { location, cookie: locale ? adminLangCookie(locale, request) : null };
}

/** A link to the current page in another language (the loader stores the choice and drops the parameter). */
export function languageHref(pathname: string, search: string, locale: AdminLocale): string {
  const params = new URLSearchParams(search);
  params.delete("lang");
  params.set("lang", locale);
  return `${pathname}?${params.toString()}`;
}
