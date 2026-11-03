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
import { Children, Fragment, isValidElement, useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
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
  heading,
  state,
  extra,
  lead,
  top,
  children,
}: {
  id: string;
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
        <s-stack direction="block" gap="small-400">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <h2 id={`${id}-heading`} tabIndex={-1} style={{ ...SECTION_HEADING, ...FOCUS_TARGET }}>
              {heading}
            </h2>
            {state ? <StateBadge state={state} /> : null}
            {extra}
          </s-stack>
          {lead ? <s-text color="subdued">{lead}</s-text> : null}
        </s-stack>
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
 * One choice, drawn like the Plan page's plan cards: its name, badges and
 * what it means. The current one carries "Current setting" and the ring in
 * the text's colour. Any other one that can be chosen is one tap target as a
 * whole (its header); what belongs to it (languages, a lock, a summary)
 * follows below.
 */
export function OptionCard({
  id,
  title,
  body,
  current,
  currentLabel,
  badges,
  select,
  children,
}: {
  id: string;
  title: string;
  body: ReactNode;
  current: boolean;
  currentLabel: string;
  badges?: ReactNode;
  select?: OptionSelect;
  children?: ReactNode;
}) {
  const head = (
    <s-stack direction="block" gap="small-400">
      <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
        <span id={id} tabIndex={-1} style={{ ...SETTING_NAME, ...FOCUS_TARGET, fontSize: 14 }}>
          {title}
        </span>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {current ? (
            <s-badge tone="info" color="strong" icon="check-circle">
              {currentLabel}
            </s-badge>
          ) : null}
          {badges}
        </s-stack>
      </s-stack>
      <s-text color="subdued">{body}</s-text>
    </s-stack>
  );
  const choosable = !current && select && !select.disabled && (select.onClick || select.href || select.commandFor);
  return (
    <div role="group" aria-labelledby={id} style={{ position: "relative", isolation: "isolate", minWidth: 0 }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
        <s-box background="base" border={current ? "none" : "base"} borderRadius="large-100" blockSize="100%" />
        {current ? <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: "inset 0 0 0 2px currentColor" }} /> : null}
      </div>
      {choosable ? (
        <s-clickable
          padding="base"
          borderRadius="large-100"
          inlineSize="100%"
          {...(select.href ? { href: select.href } : {})}
          {...(select.onClick ? { onClick: select.onClick } : {})}
          {...(select.commandFor ? { commandFor: select.commandFor, command: "--show" as const } : {})}
        >
          {head}
        </s-clickable>
      ) : (
        <div style={{ padding: 16 }}>{head}</div>
      )}
      {Children.toArray(children).length ? <div style={{ padding: "0 16px 16px" }}>{children}</div> : null}
    </div>
  );
}

/** Option cards side by side where there is room, each as high as its own content. */
export function OptionGrid({ label, children, min = 220 }: { label: string; children: ReactNode; min?: number }) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: "start" }}>
      {children}
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

/** More words on demand, closed at first (a native disclosure, 44 px high, like the Plan page's questions); `open`: open at first. */
export function More({ summary, children, open, onToggle }: { summary: string; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void }) {
  return (
    <details {...(open ? { open: true } : {})} {...(onToggle ? { onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => onToggle(event.currentTarget.open) } : {})}>
      <summary style={{ cursor: "pointer", minHeight: 44, padding: "12px 0", boxSizing: "border-box", fontWeight: 600 }}>{summary}</summary>
      <div style={{ padding: "0 0 8px 18px" }}>
        <s-stack direction="block" gap="small-200">
          {children}
        </s-stack>
      </div>
    </details>
  );
}

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

/** Tiles of links, two by two: icon, name, what it is for, and the chevron (the whole row is the link). */
export function LinkTiles({ label, links }: { label: string; links: Array<{ href: string; icon: IconName; name: string; detail: string }> }) {
  return (
    <ul aria-label={label} style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(max(240px, 40%), 1fr))", gap: 4 }}>
      {links.map((link) => (
        <li key={link.href} style={{ display: "flex", minWidth: 0 }}>
          <s-clickable href={link.href} padding="small-100" borderRadius="large-100" inlineSize="100%">
            <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" columnGap="small-100" alignItems="center">
              <IconTile icon={link.icon} size={32} color="base" iconSize="base" />
              <s-stack direction="block">
                <span style={SETTING_NAME}>{link.name}</span>
                <s-text color="subdued">{link.detail}</s-text>
              </s-stack>
              <s-icon type="chevron-right" color="subdued" />
            </s-grid>
          </s-clickable>
        </li>
      ))}
    </ul>
  );
}
