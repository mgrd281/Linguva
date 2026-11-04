/**
 * The way back to a stopped job from the page that fixes its cause: the
 * Settings sections "AI permission" and "Your keys", the smart schedule's
 * budgets and scope, the Plan page. The job's fix step opens that page with
 * `?job=<id>`; once its loader finds the cause fixed, the page shows this
 * green status row at the top of the section, drawn as Settings' own status
 * row (ui.css .lv-status): the check, the job's name in the line, how it goes
 * on, and the one button beside them where there is room (under them on a
 * phone). The name is in the line, so the button stays short on a phone; its
 * accessible name starts with the visible label and adds the name (WCAG
 * 2.5.3). After the fix the section's own primary button is gone, so this is
 * the page's one primary button.
 *
 * Only what it shows: whether the cause is fixed is the page loader's call.
 */
import { useI18n } from "../../i18n/react";
import { Button } from "../Button";
import { StatusPanel } from "./JobLooks";

export function BackToJob({ jobId, name }: { jobId: string; name: string }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      tone="success"
      icon="check-circle"
      title={<strong className="lv-status__title">{t("jobs.attention.resumable", { name })}</strong>}
      text={t("jobs.back.text")}
      action={
        <Button variant="primary" href={`/app/jobs/${encodeURIComponent(jobId)}`} accessibilityLabel={t("jobs.back.label", { name })}>
          {t("jobs.back.action")}
        </Button>
      }
    />
  );
}
