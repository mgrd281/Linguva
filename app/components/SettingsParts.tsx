/**
 * The Settings area's pieces (Settings and the smart schedule's page): a
 * card with its icon, heading and state; the "At a glance" tiles that move
 * to the cards; option cards whose whole header chooses them and that mark
 * the current choice like the Plan page marks the current plan; the one
 * lock pattern for what a plan doesn't include; short facts; and tiles of
 * links.
 *
 * Polaris web components with the Content and Plan pages' card, tile and
 * badge rules; inline styles only for type sizes, list resets and the
 * current option's ring. Every state is an icon and words.
 */
import { Children, Fragment, isValidElement, useEffect, useRef, type ReactNode } from "react";
import type { IconName } from "../lib/icons";
import { IconTile } from "./CategoryCard";
import { CARD, H2 } from "./ContentTiles";
import { PLAIN_LIST } from "./LanguageLayout";
import { METER_LABEL } from "./plan/styles";
import { ProgressBar } from "./ProgressBar";

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
/** A name that stays on one line ("Änderungen übersetzen"), cut with "…" where it can't. */
const ONE_LINE = { ...SETTING_NAME, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
/** The figure on a glance tile. */
const TILE_FIGURE = { display: "block", fontSize: 20, lineHeight: "24px", fontWeight: 700, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" } as const;
/** A heading moved to by script: no ring for a mouse click (the browser still shows it for the keyboard). */
const FOCUS_TARGET = { outline: "none" } as const;

/**
 * Moves to a card: scrolls it into view and focuses its heading, so the
 * keyboard and screen readers continue there. No navigation, so the page's
 * data isn't loaded again.
 */
export function focusCard(id: string) {
  if (typeof document === "undefined") return;
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
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
 * A card of the page: its icon (hidden on a narrow screen), heading (h2,
 * focusable for the glance tiles), state, one short lead, then its content.
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

/** One "At a glance" tile: a button that moves to its card, or a link to another page. */
export interface GlanceTile {
  key: string;
  /** The card it moves to (its id). */
  target?: string;
  /** Another page (the Plan page for the AI characters). */
  href?: string;
  icon: IconName;
  label: string;
  /** The name on a narrow tile (a phone), where the card's full name doesn't fit on one line. */
  short?: string;
  /** Its state; `short`: the words on a narrow tile. */
  state?: SettingState & { short?: string };
  /** A figure instead of a state (the AI characters). */
  figure?: { value: string; percent: number; tone: "success" | "warning" | "critical"; label: string };
  line: string;
}

/** A tile is wide enough for its icon and the card's full name (three across on a desktop page, not two on a phone). */
const WIDE_TILE = "inline-size > 230px";

/** Text for a wide and for a narrow tile; only one of them is shown (and read). */
function ByWidth({ wide, narrow }: { wide: ReactNode; narrow?: ReactNode }) {
  if (narrow === undefined) return <>{wide}</>;
  return (
    <>
      <s-box display={`@container (${WIDE_TILE}) auto, none`}>{wide}</s-box>
      <s-box display={`@container (${WIDE_TILE}) none, auto`}>{narrow}</s-box>
    </>
  );
}

export function Glance({ label, tiles }: { label: string; tiles: GlanceTile[] }) {
  return (
    <section aria-label={label}>
      <s-query-container>
        {/* Three across on a wide page, two on a phone (with a little less padding). */}
        <ul style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(max(150px, 30%), 1fr))", gap: 12 }}>
          {tiles.map((tile) => (
            <li key={tile.key} style={{ display: "flex", minWidth: 0 }}>
              <s-clickable
                {...CARD}
                padding="@container (inline-size > 500px) base, small"
                inlineSize="100%"
                {...(tile.href ? { href: tile.href } : { onClick: () => tile.target && focusCard(tile.target) })}
              >
                {/* As high as the row's highest tile, its content at the top (a button centres it otherwise). */}
                <div style={{ height: "100%" }}>
                  <s-query-container>
                    <s-stack direction="block" gap="small-200">
                      {/* The icon only where there is room; the name on one line, and the chevron. */}
                      <s-grid gridTemplateColumns={`@container (${WIDE_TILE}) auto 1fr auto, 1fr auto`} gap="small-200" alignItems="center">
                        <s-box display={`@container (${WIDE_TILE}) auto, none`}>
                          <IconTile icon={tile.icon} size={28} color="base" iconSize="base" />
                        </s-box>
                        <div style={{ minWidth: 0, overflow: "hidden" }}>
                          <ByWidth wide={<span style={ONE_LINE}>{tile.label}</span>} narrow={tile.short === undefined ? undefined : <span style={ONE_LINE}>{tile.short}</span>} />
                        </div>
                        <s-icon type="chevron-right" color="subdued" />
                      </s-grid>
                      {tile.figure ? (
                        <s-stack direction="block" gap="small-300">
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <span style={TILE_FIGURE}>{tile.figure.value}</span>
                            {tile.state ? <StateBadge state={tile.state} /> : null}
                          </s-stack>
                          <ProgressBar value={tile.figure.percent} label={tile.figure.label} tone={tile.figure.tone} />
                        </s-stack>
                      ) : tile.state ? (
                        <s-stack direction="inline">
                          <ByWidth
                            wide={<StateBadge state={tile.state} />}
                            narrow={tile.state.short === undefined ? undefined : <StateBadge state={{ ...tile.state, label: tile.state.short }} />}
                          />
                        </s-stack>
                      ) : null}
                      <s-text color="subdued">{tile.line}</s-text>
                    </s-stack>
                  </s-query-container>
                </div>
              </s-clickable>
            </li>
          ))}
        </ul>
      </s-query-container>
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
export function More({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details {...(open ? { open: true } : {})}>
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
 * A notice inside a card: stopped by the plan, nothing yet, not set up. Its
 * icon, a short heading, one sentence, and its actions (`actionsWide`: the
 * width they need side by side).
 */
export function InlineNotice({
  icon,
  heading,
  children,
  actions,
  actionsWide = 360,
}: {
  icon: IconName;
  heading: string;
  children?: ReactNode;
  actions?: ReactNode;
  actionsWide?: number;
}) {
  return (
    <s-box background="subdued" borderRadius="large-100" padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
        <s-icon type={icon} />
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
