/**
 * The way back to a stopped job from the page that fixes its cause: the
 * Settings sections "AI permission" and "Your keys", the smart schedule's
 * budgets and scope, the Plan page. The job's fix step opens that page with
 * `?job=<id>`; once its loader finds the cause fixed, the page shows this
 * card at the top of the section. The job's name is in the line, so the one
 * button stays short on a phone; its accessible name starts with the visible
 * label and adds the name (WCAG 2.5.3). After the fix the section's own
 * primary button is gone, so this is the page's one primary button.
 *
 * Only what it shows: whether the cause is fixed is the page loader's call.
 */
import { useI18n } from "../../i18n/react";
import { CARD } from "../ContentTiles";

const NAME = { fontWeight: 600 } as const;

export function BackToJob({ jobId, name }: { jobId: string; name: string }) {
  const { t } = useI18n();
  return (
    <s-box {...CARD} padding="base">
      {/* Its own container: the button goes beside the text when this card is wide enough, wherever it is placed. */}
      <s-query-container>
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
          <s-icon type="check-circle" tone="success" />
          <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="small-200 base" alignItems="center" justifyItems="start">
            <s-stack direction="block" gap="small-500">
              <strong style={NAME}>{t("jobs.attention.resumable", { name })}</strong>
              <s-text color="subdued">{t("jobs.back.text")}</s-text>
            </s-stack>
            <s-button variant="primary" href={`/app/jobs/${encodeURIComponent(jobId)}`} accessibilityLabel={t("jobs.back.label", { name })}>
              {t("jobs.back.action")}
            </s-button>
          </s-grid>
        </s-grid>
      </s-query-container>
    </s-box>
  );
}
