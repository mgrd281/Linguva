/**
 * Confirmation for actions that can't be undone (Polaris modal; in the
 * admin it opens as the admin's own dialog). Open it with a button that has
 * `commandFor={id}` and `command="--show"`.
 */
import { useI18n } from "../i18n/react";

export function ConfirmModal(props: {
  id: string;
  heading: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <s-modal id={props.id} heading={props.heading} accessibilityLabel={props.heading}>
      <s-paragraph>{props.body}</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" commandFor={props.id} command="--hide" onClick={props.onConfirm}>
        {props.confirmLabel}
      </s-button>
      <s-button slot="secondary-actions" commandFor={props.id} command="--hide">
        {t("common.action.cancel")}
      </s-button>
    </s-modal>
  );
}
