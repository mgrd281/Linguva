/**
 * What the language page's and an area list's "Next" steps share: each
 * step's icon square (what kind of step it is, in the colour of the place it
 * leads to: numbers are left to the steps to live), the words and button of
 * the step that lifts a translate gate (the AI permission, the own key, the
 * plan), and how a step names the image descriptions and extra details that
 * are translated with it.
 */
import { INTL_LOCALE, type I18n, type MessageKey } from "../i18n/i18n";
import type { IconName } from "../lib/icons";
import type { AttachedOpen, UnlockGate } from "../lib/language-categories";
import { Button } from "./Button";
import { IconSquare, type Tint } from "./IconSquare";

/** A step's icon square: a little smaller than a card's, beside a two-line title. */
export const STEP_ICON_SIZE = 36;

export function StepIcon({ icon, tint }: { icon: IconName; tint: Tint }) {
  return <IconSquare icon={icon} tint={tint} size={STEP_ICON_SIZE} />;
}

/** Approving (Review), counting the store, Linguva's missing access, and everything done. */
export const STEP_LOOK = {
  review: { icon: "eye-check-mark", tint: "violet" },
  count: { icon: "chart-donut", tint: "green" },
  access: { icon: "lock", tint: "slate" },
  done: { icon: "check-circle-filled", tint: "green" },
} as const satisfies Record<string, { icon: IconName; tint: Tint }>;

/**
 * Each gate's step, in the look of the Settings section (or the Plan page) that lifts it: the AI
 * permission's shield, the keys' key, the plan's lock (what the plan doesn't include).
 */
const UNLOCK: Record<UnlockGate, { icon: IconName; tint: Tint; title: MessageKey; detail: MessageKey; action: MessageKey }> = {
  CONSENT_REQUIRED: { icon: "shield-check-mark", tint: "teal", title: "language.unlock.consent.title", detail: "language.unlock.consent.detail", action: "language.unlock.consent.action" },
  ENGINE_CONSENT: { icon: "shield-check-mark", tint: "teal", title: "language.unlock.engine.title", detail: "language.error.ENGINE_CONSENT", action: "language.unlock.consent.action" },
  OWN_KEY_MISSING: { icon: "key", tint: "slate", title: "language.unlock.keyMissing.title", detail: "language.unlock.keyMissing.detail", action: "language.unlock.keyMissing.action" },
  OWN_KEY_REFUSED: { icon: "key", tint: "slate", title: "language.unlock.keyRefused.title", detail: "language.error.OWN_KEY_REFUSED", action: "language.unlock.keyRefused.action" },
  PLAN_BULK: { icon: "lock", tint: "rose", title: "language.unlock.planBulk.title", detail: "language.unlock.planBulk.detail", action: "common.action.seePlans" },
  PLAN_LANGUAGE: { icon: "lock", tint: "rose", title: "language.unlock.planLanguage.title", detail: "language.unlock.planLanguage.detail", action: "common.action.seePlans" },
};

/** The step that lifts a gate: its icon, what to do and why, and the button to the place that does it. */
export function unlockStep(i18n: I18n, input: { gate: UnlockGate; href: string; language: string; variant: "primary" | "secondary" }) {
  const look = UNLOCK[input.gate];
  return {
    icon: <StepIcon icon={look.icon} tint={look.tint} />,
    title: i18n.t(look.title, { language: input.language }),
    detail: i18n.t(look.detail, { language: input.language }),
    action: (
      <Button variant={input.variant} href={input.href}>
        {i18n.t(look.action)}
      </Button>
    ),
  };
}

/** "3 image descriptions and 2 extra details" (null without any). */
export function attachedTexts(i18n: I18n, attached: AttachedOpen): string | null {
  const parts = [
    attached.images ? i18n.t("language.next.attached.images", { count: attached.images }) : null,
    attached.customFields ? i18n.t("language.next.attached.customFields", { count: attached.customFields }) : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(parts) : null;
}
