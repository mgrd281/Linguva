/**
 * The sign-in page's form: e-mail, password and the authenticator code in
 * one plain form (it works without JavaScript and ends in a fresh page
 * load), one generic message whatever was wrong.
 */
import { useAdminI18n } from "./context";
import { BrandMark, Icon } from "./Icon";
import { Notice } from "./ui";

export type SignInError = "INVALID" | "LOCKED" | "RATE_LIMITED";

export function SignInView({ next, error, email }: { next: string; error?: SignInError | null; email?: string }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-signin">
      <div className="adm-signin__head">
        <BrandMark size={40} />
        <h1 className="adm-h1">{t("login.title")}</h1>
        <p className="adm-lead">{t("login.lead")}</p>
      </div>
      {error ? <Notice tone="critical" role="alert" id="signin-error" title={error === "INVALID" ? t("login.errorInvalid") : t("login.errorLocked")} /> : null}
      <form className="adm-signin__form" method="post" action={next === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(next)}`}>
        <input type="hidden" name="next" value={next} />
        <div className="adm-field">
          <label className="adm-label" htmlFor="email">
            {t("login.email")}
          </label>
          <input
            className="adm-input"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            required
            dir="ltr"
            defaultValue={email}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="password">
            {t("login.password")}
          </label>
          <input className="adm-input" id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="code">
            {t("login.code")}
          </label>
          <input
            className="adm-input adm-input--code"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            dir="ltr"
            aria-describedby="code-hint"
          />
          <p className="adm-hint" id="code-hint">
            {t("login.codeHint")}
          </p>
        </div>
        <button type="submit" className="adm-btn adm-btn--primary adm-btn--block">
          <Icon name="lock" size={16} />
          {t("login.submit")}
        </button>
      </form>
      <p className="adm-signin__help">{t("login.help")}</p>
    </div>
  );
}
