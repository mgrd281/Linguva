/**
 * Publishing, the same on Settings (whole areas and automatic translation)
 * and on the smart schedule's page (its own setting): "Review first" or
 * "Publish automatically", the current one marked. Choosing automatic
 * opens a confirmation first (the server still requires it); without the
 * plan the option shows the lock.
 */
import { useI18n } from "../i18n/react";
import { LockLine, OptionCard, OptionGrid } from "./SettingsParts";

export type PublishMode = "DRAFT" | "AUTO_PUBLISH";

export function PublishingChoice({
  id,
  mode,
  inPlan,
  onChoose,
  busy = false,
  lockLink = true,
}: {
  id: string;
  /** What really happens now (automatic only while the plan includes it). */
  mode: PublishMode;
  inPlan: boolean;
  /** Automatic only after the confirmation: `confirmed` is then true. */
  onChoose: (mode: PublishMode, confirmed: boolean) => void;
  busy?: boolean;
  /** The plans link on the lock (left out where the page already shows one). */
  lockLink?: boolean;
}) {
  const { t } = useI18n();
  const modal = `${id}-confirm`;
  return (
    <>
      <OptionGrid label={t("settings.publish.heading")}>
        <OptionCard
          id={`${id}-review`}
          title={t("settings.publish.review.title")}
          body={t("settings.publish.review.body")}
          current={mode === "DRAFT"}
          currentLabel={t("settings.option.current")}
          badges={<s-badge icon="target">{t("settings.publish.recommended")}</s-badge>}
          select={{ onClick: () => onChoose("DRAFT", false), disabled: busy }}
        />
        <OptionCard
          id={`${id}-auto`}
          title={t("settings.publish.auto.title")}
          body={t("settings.publish.auto.body")}
          current={mode === "AUTO_PUBLISH"}
          currentLabel={t("settings.option.current")}
          select={inPlan ? { commandFor: modal, disabled: busy } : undefined}
        >
          {inPlan ? null : (
            <LockLine plan="Pro" text={t("settings.publish.auto.plan")} {...(lockLink ? { link: { href: "/app/plan", label: t("common.action.seePlans") } } : {})} />
          )}
        </OptionCard>
      </OptionGrid>
      <s-modal id={modal} heading={t("settings.publish.confirm.heading")} accessibilityLabel={t("settings.publish.confirm.heading")}>
        <s-paragraph>{t("settings.publish.confirm.body")}</s-paragraph>
        <s-button slot="primary-action" variant="primary" commandFor={modal} command="--hide" onClick={() => onChoose("AUTO_PUBLISH", true)}>
          {t("settings.publish.auto.title")}
        </s-button>
        <s-button slot="secondary-actions" commandFor={modal} command="--hide">
          {t("common.action.cancel")}
        </s-button>
      </s-modal>
    </>
  );
}
