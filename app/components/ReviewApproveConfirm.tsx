/**
 * The question before approving a whole page of Review (Polaris modal):
 * how many texts, in which languages customers see them right away and
 * which languages are still hidden, how many have a note, that edited
 * texts go live as written, that new web addresses are approved one by one,
 * and that only this page is approved. Each point only where it applies.
 * Open it with a button that has `commandFor={id}` and `command="--show"`.
 */
import type { I18n } from "../i18n/i18n";
import { INTL_LOCALE } from "../i18n/i18n";
import { DialogPoint } from "./DialogPoint";

export interface ApproveSummary {
  /** Texts the confirm button approves. */
  count: number;
  /** Their languages customers can choose ("Französisch"), and those still hidden. */
  live: string[];
  hidden: string[];
  /** Of them: with a quality note, edited by the merchant. */
  hints: number;
  edited: number;
  /** New web addresses on the page (approved one by one, never here). */
  handles: number;
  /** Matching texts on other pages. */
  elsewhere: number;
}

export function ReviewApproveConfirm({ id, summary, i18n, onConfirm }: { id: string; summary: ApproveSummary; i18n: I18n; onConfirm: () => void }) {
  const { t } = i18n;
  const list = (names: string[]) => new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(names);
  const heading = t("review.approve.heading", { count: summary.count });
  return (
    <s-modal id={id} heading={heading} accessibilityLabel={heading}>
      <s-stack direction="block" gap="base">
        {summary.live.length ? (
          <DialogPoint icon="check-circle">
            <s-text>{t("review.approve.live", { count: summary.count, languages: list(summary.live) })}</s-text>
          </DialogPoint>
        ) : null}
        {summary.hidden.length ? (
          <DialogPoint icon="hide">
            <s-text>{t("review.approve.hidden", { languages: list(summary.hidden) })}</s-text>
          </DialogPoint>
        ) : null}
        {summary.hints ? (
          <DialogPoint icon="alert-triangle">
            <s-text>{t("review.approve.hints", { count: summary.hints })}</s-text>
          </DialogPoint>
        ) : null}
        {summary.edited ? (
          <DialogPoint icon="edit">
            <s-text>{t("review.approve.edited", { count: summary.edited })}</s-text>
          </DialogPoint>
        ) : null}
        {summary.handles ? (
          <DialogPoint icon="link">
            <s-text>{t("review.approve.handlesLeft", { count: summary.handles })}</s-text>
          </DialogPoint>
        ) : null}
        {summary.elsewhere ? (
          <DialogPoint icon="page">
            <s-text>{t("review.approve.pageOnly", { count: summary.elsewhere })}</s-text>
          </DialogPoint>
        ) : null}
      </s-stack>
      <s-button slot="primary-action" variant="primary" commandFor={id} command="--hide" onClick={onConfirm}>
        {t("review.approve.confirm", { count: summary.count })}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        {t("common.action.cancel")}
      </s-button>
    </s-modal>
  );
}
