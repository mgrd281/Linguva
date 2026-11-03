/**
 * The app's button (styles in app/styles/ui.css): a native <button>, or a
 * link for an address (React Router's Link inside the app, a plain <a> for
 * the admin's shopify:// addresses, other sites and downloads). It takes
 * s-button's props, so a page swaps one for the other:
 *
 * - variant primary / secondary (default) / tertiary, tone critical;
 * - type (button by default: never a form's submit by accident), onClick;
 * - href: inside the app through React Router, the admin's shopify://
 *   pages through window.open (App Bridge's documented way), else a link;
 * - commandFor + command open or close a Polaris dialog (s-modal) by its
 *   methods, as s-button's invoker command does;
 * - loading (a spinner in the words' place, disabled, aria-busy),
 *   disabled (a link without its address), icon (a Polaris icon before
 *   the words), accessibilityLabel (starts with the visible words, WCAG
 *   2.5.3), inlineSize "fill" (the full width).
 *
 * Buttons that Polaris places itself stay s-button: a dialog's actions
 * (slot primary-action / secondary-actions), a banner's, the page's.
 * `data-button` and `data-variant` let the UI tests find them.
 */
import type { MouseEvent, ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";
import type { IconName } from "../lib/icons";

type Command = "--auto" | "--show" | "--hide" | "--toggle" | "--copy";

export interface ButtonProps {
  children?: ReactNode;
  variant?: "primary" | "secondary" | "tertiary" | "auto";
  tone?: "critical" | "neutral" | "auto";
  href?: string;
  /** "_top", "_blank", … ("auto": the link's own). */
  target?: string;
  download?: string;
  type?: "button" | "submit" | "reset";
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  commandFor?: string;
  command?: Command;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  accessibilityLabel?: string;
  inlineSize?: "auto" | "fill" | "fit-content";
  /** A short word shown on hover (an icon-only button: its accessible name stays accessibilityLabel). */
  tooltip?: string;
  id?: string;
  lang?: string;
  /** Hooks for the page's own scripts and the tests (data-review-approve, …): passed on as they are. */
  [data: `data-${string}`]: string | undefined;
}

/** A Polaris dialog's own methods (s-modal): what an invoker command would call. */
interface Overlay {
  showOverlay?: () => void;
  hideOverlay?: () => void;
  toggleOverlay?: () => void;
}

function runCommand(target: string, command: Command | undefined) {
  const element = document.getElementById(target) as (HTMLElement & Overlay) | null;
  if (!element) return;
  if (command === "--hide") element.hideOverlay?.();
  else if (command === "--toggle") element.toggleOverlay?.();
  else element.showOverlay?.();
}

/**
 * An address inside the app, absolute ("/app/plan") or relative ("?after=…"): React Router navigates
 * there without reloading the embedded page (a reload would lose the admin's launch parameters). A
 * scheme (shopify:, https:), another host ("//…") or a jump on the page ("#…") isn't one.
 */
const inApp = (href: string) => !/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("//") && !href.startsWith("#");

export function Button(props: ButtonProps) {
  const {
    children,
    variant = "secondary",
    tone,
    href,
    target,
    download,
    type = "button",
    onClick,
    commandFor,
    command,
    loading = false,
    disabled = false,
    icon,
    accessibilityLabel,
    inlineSize,
    tooltip,
    id,
    lang,
  } = props;
  const data = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
  // Outside a router (a component rendered on its own, as in the unit tests) an address is a plain link.
  const routed = useInRouterContext();
  const look = variant === "auto" ? "secondary" : variant;
  const iconOnly = Boolean(icon) && (children === undefined || children === null || children === false);
  const className = [
    "lv-btn",
    `lv-btn--${look}`,
    tone === "critical" ? "lv-btn--critical" : null,
    inlineSize === "fill" ? "lv-btn--fill" : null,
    iconOnly ? "lv-btn--icon" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const inactive = disabled || loading;
  const content = (
    <>
      {icon ? (
        <span className="lv-btn__icon" aria-hidden="true">
          <s-icon type={icon} size="small" />
        </span>
      ) : null}
      {iconOnly ? null : <span className="lv-btn__label">{children}</span>}
      {loading ? <span className="lv-btn__spinner" aria-hidden="true" /> : null}
    </>
  );
  const shared = {
    ...data,
    id,
    lang,
    className,
    ...(tooltip ? { title: tooltip } : {}),
    "data-button": "",
    "data-variant": look,
    ...(tone === "critical" ? { "data-tone": "critical" } : {}),
    ...(commandFor ? { "data-command-for": commandFor } : {}),
    ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
    ...(loading ? { "aria-busy": true as const } : {}),
  };
  const click = (event: MouseEvent<HTMLElement>) => {
    if (inactive) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (commandFor) runCommand(commandFor, command);
    // The admin's own pages (shopify://admin/…): App Bridge opens them through window.open.
    if (href?.startsWith("shopify:")) {
      event.preventDefault();
      window.open(href, target && target !== "auto" ? target : "_top");
    }
  };

  if (href && !inactive) {
    const external = target && target !== "auto" ? { target, ...(target === "_blank" ? { rel: "noopener noreferrer" } : {}) } : {};
    if (routed && inApp(href) && !download && !target) {
      return (
        <Link to={href} {...shared} onClick={click}>
          {content}
        </Link>
      );
    }
    return (
      <a href={href} {...shared} {...external} {...(download !== undefined ? { download } : {})} onClick={click}>
        {content}
      </a>
    );
  }
  if (href) {
    // A link that can't be followed now: no address, said to assistive technology.
    return (
      <a {...shared} role="link" aria-disabled="true">
        {content}
      </a>
    );
  }
  return (
    <button type={type} {...shared} disabled={inactive} onClick={click}>
      {content}
    </button>
  );
}
