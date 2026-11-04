/**
 * The console's frame: the top bar (mark, language, the signed-in admin,
 * sign out), the navigation (a sidebar from 960 px, a scrolling tab bar on
 * phones that brings the current page's tab into view) and the main area;
 * the language switch; and the error page. Everything works before (and
 * without) JavaScript: links and plain forms.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ROLE_LABEL } from "../../admin/labels";
import { languageHref, type AdminLocale } from "../../admin/locale";
import type { AdminMessageKey } from "../../admin/messages";
import { useAdminI18n, useAdminSession } from "./context";
import { jumpTo, revealCurrent } from "./dom";
import { BrandMark, Icon, type IconName } from "./Icon";
import { Badge, CardTables } from "./ui";

const NAV: Array<{ to: string; key: AdminMessageKey; icon: IconName; end?: boolean }> = [
  { to: "/admin", key: "nav.overview", icon: "overview", end: true },
  { to: "/admin/customers", key: "nav.customers", icon: "store" },
  { to: "/admin/subscriptions", key: "nav.subscriptions", icon: "card" },
  { to: "/admin/prices", key: "nav.prices", icon: "tag" },
  { to: "/admin/activity", key: "nav.activity", icon: "history" },
];

/** Each language in its own name; on a phone the short form (the full one stays the link's name). */
const LANGUAGES: Array<{ locale: AdminLocale; label: string; short: string }> = [
  { locale: "en", label: "English", short: "EN" },
  { locale: "ar", label: "العربية", short: "عربي" },
];

/** English | العربية: a link to this page in the other language (a full page load: the loader stores the choice). */
export function LanguageSwitch() {
  const { t, locale } = useAdminI18n();
  const { pathname, search } = useLocation();
  return (
    <nav className="adm-lang" aria-label={t("shell.language")}>
      <Icon name="globe" size={16} className="adm-lang__icon" />
      {LANGUAGES.map((language) => (
        <a
          key={language.locale}
          className="adm-lang__link"
          href={languageHref(pathname, search, language.locale)}
          lang={language.locale}
          hrefLang={language.locale}
          aria-current={language.locale === locale ? "true" : undefined}
        >
          <span className="adm-lang__full">{language.label}</span>
          <span className="adm-lang__short" aria-hidden="true">
            {language.short}
          </span>
        </a>
      ))}
    </nav>
  );
}

/**
 * "Skip to content": focuses the main area without a navigation (React
 * Router would treat the fragment as one and drop the page's action
 * result, such as a "saved" notice or the errors of a form).
 */
function SkipLink() {
  const { t } = useAdminI18n();
  return (
    <a className="adm-skip" href="#main" onClick={(event) => jumpTo(event, "main", { block: "start" })}>
      {t("shell.skip")}
    </a>
  );
}

function Brand() {
  const { t } = useAdminI18n();
  return (
    <Link className="adm-brand" to="/admin">
      <BrandMark />
      <span className="adm-brand__name">Linguva</span>
      <span className="adm-brand__tag">{t("shell.product")}</span>
    </Link>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useAdminI18n();
  const session = useAdminSession();
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  // On a phone the tabs scroll sideways: the current one is brought into view (Prices and Activity start off-screen).
  useEffect(() => {
    revealCurrent(nav.current);
  }, [pathname]);
  return (
    <div className="adm-app">
      <SkipLink />
      <header className="adm-top">
        <Brand />
        <div className="adm-top__end">
          <LanguageSwitch />
          {session ? (
            <>
              {/* On a phone this takes its own row under the bar (admin.css): who is signed in, and as what, stays visible. */}
              <p className="adm-account">
                <span className="adm-account__label">{`${t("shell.account")} `}</span>
                <bdi className="adm-account__email">{session.email}</bdi>
                <Badge tone="neutral" icon="user">
                  {t(ROLE_LABEL[session.role])}
                </Badge>
              </p>
              {/* A plain form: signing out needs no JavaScript and ends in a fresh page load. */}
              <form className="adm-signout" method="post" action="/admin/logout">
                <input type="hidden" name="_csrf" value={session.csrfToken} />
                <button type="submit" className="adm-btn adm-btn--ghost adm-btn--sm">
                  <Icon name="signOut" size={16} />
                  <span className="adm-signout__text">{t("shell.signOut")}</span>
                </button>
              </form>
            </>
          ) : null}
        </div>
      </header>
      <div className="adm-frame">
        <div className="adm-sidebar">
          <nav className="adm-nav" aria-label={t("shell.nav")} ref={nav}>
            <ul className="adm-nav__list">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink className="adm-nav__link" to={item.to} end={item.end} prefetch="intent">
                    <Icon name={item.icon} size={18} />
                    <span>{t(item.key)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <main className="adm-main" id="main" tabIndex={-1}>
          {/* Wide tables are cards on a phone, on every page (the Prices page's history too). */}
          <CardTables columns={2}>{children}</CardTables>
        </main>
      </div>
    </div>
  );
}

/** A page outside the frame (sign-in, an error before the admin is known): centred, with the mark and the language switch. */
export function StandalonePage({ children }: { children: ReactNode }) {
  return (
    <div className="adm-standalone">
      <SkipLink />
      <header className="adm-standalone__top">
        <Brand />
        <LanguageSwitch />
      </header>
      <main className="adm-standalone__main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export type ErrorKind = "notFound" | "forbidden" | "generic";

export function errorKind(status: number | null): ErrorKind {
  return status === 404 ? "notFound" : status === 403 ? "forbidden" : "generic";
}

const ERROR_TEXT: Record<ErrorKind, { title: AdminMessageKey; body: AdminMessageKey; icon: IconName }> = {
  notFound: { title: "error.notFoundTitle", body: "error.notFoundBody", icon: "search" },
  forbidden: { title: "error.forbiddenTitle", body: "error.forbiddenBody", icon: "lock" },
  generic: { title: "error.genericTitle", body: "error.genericBody", icon: "alert" },
};

/** The body of an error page (inside the frame, or standalone when the frame itself failed). */
export function AdminErrorView({ kind, backLink = true }: { kind: ErrorKind; backLink?: boolean }) {
  const { t } = useAdminI18n();
  const text = ERROR_TEXT[kind];
  return (
    <div className="adm-errorpage">
      <span className="adm-errorpage__icon">
        <Icon name={text.icon} size={24} />
      </span>
      <h1 className="adm-h1">{t(text.title)}</h1>
      <p className="adm-lead">{t(text.body)}</p>
      {backLink ? (
        <Link className="adm-btn adm-btn--secondary" to="/admin">
          <Icon name="arrowLeft" size={16} />
          {t("error.back")}
        </Link>
      ) : null}
    </div>
  );
}
