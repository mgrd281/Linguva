/**
 * The console's building blocks (app/styles/admin.css): page header, cards,
 * KPI tiles, badges, notices, empty states, tables that scroll inside their
 * card (or become a stack of cards on a phone), bars, fields and the error
 * summary. No inline styles (the console's policy forbids them): sizes come
 * from classes and SVG attributes.
 */
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, type ReactElement, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { PLAN_LABEL, PLAN_TONE, STATUS_LABEL, type ConsolePlan, type Tone } from "../../admin/labels";
import { useAdminI18n } from "./context";
import { applyFormValues, jumpTo } from "./dom";
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
  /** Free text (a store's name) comes wrapped in <bdi>, so a right-to-left page shows its punctuation where it belongs. */
  title: ReactNode;
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

/**
 * The marks next to a plan: trial, cancelling, a plan change waiting, and
 * Shopify not asked since the store was (re)installed (its cached answer
 * was reset; the plan is unknown until the app asks again).
 */
export function SubscriptionMarks({
  inTrial,
  cancelling,
  pendingPlan,
  notChecked = false,
}: {
  inTrial: boolean;
  cancelling: boolean;
  pendingPlan?: ConsolePlan | null;
  notChecked?: boolean;
}) {
  const { t } = useAdminI18n();
  return (
    <>
      {notChecked ? (
        <Badge tone="neutral" icon="clock">
          {t("mark.notChecked")}
        </Badge>
      ) : null}
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
 *
 * `cards`: below 720 px each row becomes a card (admin.css), its row header
 * on top and every other cell under its column's name, in 2 or 3 columns,
 * so nothing hides off-screen on a phone. A cell with the class
 * `adm-cell--plain` shows no name (badges that speak for themselves);
 * `adm-cell--wide` takes the card's whole width. Inside the console's frame
 * that is the default (CardTables in AdminShell); `cards={false}` keeps a
 * narrow table a table.
 */
export function Table({ caption, className, cards: own, children }: { caption: string; className?: string; cards?: 2 | 3 | false; children: ReactNode }) {
  const { t } = useAdminI18n();
  const inherited = useContext(CardsContext);
  const cards = own ?? inherited;
  return (
    // A scrolling region must be reachable by keyboard (WCAG 2.1.1); it is named by the table's caption.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="adm-table-wrap" role="region" aria-label={t("common.scrollTable", { name: caption })} tabIndex={0}>
      <table className={cx("adm-table", cards && `adm-table--cards adm-table--cards-${cards}`, className)} role={cards ? "table" : undefined}>
        <caption className="adm-sr">{caption}</caption>
        {cards ? asCards(children) : children}
      </table>
    </div>
  );
}

const CardsContext = createContext<2 | 3 | undefined>(undefined);

/**
 * Every Table inside becomes cards on a phone, as with `cards`, unless it
 * says `cards={false}`. The frame sets it for every page (a table someone
 * adds never hides columns off a phone's screen); a view sets it for a
 * table another component draws (Activity shows the Prices page's history).
 */
export function CardTables({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return <CardsContext.Provider value={columns}>{children}</CardsContext.Provider>;
}

type Part = ReactElement<{ children?: ReactNode; scope?: string }>;

const isPart = (node: ReactNode): node is Part => isValidElement(node);

/** The text of a header cell ("Installed"), for the card's labels. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isPart(node) ? textOf(node.props.children) : "";
}

/**
 * The card form's markup: each body cell gets its column's name
 * (`data-label`, from the head row; admin.css shows it on a phone), and
 * every part gets its ARIA table role. A table whose rows are laid out as
 * blocks loses its table semantics in some browsers (Safari); the roles
 * keep the headers announced with each cell.
 */
function asCards(children: ReactNode): ReactNode {
  const head = Children.toArray(children).find((part) => isPart(part) && part.type === "thead") as Part | undefined;
  const headRow = head ? (Children.toArray(head.props.children).find(isPart) as Part | undefined) : undefined;
  // Children.map counts empty slots too, so a label's index is its cell's column.
  const labels: string[] = headRow ? (Children.map(headRow.props.children, (cell) => (isPart(cell) ? textOf(cell.props.children).trim() : "")) ?? []) : [];
  return Children.map(children, (section) => {
    if (!isPart(section)) return section;
    const body = section.type !== "thead";
    return cloneElement(
      section,
      { role: "rowgroup" } as object,
      Children.map(section.props.children, (row) =>
        isPart(row)
          ? cloneElement(
              row,
              { role: "row" } as object,
              Children.map(row.props.children, (cell, index) => {
                if (!isPart(cell)) return cell;
                const role = cell.type === "th" ? (cell.props.scope === "row" ? "rowheader" : "columnheader") : "cell";
                // The row header names the card itself: no label over it.
                const label = body && role !== "rowheader" ? labels[index] : undefined;
                return cloneElement(cell, { role, ...(label ? { "data-label": label } : {}) } as object);
              }),
            )
          : row,
      ),
    );
  });
}

/** A non-zero share stays visible as a sliver. */
const barWidth = (value: number, max: number) => {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return share === 0 ? 0 : Math.max(share * 100, 1.5);
};

/**
 * A horizontal bar (SVG: no inline style), `value` of `max`; mirrored right
 * to left by admin.css. `extra` adds a second segment after the first, in
 * the "teal" tone (a store's own-key characters after Linguva's).
 */
export function Bar({ value, max, tone = "accent", extra = 0 }: { value: number; max: number; tone?: Tone; extra?: number }) {
  const width = barWidth(value, max);
  const extraWidth = extra > 0 ? Math.min(100 - width, barWidth(extra, max)) : 0;
  return (
    <svg className={`adm-bar adm-bar--${tone}`} width="100%" height="8" aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <rect className="adm-bar__track" x="0" y="0" width="100%" height="8" rx="4" />
      {extraWidth > 0 ? <rect className="adm-bar__extra" x="0" y="0" width={`${(width + extraWidth).toFixed(2)}%`} height="8" rx="4" /> : null}
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
      <bdi className="adm-store__name">{name ?? t("common.unnamed")}</bdi>
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
              {/* To the field without a navigation: one would drop the result that holds these errors. */}
              <a href={`#${error.field}`} onClick={(event) => jumpTo(event, error.field)}>
                {error.message}
              </a>
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

/**
 * Keeps an uncontrolled GET form (filters that work without JavaScript)
 * showing `values`, the filters of the URL now shown, after "Clear
 * filters", Back or Forward. Remounting the form instead would take the
 * focus from the field just changed.
 */
export function useFormValues(form: RefObject<HTMLFormElement | null>, values: Record<string, string | boolean>): void {
  const key = JSON.stringify(values);
  useEffect(() => {
    if (form.current) applyFormValues(form.current, JSON.parse(key) as Record<string, string | boolean>);
  }, [form, key]);
}
