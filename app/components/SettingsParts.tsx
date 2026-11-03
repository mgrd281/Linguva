/**
 * The Settings area's pieces (Settings and the smart schedule's page): a
 * section of the Settings page (its heading, state and lead above one
 * card); a card with its icon, heading and state (the smart schedule's
 * page); option cards whose whole header chooses them and that mark the
 * current choice like the Plan page marks the current plan; the one lock
 * pattern for what a plan doesn't include; short facts; and tiles of links.
 *
 * Polaris web components with the Content and Plan pages' card, tile and
 * badge rules; inline styles only for type sizes, list resets and the
 * current option's ring. Every state is an icon and words.
 */
import { Children, Fragment, isValidElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Disclosure } from "./Disclosure";
import { IconSquare, type Tint } from "./IconSquare";
import type { IconName } from "../lib/icons";
import { IconTile } from "./CategoryCard";
import { CARD, H2 } from "./ContentTiles";
import { PLAIN_LIST } from "./LanguageLayout";
import { METER_LABEL } from "./plan/styles";

export type StateTone = "success" | "warning" | "critical" | "info" | "neutral";

/** A state in words with its icon ("On", "Review first"). */
export interface SettingState {
  label: string;
  icon: IconName;
  tone: StateTone;
}

export { IconSquare, type Tint } from "./IconSquare";

export function StateBadge({ state }: { state: SettingState }) {
  return (
    <s-badge tone={state.tone === "neutral" ? undefined : state.tone} icon={state.icon}>
      {state.label}
    </s-badge>
  );
}

/** An option's or a tile's name: the meters' label size (13/20, semibold). */
export const SETTING_NAME = { ...METER_LABEL, display: "block" } as const;
/** A Settings section's heading: the Content page's areas heading (17/24, semibold). */
const SECTION_HEADING = { margin: 0, fontSize: 17, lineHeight: "24px", fontWeight: 650 } as const;
/** A heading moved to by script: no ring for a mouse click (the browser still shows it for the keyboard). */
const FOCUS_TARGET = { outline: "none" } as const;

/**
 * Moves to a section that is shown now: focuses its heading, so the keyboard
 * and screen readers continue there, and scrolls only when the heading isn't
 * in view (a new address already starts at the top of the page).
 */
export function focusSection(id: string) {
  if (typeof document === "undefined") return;
  const heading = document.getElementById(`${id}-heading`);
  if (!heading) return;
  heading.focus({ preventScroll: true });
  const top = heading.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight - 48) document.getElementById(id)?.scrollIntoView({ block: "start" });
}

/** Focuses an element by id once it is on the page (after a switch, the newly current option). */
export function focusById(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.focus({ preventScroll: false });
}

/** Runs once for each new result of a fetcher, after the page shows it (to move focus to what changed). */
export function useFreshResult<T>(fetcher: { state: string; data?: T }, onResult: (data: T) => void) {
  const seen = useRef<T | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined || seen.current === fetcher.data) return;
    seen.current = fetcher.data;
    onResult(fetcher.data);
  });
}

/**
 * A section of the Settings page, shown one at a time: its heading (h2,
 * focusable: switching sections moves there) with its state, one short
 * lead, an optional card above the content (the way back to a stopped
 * job), then its content in one card.
 */
export function SettingSection({
  id,
  icon,
  tint = "grey",
  heading,
  state,
  extra,
  lead,
  top,
  children,
}: {
  id: string;
  /** Its tile's icon and colour, beside the heading (hidden on a narrow screen). */
  icon?: IconName;
  tint?: Tint;
  heading: string;
  state?: SettingState | null;
  /** Beside the state (the plan's badge). */
  extra?: ReactNode;
  lead?: ReactNode;
  /** Between the lead and the content's card. */
  top?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} style={{ scrollMarginTop: 16 }}>
      <s-stack direction="block" gap="base">
        <s-query-container>
          <s-grid gridTemplateColumns={icon ? "@container (inline-size > 520px) auto 1fr, 1fr" : "1fr"} gap="small-200 base" alignItems="center">
            {icon ? (
              <s-box display="@container (inline-size > 520px) auto, none">
                <IconSquare icon={icon} tint={tint} />
              </s-box>
            ) : null}
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <h2 id={`${id}-heading`} tabIndex={-1} style={{ ...SECTION_HEADING, ...FOCUS_TARGET }}>
                  {heading}
                </h2>
                {state ? <StateBadge state={state} /> : null}
                {extra}
              </s-stack>
              {lead ? <s-text color="subdued">{lead}</s-text> : null}
            </s-stack>
          </s-grid>
        </s-query-container>
        {top}
        {Children.toArray(children).length ? (
          <s-box {...CARD} padding="base">
            <s-query-container>
              <s-stack direction="block" gap="base">
                {children}
              </s-stack>
            </s-query-container>
          </s-box>
        ) : null}
      </s-stack>
    </section>
  );
}

/**
 * A card of the page: its icon (hidden on a narrow screen), heading (h2,
 * focusable), state, one short lead, then its content.
 */
export function SettingCard({
  id,
  icon,
  heading,
  state,
  extra,
  lead,
  children,
}: {
  id: string;
  icon: IconName;
  heading: string;
  state?: SettingState | null;
  /** Beside the state (the plan's badge). */
  extra?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} style={{ scrollMarginTop: 16 }}>
      <s-box {...CARD} padding="base">
        <s-query-container>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="@container (inline-size > 520px) auto 1fr, 1fr" gap="base" alignItems="start">
              <s-box display="@container (inline-size > 520px) auto, none">
                <IconTile icon={icon} size={40} color="base" />
              </s-box>
              <s-stack direction="block" gap="small-400">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <h2 id={`${id}-heading`} tabIndex={-1} style={{ ...H2, ...FOCUS_TARGET }}>
                    {heading}
                  </h2>
                  {state ? <StateBadge state={state} /> : null}
                  {extra}
                </s-stack>
                {lead ? <s-text color="subdued">{lead}</s-text> : null}
              </s-stack>
            </s-grid>
            {children}
          </s-stack>
        </s-query-container>
      </s-box>
    </section>
  );
}

/** What choosing an option does: a script, another page, or opening its confirmation (a modal's id). */
export interface OptionSelect {
  onClick?: () => void;
  href?: string;
  commandFor?: string;
  disabled?: boolean;
}

/**
 * One choice, as a tile (styles in ui.css, .lv-option): its icon in a tinted
 * square, its badges, name and what it means. The current one carries
 * "Current setting" and the blue frame of the current section's tile. Any
 * other one that can be chosen is one button as a whole (a link when
 * choosing it opens a page, a dialog's opener when it asks first); what
 * belongs to it (a lock, what it needs first) sits at its foot. Tiles in a
 * row are equally high.
 */
export function OptionCard({
  id,
  icon,
  tint = "grey",
  title,
  body,
  current,
  currentLabel,
  badges,
  select,
  children,
}: {
  id: string;
  icon?: IconName;
  tint?: Tint;
  title: string;
  body: ReactNode;
  current: boolean;
  currentLabel: string;
  badges?: ReactNode;
  select?: OptionSelect;
  children?: ReactNode;
}) {
  const choosable = Boolean(!current && select && !select.disabled && (select.onClick || select.href || select.commandFor));
  const marks = (
    <span className="lv-option__badges">
      {current ? (
        <s-badge tone="info" color="strong" icon="check-circle">
          {currentLabel}
        </s-badge>
      ) : null}
      {badges}
      {/* Can be chosen: an empty radio mark (a chevron where choosing opens its own page). */}
      {choosable ? (
        <span className="lv-option__mark" aria-hidden="true">
          {select?.href ? <s-icon type="chevron-right" color="subdued" /> : <span className="lv-option__radio" />}
        </span>
      ) : null}
    </span>
  );
  const head = (
    <>
      {icon ? (
        <span className="lv-option__top">
          <IconSquare icon={icon} tint={tint} />
          {marks}
        </span>
      ) : null}
      <span className="lv-option__top" style={icon ? { marginBottom: 0 } : undefined}>
        {/* The focus target after a switch is the current option's name, never one inside a button. */}
        <span id={id} {...(choosable ? {} : { tabIndex: -1 })} className="lv-option__title">
          {title}
        </span>
        {icon ? null : marks}
      </span>
      <span className="lv-option__body">{body}</span>
    </>
  );
  let control: ReactNode;
  if (choosable && select?.href) {
    control = (
      <Link to={select.href} className="lv-option__choose">
        {head}
      </Link>
    );
  } else if (choosable && select) {
    control = (
      <button
        type="button"
        className="lv-option__choose"
        onClick={() => {
          select.onClick?.();
          if (select.commandFor) openDialog(select.commandFor);
        }}
      >
        {head}
      </button>
    );
  } else {
    control = <div className="lv-option__head">{head}</div>;
  }
  const className = ["lv-option", current ? "lv-option--current" : null, choosable ? "lv-option--choosable" : null].filter(Boolean).join(" ");
  return (
    <div role="group" aria-labelledby={id} className={className} data-option={id}>
      {control}
      {Children.toArray(children).length ? <div className="lv-option__foot">{children}</div> : null}
    </div>
  );
}

/** Opens a Polaris dialog (s-modal) by its own method, as s-button's invoker command does. */
function openDialog(id: string) {
  (document.getElementById(id) as (HTMLElement & { showOverlay?: () => void }) | null)?.showOverlay?.();
}

/** Option tiles side by side where there is room, equally high in a row. */
export function OptionGrid({ label, children, min = 220 }: { label: string; children: ReactNode; min?: number }) {
  return (
    <div role="group" aria-label={label} className="lv-options" style={{ "--lv-min": `${min}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * What the current (or the chosen) way needs next, under the choices: its
 * languages and their button, or its summary with its actions. A group named
 * by `label`, its icon and title as its heading line.
 */
export function OptionPanel({ label, icon, tint = "grey", title, children }: { label: string; icon: IconName; tint?: Tint; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="lv-option-panel">
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <IconSquare icon={icon} tint={tint} size={28} />
          <span style={SETTING_NAME}>{title}</span>
        </s-stack>
        {children}
      </s-stack>
    </div>
  );
}

/** The one lock: the plan's name with a lock, one line, and the way to the plans (left out where several would repeat it). */
export function LockLine({ plan, text, link }: { plan: string; text: string; link?: { href: string; label: string } }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge icon="lock">{plan}</s-badge>
      <s-text color="subdued">{text}</s-text>
      {link ? <s-link href={link.href}>{link.label}</s-link> : null}
    </s-stack>
  );
}

/** A state line: its icon and one sentence (with its reason and time). */
export function StateLine({ icon, tone, children }: { icon: IconName; tone?: "critical" | "caution"; children: ReactNode }) {
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
      <s-icon type={icon} {...(tone ? { tone } : { color: "subdued" })} />
      <s-text {...(tone ? { tone } : {})}>{children}</s-text>
    </s-grid>
  );
}

/** Short facts with an icon each ("Only missing or outdated texts are translated"). */
export function FactList({ label, facts }: { label: string; facts: Array<{ icon: IconName; text: ReactNode; key?: string }> }) {
  return (
    <ul aria-label={label} style={{ ...PLAIN_LIST, display: "grid", gap: 8 }}>
      {facts.map((fact, i) => (
        <li key={fact.key ?? i}>
          <StateLine icon={fact.icon}>{fact.text}</StateLine>
        </li>
      ))}
    </ul>
  );
}

/** More words on demand (the app's disclosure, app/components/Disclosure.tsx). */
export const More = Disclosure;

/**
 * A row of actions that never wraps into a ragged second line: side by side
 * where they fit (`wide`: the width they need), else one under the other at
 * full width (a button is a grid item there and stretches; so does a form).
 */
export function Actions({ wide, children }: { wide: number; children: ReactNode }) {
  // One place per action, also for actions passed in a fragment.
  const items = flatten(children);
  if (!items.length) return null;
  return (
    <s-query-container>
      <s-grid gridTemplateColumns={`@container (inline-size > ${wide}px) ${"auto ".repeat(items.length)}1fr, 1fr`} gap="small-200" alignItems="center">
        {items.map((item, index) => (
          <Fragment key={index}>{item}</Fragment>
        ))}
      </s-grid>
    </s-query-container>
  );
}

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flatten(child.props.children) : [child],
  );
}

/**
 * A notice inside a card: stopped by the plan, nothing yet, not set up, a
 * job that is busy. Its icon (in `tone` when given), a short heading, one
 * sentence, and its actions (`actionsWide`: the width they need side by
 * side).
 */
export function InlineNotice({
  icon,
  tone,
  heading,
  children,
  actions,
  actionsWide = 360,
}: {
  icon: IconName;
  tone?: JSX.IntrinsicElements["s-icon"]["tone"];
  heading: string;
  children?: ReactNode;
  actions?: ReactNode;
  actionsWide?: number;
}) {
  return (
    <s-box background="subdued" borderRadius="large-100" padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
        <s-icon type={icon} tone={tone} />
        <s-stack direction="block" gap="small-300">
          <s-stack direction="block" gap="small-500">
            <span style={SETTING_NAME}>{heading}</span>
            {children ? <s-text color="subdued">{children}</s-text> : null}
          </s-stack>
          {actions ? <Actions wide={actionsWide}>{actions}</Actions> : null}
        </s-stack>
      </s-grid>
    </s-box>
  );
}

/** Tiles of links, two or three in a row: the icon in its tinted square, the name, what it is for, and the chevron (the whole tile is the link). */
export function LinkTiles({ label, links }: { label: string; links: Array<{ href: string; icon: IconName; tint?: Tint; name: string; detail: string }> }) {
  return (
    <ul aria-label={label} className="lv-links">
      {links.map((link) => (
        <li key={link.href} className="lv-links__item">
          <Link to={link.href} className="lv-link-tile">
            <IconSquare icon={link.icon} tint={link.tint ?? "grey"} />
            <span className="lv-link-tile__text">
              <span className="lv-link-tile__name">{link.name}</span>
              <span className="lv-link-tile__detail">{link.detail}</span>
            </span>
            <s-icon type="chevron-right" color="subdued" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
