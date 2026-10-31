/**
 * The Settings area's pieces (Settings and the smart schedule's page): a
 * card with its icon, heading and state; the "At a glance" tiles that jump
 * to the cards; option cards that mark the current choice like the Plan
 * page marks the current plan; short facts with an icon each; a tile of
 * links; and the designed notices (locked by the plan, empty).
 *
 * Polaris web components with the Content and Plan pages' card, tile and
 * badge rules; inline styles only for type sizes and list resets. Every
 * state is an icon and words.
 */
import type { ReactNode } from "react";
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
const NAME = { ...METER_LABEL, display: "block" } as const;
export const SETTING_NAME = NAME;
/** The figure on a glance tile. */
const TILE_FIGURE = { display: "block", fontSize: 20, lineHeight: "24px", fontWeight: 700, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" } as const;

/**
 * A card of the page: its icon, heading (h2), state and a short note beside
 * the state ("since 31 October"), one lead sentence, then its controls.
 */
export function SettingCard({
  id,
  icon,
  heading,
  state,
  meta,
  extra,
  lead,
  children,
}: {
  id: string;
  icon: IconName;
  heading: string;
  state?: SettingState | null;
  meta?: string | null;
  /** Beside the state (the "Business" badge). */
  extra?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} style={{ scrollMarginTop: 16 }}>
      <s-box {...CARD} padding="base">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
            <IconTile icon={icon} size={40} color="base" />
            <s-stack direction="block" gap="small-400">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <h2 id={`${id}-heading`} style={H2}>
                  {heading}
                </h2>
                {state ? <StateBadge state={state} /> : null}
                {extra}
                {meta ? <s-text color="subdued">{meta}</s-text> : null}
              </s-stack>
              {lead ? <s-text color="subdued">{lead}</s-text> : null}
            </s-stack>
          </s-grid>
          {children}
        </s-stack>
      </s-box>
    </section>
  );
}

/** One "At a glance" tile: the whole tile is the link to its card. */
export interface GlanceTile {
  href: string;
  icon: IconName;
  label: string;
  state?: SettingState;
  /** A figure instead of a state (the AI characters). */
  figure?: { value: string; percent: number; tone: "success" | "warning" | "critical"; label: string };
  line: string;
}

export function Glance({ label, tiles }: { label: string; tiles: GlanceTile[] }) {
  // In-page links to the cards below: a navigation landmark of its own.
  return (
    <nav aria-label={label}>
      {/* Four across on a wide page, two by two on a phone. */}
      <ul style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <li key={tile.href} style={{ display: "flex", minWidth: 0 }}>
            <s-clickable href={tile.href} {...CARD} padding="base" inlineSize="100%">
              <s-stack direction="block" gap="small-200">
                <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                  <IconTile icon={tile.icon} size={28} color="base" iconSize="base" />
                  <span style={NAME}>{tile.label}</span>
                </s-grid>
                {tile.state ? (
                  <s-stack direction="inline">
                    <StateBadge state={tile.state} />
                  </s-stack>
                ) : null}
                {tile.figure ? (
                  <s-stack direction="block" gap="small-300">
                    <span style={TILE_FIGURE}>{tile.figure.value}</span>
                    <ProgressBar value={tile.figure.percent} label={tile.figure.label} tone={tile.figure.tone} />
                  </s-stack>
                ) : null}
                <s-text color="subdued">{tile.line}</s-text>
              </s-stack>
            </s-clickable>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One of two choices, drawn like the Plan page's plan cards: its icon, name
 * and what it means; the current one carries "Current setting" and the ring
 * in the text's colour, a recommended one its badge. The other one carries
 * the way to switch (a form).
 */
export function OptionCard({
  id,
  icon,
  title,
  body,
  current,
  currentLabel,
  recommended,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  body: ReactNode;
  current: boolean;
  currentLabel: string;
  recommended?: string;
  children?: ReactNode;
}) {
  return (
    <div role="group" aria-labelledby={id} style={{ position: "relative", isolation: "isolate", padding: 16, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
        <s-box background="base" border={current ? "none" : "base"} borderRadius="large-100" blockSize="100%" />
        {current ? <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: "inset 0 0 0 2px currentColor" }} /> : null}
      </div>
      <s-stack direction="inline" alignItems="start" gap="small-200">
        <IconTile icon={icon} size={32} color="base" iconSize="base" />
        <span aria-hidden="true" style={{ flex: "1 0 0" }} />
        {current ? (
          <s-badge tone="info" color="strong" icon="check-circle">
            {currentLabel}
          </s-badge>
        ) : null}
        {recommended ? (
          <s-badge tone="info" icon="target">
            {recommended}
          </s-badge>
        ) : null}
      </s-stack>
      <s-stack direction="block" gap="small-400">
        <h3 id={id} style={{ ...H2, fontSize: 14, lineHeight: "20px" }}>
          {title}
        </h3>
        <s-text color="subdued">{body}</s-text>
      </s-stack>
      {children ? <div style={{ marginTop: "auto" }}>{children}</div> : null}
    </div>
  );
}

/** Two option cards side by side (one above the other on a phone). */
export function OptionPair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

/** Short facts with an icon each ("Only missing or outdated texts are translated"). */
export function FactList({ label, facts }: { label: string; facts: Array<{ icon: IconName; text: ReactNode; key?: string }> }) {
  return (
    <ul aria-label={label} style={{ ...PLAIN_LIST, display: "grid", gap: 8 }}>
      {facts.map((fact, i) => (
        <li key={fact.key ?? i}>
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
            <s-icon type={fact.icon} color="subdued" />
            <s-text>{fact.text}</s-text>
          </s-grid>
        </li>
      ))}
    </ul>
  );
}

/** "What is sent, and when": more words on demand (a native disclosure, 44 px high, like the Plan page's questions). */
export function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details>
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
 * A notice inside a card: locked by the plan, nothing yet, a hint. Its icon
 * in a tile, a short heading, one sentence, and at most one action.
 */
export function InlineNotice({ icon, heading, children, action }: { icon: IconName; heading: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <s-box background="subdued" borderRadius="large-100" padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
        <IconTile icon={icon} size={32} color="base" iconSize="base" />
        <s-stack direction="block" gap="small-300">
          <s-stack direction="block" gap="small-500">
            <span style={NAME}>{heading}</span>
            {children ? <s-text color="subdued">{children}</s-text> : null}
          </s-stack>
          {action ? <s-stack direction="inline">{action}</s-stack> : null}
        </s-stack>
      </s-grid>
    </s-box>
  );
}

/** A tile of links: icon, name, what it is for, and the chevron (the whole row is the link). */
export function LinkTiles({ label, links }: { label: string; links: Array<{ href: string; icon: IconName; name: string; detail: string }> }) {
  return (
    <ul aria-label={label} style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 4 }}>
      {links.map((link) => (
        <li key={link.href} style={{ display: "flex", minWidth: 0 }}>
          <s-clickable href={link.href} padding="small-100" borderRadius="large-100" inlineSize="100%">
            <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" columnGap="small-100" alignItems="center">
              <IconTile icon={link.icon} size={32} color="base" iconSize="base" />
              <s-stack direction="block">
                <span style={NAME}>{link.name}</span>
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
