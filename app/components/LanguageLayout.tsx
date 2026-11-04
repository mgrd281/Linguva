/**
 * What a language's page and its area lists share: the breadcrumb drawn in
 * the page (the admin's title bar shows only the page's heading), the card's
 * look, the numbered "Next" steps whose first button is the page's one
 * primary button, and an action's error in words.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";

export const BIG_HEADING = { margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 700 } as const;
/** A native list without bullets: Polaris' list roles fail the accessibility check. */
export const PLAIN_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;
/**
 * A card: on a phone too (Polaris draws sections flat there). Every page's cards take it (ContentTiles
 * passes it on); it lives here, where the area cards and lists can import it without a cycle.
 */
export const CARD = { background: "base", border: "base", borderRadius: "large-100" } as const;

/** An action's error in words: the language pages' own codes, then the Coverage page's. */
export function languageErrorText(i18n: I18n, code: string): string {
  if (code === "SHOP_AUTH") return i18n.t("common.jobError.SHOP_AUTH");
  for (const key of [`language.error.${code}`, `coverage.error.${code}`]) if (hasMessage(key)) return i18n.t(key);
  return i18n.t("language.error.generic");
}

/**
 * Where a translate gate's fix is: the AI permission in Settings, or (Own key plan) the keys card
 * there. Null for a gate fixed elsewhere (the plan, the jobs, the installation).
 */
export function settingsLinkFor(code: string): string | null {
  if (code === "CONSENT_REQUIRED" || code === "ENGINE_CONSENT") return "/app/settings?section=ai";
  if (code === "OWN_KEY_MISSING" || code === "OWN_KEY_REFUSED") return "/app/settings?section=keys";
  return null;
}

/** The trail on a wide container, the back row on a narrow one (Breadcrumbs `touch`). */
const TRAIL_WIDE = "@container (inline-size > 640px) auto, none";
const TRAIL_NARROW = "@container (inline-size > 640px) none, auto";

/**
 * "Overview › Danish › Products": links up, then the page itself.
 *
 * `touch` (inside an s-query-container, as the Jobs pages' header): on a
 * narrow container the trail becomes one 44 px back row to the last link
 * ("‹ Jobs"), on a wide one it stays the trail. Only one of the two is
 * displayed; the other is display: none, so it is neither read nor focusable.
 */
export function Breadcrumbs({
  i18n,
  trail,
  current,
  touch = false,
}: {
  i18n: I18n;
  trail: Array<{ href: string; label: string; before?: ReactNode }>;
  current: string;
  touch?: boolean;
}) {
  const separator = (
    <span aria-hidden="true">
      <s-text color="subdued">›</s-text>
    </span>
  );
  const wide = (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {trail.map((step) => (
        <s-stack key={step.href} direction="inline" gap="small-200" alignItems="center">
          {step.before}
          <s-link href={step.href}>{step.label}</s-link>
          {separator}
        </s-stack>
      ))}
      <span aria-current="page">
        <s-text color="subdued">{current}</s-text>
      </span>
    </s-stack>
  );
  const parent = trail[trail.length - 1];
  if (!touch || !parent) return <nav aria-label={i18n.t("language.breadcrumb")}>{wide}</nav>;
  return (
    <nav aria-label={i18n.t("language.breadcrumb")}>
      <s-box display={TRAIL_WIDE}>{wide}</s-box>
      <s-box display={TRAIL_NARROW}>
        <s-clickable href={parent.href} padding="small-200 none" minBlockSize="44px" borderRadius="base">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-icon type="chevron-left" color="subdued" size="small" />
            <s-text>{parent.label}</s-text>
          </s-stack>
        </s-clickable>
      </s-box>
    </nav>
  );
}

/** A step's number: the first filled, the others outlined. */
export function StepNumber({ n, first }: { n: number; first: boolean }) {
  return (
    <s-stack
      background={first ? "strong" : "base"}
      {...(first ? {} : { border: "base" })}
      borderRadius="large-200"
      inlineSize="24px"
      blockSize="24px"
      alignItems="center"
      justifyContent="center"
    >
      <s-text type="strong">{n}</s-text>
    </s-stack>
  );
}

export interface StepView {
  key: string;
  title: ReactNode;
  detail?: string;
  action?: ReactNode;
  /**
   * In place of the step's number: what kind of step it is (an icon square, as on the language pages,
   * where numbers are left to the steps to live). The list keeps its order for screen readers.
   */
  icon?: ReactNode;
}

/**
 * Up to three numbered steps, each with what to do, why, and its button. A title given as text takes the
 * type scale's step title (.lv-h3, as the Overview's step), not a heading: the steps are a list.
 */
export function NumberedSteps({ steps }: { steps: StepView[] }) {
  return (
    <ol style={{ ...PLAIN_LIST, display: "grid", gap: 16 }}>
      {steps.map((step, i) => (
        <li key={step.key}>
          <s-stack direction="block" gap="base">
            {i > 0 ? <s-divider /> : null}
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
              {step.icon !== undefined ? step.icon : <StepNumber n={i + 1} first={i === 0} />}
              <s-stack direction="block" gap="small-200">
                <s-stack direction="block" gap="small-500">
                  {typeof step.title === "string" ? <strong className="lv-h3">{step.title}</strong> : step.title}
                  {step.detail ? <s-text color="subdued">{step.detail}</s-text> : null}
                </s-stack>
                {step.action ? <s-stack direction="inline">{step.action}</s-stack> : null}
              </s-stack>
            </s-grid>
          </s-stack>
        </li>
      ))}
    </ol>
  );
}
