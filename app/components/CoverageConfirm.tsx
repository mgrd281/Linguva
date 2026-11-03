/**
 * The question before a Coverage row's (or its items page's) bulk job, as
 * the language pages ask it (OWNER_DECISIONS 6.9): what gets translated, up
 * to how many texts in which states; whether the translations wait for
 * approval or go live; that the merchant's own and approved translations
 * stay; the AI characters left this month (Own key plan: that the
 * merchant's own service bills them). Polaris modal, opened by a button with
 * `commandFor={id}` and `command="--show"`.
 */
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import type { OpenTexts } from "../lib/coverage-bulk";
import { openTotal } from "../lib/coverage-bulk";
import type { IconName } from "../lib/icons";
import { CATEGORIES, categoryOf } from "../lib/language-categories";
import { DialogPoint as Point } from "./DialogPoint";

export interface CoverageConfirmTarget {
  /** The owner type the job translates ("PRODUCT"). */
  resourceType: string;
  /** Its name in the merchant's words ("Products"). */
  name: string;
  /** The job also translates the items' image descriptions and extra details. */
  includeAttached: boolean;
  open: OpenTexts;
}

/** The area's icon of the type the job translates (the language page's), else translating's own. */
function iconOf(resourceType: string): IconName {
  const area = categoryOf(resourceType);
  return area && area !== "theme" && area !== "notifications" ? CATEGORIES[area].icon : "language-translate";
}

export function CoverageConfirm({
  id,
  target,
  languageName,
  publishMode,
  aiRemaining,
  i18n,
  onConfirm,
}: {
  id: string;
  /** Null until a row's button chose one. */
  target: CoverageConfirmTarget | null;
  languageName: string;
  publishMode: "DRAFT" | "AUTO_PUBLISH";
  aiRemaining: number | null;
  i18n: I18n;
  onConfirm: () => void;
}) {
  const { t } = i18n;
  const heading = target ? t("language.confirm.heading", { what: target.name, language: languageName }) : t("language.action.translate");
  const open = target?.open;
  const states = open
    ? new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(
        (["missing", "outdated", "failed"] as const).filter((s) => open[s] > 0).map((s) => t(`language.confirm.state.${s}`, { count: open[s] })),
      )
    : "";
  return (
    <s-modal id={id} heading={heading} accessibilityLabel={heading}>
      {target && open ? (
        <s-stack direction="block" gap="base">
          <Point icon={iconOf(target.resourceType)} title={t("language.confirm.what")}>
            <s-text color="subdued">
              {openTotal(open) > 0 ? t("language.confirm.whatTexts", { texts: t("language.confirm.texts", { count: openTotal(open) }), states }) : t("coverage.confirm.nothingCounted")}
            </s-text>
            {target.includeAttached ? <s-text color="subdued">{t("coverage.confirm.attached")}</s-text> : null}
          </Point>
          {/* One icon per concept (Settings' publishing tiles): approving eye-check-mark, publishing automatically send. */}
          {publishMode === "AUTO_PUBLISH" ? (
            <Point icon="send" title={t("language.confirm.live")}>
              <s-text color="subdued">{t("language.confirm.liveDetail")}</s-text>
            </Point>
          ) : (
            <Point icon="eye-check-mark" title={t("language.confirm.review")}>
              <s-text color="subdued">{t("language.confirm.reviewDetail", { review: t("common.nav.review") })}</s-text>
            </Point>
          )}
          <Point icon="edit" title={t("language.confirm.keep")}>
            <s-text color="subdued">{t("language.confirm.keepDetail")}</s-text>
          </Point>
          <Point icon="gauge" title={t("language.confirm.chars")}>
            <s-text color="subdued">{aiRemaining !== null ? t("language.confirm.charsUnknown", { remaining: aiRemaining }) : t("language.confirm.ownKeyUnknown")}</s-text>
          </Point>
        </s-stack>
      ) : null}
      <s-button slot="primary-action" variant="primary" commandFor={id} command="--hide" onClick={() => target && onConfirm()}>
        {target ? t("language.confirm.submit", { what: target.name }) : t("language.action.translate")}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        {t("common.action.cancel")}
      </s-button>
    </s-modal>
  );
}
