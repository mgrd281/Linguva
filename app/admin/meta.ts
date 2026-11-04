/**
 * Page titles of the admin console ("Customers · Linguva Admin"), in the
 * interface language the frame's or the sign-in page's loader chose.
 */
import { isAdminLocale, type AdminLocale } from "./locale";
import { adminT, type AdminMessageKey } from "./messages";

export const ADMIN_TITLE = "Linguva Admin";

/** The locale in the matched console routes' data (the frame, or the sign-in page), else English. */
export function metaLocale(matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>): AdminLocale {
  for (const match of matches) {
    const data = match?.loaderData as { locale?: unknown } | null | undefined;
    if (data && isAdminLocale(data.locale)) return data.locale;
  }
  return "en";
}

export function adminTitle(matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>, key: AdminMessageKey | null = null): Array<{ title: string }> {
  return [{ title: key ? `${adminT(metaLocale(matches), key)} · ${ADMIN_TITLE}` : ADMIN_TITLE }];
}
