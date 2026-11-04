/**
 * The console's building blocks (app/styles/admin.css): page header, cards,
 * KPI tiles, badges, notices, empty states, tables that scroll inside their
 * card, bars, fields and the error summary. No inline styles (the console's
 * policy forbids them): sizes come from classes and SVG attributes.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PLAN_LABEL, PLAN_TONE, STATUS_LABEL, type ConsolePlan, type Tone } from "../../admin/labels";
import { useAdminI18n } from "./context";
import { Icon, type IconName } from "./Icon";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="adm-sr">{children}</span>;
}

export function PageHeader({
  title,
  lead,
  actions,
  back,
  children,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="adm-pagehead">
      {back ? (
        <Link className="adm-back" to={back.to}>
          <Icon name="arrowLeft" size={16} />
          {back.label}
        </Link>
      ) : null}
      <div className="adm-pagehead__row">
        <div className="adm-pagehead__text">
          <h1 className="adm-h1">{title}</h1>
          {lead ? <p className="adm-lead">{lead}</p> : null}
        </div>
        {actions ? <div className="adm-pagehead__actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** A card with an h2; `flush` lets a table reach the card's edges. */
export function Card({
  id,
  title,
  lead,
  actions,
  icon,
  count,
  flush = false,
  className,
  children,
}: {
  id: string;
  title: string;
  /** A count next to the title (rows shown). */
  count?: string;
  lead?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("adm-card", className)} aria-labelledby={`${id}-title`}>
      <div className="adm-card__head">
        <div className="adm-card__titles">
          <h2 className="adm-h2" id={`${id}-title`}>
            {icon ? <Icon name={icon} size={18} className="adm-card__icon" /> : null}
            {title}
            {count !== undefined ? <span className="adm-count">{count}</span> : null}
          </h2>
          {lead ? <p className="adm-card__lead">{lead}</p> : null}
        </div>
        {actions ? <div className="adm-card__actions">{actions}</div> : null}
      </div>
      <div className={cx("adm-card__body", flush && "adm-card__body--flush")}>{children}</div>
    </section>
  );
}

/** A KPI: label, the figure, one line of context. */
export function Kpi({ label, value, context, icon, title }: { label: string; value: string; context?: ReactNode; icon: IconName; title?: string }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__label">
        <span className="adm-kpi__icon">
          <Icon name={icon} size={16} />
        </span>
        {label}
      </div>
      <div className="adm-kpi__value" title={title}>
        {value}
      </div>
      {context ? <div className="adm-kpi__context">{context}</div> : null}
    </div>
  );
}

export function KpiGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="adm-kpis" aria-label={label}>
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`adm-badge adm-badge--${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

const PLAN_ICON: Record<ConsolePlan, IconName> = {
  free: "layers",
  starter: "layers",
  pro: "layers",
  business: "layers",
  "own-key": "key",
  complimentary: "gift",
  unknown: "alert",
};

export function PlanBadge({ plan }: { plan: ConsolePlan }) {
  const { t } = useAdminI18n();
  return (
    <Badge tone={PLAN_TONE[plan]} icon={PLAN_ICON[plan]}>
      {t(PLAN_LABEL[plan])}
    </Badge>
  );
}

export function StoreStatusBadge({ status }: { status: "ACTIVE" | "UNINSTALLED" }) {
  const { t } = useAdminI18n();
  return (
    <Badge tone={status === "ACTIVE" ? "success" : "neutral"} icon={status === "ACTIVE" ? "check" : "minus"}>
      {t(STATUS_LABEL[status])}
    </Badge>
  );
}

/** The marks next to a plan: trial, cancelling, a plan change waiting. */
export function SubscriptionMarks({ inTrial, cancelling, pendingPlan }: { inTrial: boolean; cancelling: boolean; pendingPlan?: ConsolePlan | null }) {
  const { t } = useAdminI18n();
  return (
    <>
      {inTrial ? (
        <Badge tone="info" icon="clock">
          {t("mark.trial")}
        </Badge>
      ) : null}
      {cancelling ? (
        <Badge tone="warning" icon="cross">
          {t("mark.cancelling")}
        </Badge>
      ) : null}
      {pendingPlan ? (
        <Badge tone="neutral" icon="arrowRight">
          {t("mark.pending", { plan: t(PLAN_LABEL[pendingPlan]) })}
        </Badge>
      ) : null}
    </>
  );
}

const NOTICE_ICON: Record<"info" | "success" | "warning" | "critical", IconName> = { info: "info", success: "check", warning: "alert", critical: "alert" };

export function Notice({
  tone = "info",
  title,
  children,
  role,
  id,
}: {
  tone?: "info" | "success" | "warning" | "critical";
  title: string;
  children?: ReactNode;
  role?: "status" | "alert";
  id?: string;
}) {
  return (
    <div className={`adm-notice adm-notice--${tone}`} role={role} id={id} tabIndex={id ? -1 : undefined}>
      <Icon name={NOTICE_ICON[tone]} size={20} className="adm-notice__icon" />
      <div className="adm-notice__text">
        <p className="adm-notice__title">{title}</p>
        {children ? <div className="adm-notice__body">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="adm-empty__title">{title}</p>
      {body ? <p className="adm-empty__body">{body}</p> : null}
      {action ? <div className="adm-empty__action">{action}</div> : null}
    </div>
  );
}

/**
 * A table that scrolls sideways inside its card on narrow screens (never the
 * page), focusable so the keyboard can scroll it, with a caption.
 */
export function Table({ caption, className, children }: { caption: string; className?: string; children: ReactNode }) {
  const { t } = useAdminI18n();
  return (
    // A scrolling region must be reachable by keyboard (WCAG 2.1.1); it is named by the table's caption.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="adm-table-wrap" role="region" aria-label={t("common.scrollTable", { name: caption })} tabIndex={0}>
      <table className={cx("adm-table", className)}>
        <caption className="adm-sr">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** A horizontal bar (SVG: no inline style), `value` of `max`; mirrored right to left by admin.css. */
export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: Tone }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  // A non-zero value stays visible as a sliver.
  const width = share === 0 ? 0 : Math.max(share * 100, 1.5);
  return (
    <svg className={`adm-bar adm-bar--${tone}`} width="100%" height="8" aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <rect className="adm-bar__track" x="0" y="0" width="100%" height="8" rx="4" />
      {width > 0 ? <rect className="adm-bar__fill" x="0" y="0" width={`${width.toFixed(2)}%`} height="8" rx="4" /> : null}
    </svg>
  );
}

/** Term and value pairs (a subscription's fields, a grant's). */
export function Facts({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="adm-facts">
      {items.map((item) => (
        <div className="adm-facts__row" key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A store's name and domain, linking to its page. */
export function StoreCell({ id, name, domain }: { id: string; name: string | null; domain: string }) {
  const { t } = useAdminI18n();
  // A long domain wraps before ".myshopify.com", never inside the store's handle.
  const dot = domain.indexOf(".");
  return (
    <Link className="adm-store" to={`/admin/customers/${id}`}>
      <span className="adm-store__name">{name ?? t("common.unnamed")}</span>
      <bdi className="adm-store__domain">
        {dot > 0 ? (
          <>
            <span className="adm-nowrap">{domain.slice(0, dot)}</span>
            <wbr />
            {domain.slice(dot)}
          </>
        ) : (
          domain
        )}
      </bdi>
    </Link>
  );
}

/** Errors of a form, each linking to its field (shown above the form, focused after a failed save). */
export function ErrorSummary({ id, title, errors }: { id: string; title: string; errors: Array<{ field: string; message: string }> }) {
  if (errors.length === 0) return null;
  return (
    <div className="adm-notice adm-notice--critical adm-errsum" role="alert" id={id} tabIndex={-1} aria-labelledby={`${id}-title`}>
      <Icon name="alert" size={20} className="adm-notice__icon" />
      <div className="adm-notice__text">
        <p className="adm-notice__title" id={`${id}-title`}>
          {title}
        </p>
        <ul className="adm-errsum__list">
          {errors.map((error) => (
            <li key={`${error.field}:${error.message}`}>
              <a href={`#${error.field}`}>{error.message}</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="adm-field__error" id={id}>
      <Icon name="alert" size={14} />
      {message}
    </p>
  );
}

/** A label, the control, an optional hint and error (the control gets aria-describedby from `describedBy`). */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className={cx("adm-field", error && "adm-field--invalid")}>
      <label className="adm-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="adm-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function describedBy(id: string, { hint = false, error = false }: { hint?: boolean; error?: boolean }): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
