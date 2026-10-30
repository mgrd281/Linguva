/**
 * What a language's page and its area lists share: the breadcrumb drawn in
 * the page (the admin's title bar shows only the page's heading), the
 * numbered "Next" steps whose first button is the page's one primary
 * button, and an action's error in words.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";

export const BIG_HEADING = { margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 700 } as const;
/** A native list without bullets: Polaris' list roles fail the accessibility check. */
export const PLAIN_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;

/** An action's error in words: the language pages' own codes, then the Coverage page's. */
export function languageErrorText(i18n: I18n, code: string): string {
  if (code === "SHOP_AUTH") return i18n.t("common.jobError.SHOP_AUTH");
  for (const key of [`language.error.${code}`, `coverage.error.${code}`]) if (hasMessage(key)) return i18n.t(key);
  return i18n.t("language.error.generic");
}

/** "Overview › Danish › Products": links up, then the page itself. */
export function Breadcrumbs({ i18n, trail, current }: { i18n: I18n; trail: Array<{ href: string; label: string; before?: ReactNode }>; current: string }) {
  const separator = (
    <span aria-hidden="true">
      <s-text color="subdued">›</s-text>
    </span>
  );
  return (
    <nav aria-label={i18n.t("language.breadcrumb")}>
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
}

/** Up to three numbered steps, each with what to do, why, and its button. */
export function NumberedSteps({ steps }: { steps: StepView[] }) {
  return (
    <ol style={{ ...PLAIN_LIST, display: "grid", gap: 16 }}>
      {steps.map((step, i) => (
        <li key={step.key}>
          <s-stack direction="block" gap="base">
            {i > 0 ? <s-divider /> : null}
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
              <StepNumber n={i + 1} first={i === 0} />
              <s-stack direction="block" gap="small-200">
                <s-stack direction="block" gap="small-500">
                  {typeof step.title === "string" ? <s-text type="strong">{step.title}</s-text> : step.title}
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
