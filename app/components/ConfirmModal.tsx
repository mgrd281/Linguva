/**
 * Confirmation for actions that can't be undone (Polaris modal; in the
 * admin it opens as the admin's own dialog). Open it with a button that has
 * `commandFor={id}` and `command="--show"`.
 *
 * A text body is one paragraph; any other body is shown as given (its own
 * paragraphs). The button that closes it says "Cancel" unless the question
 * needs its own words: "Keep translating" beside "Cancel job".
 */
import type { ReactNode } from "react";
import { useI18n } from "../i18n/react";

export function ConfirmModal(props: {
  id: string;
  heading: string;
  body: string | ReactNode;
  confirmLabel: string;
  dismissLabel?: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <s-modal id={props.id} heading={props.heading} accessibilityLabel={props.heading}>
      {typeof props.body === "string" ? <s-paragraph>{props.body}</s-paragraph> : props.body}
      <s-button slot="primary-action" variant="primary" tone="critical" commandFor={props.id} command="--hide" onClick={props.onConfirm}>
        {props.confirmLabel}
      </s-button>
      <s-button slot="secondary-actions" commandFor={props.id} command="--hide">
        {props.dismissLabel ?? t("common.action.cancel")}
      </s-button>
    </s-modal>
  );
}
