/**
 * The question before translating an area in bulk (Polaris modal): what
 * gets translated, counted honestly in items and texts; whether the
 * results wait for approval or go live; that the merchant's own and
 * approved translations stay; and the AI characters it uses of what is
 * left this month. Open it with a button that has `commandFor={id}` and
 * `command="--show"`.
 */
import { useRef } from "react";
import type { BulkEstimate } from "../.server/languages/language-page";
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import { CATEGORIES, type CategoryId } from "../lib/language-categories";
import { categoryName, ITEM_COUNT_KEYS } from "./CategoryCard";
import { DialogPoint as Point } from "./DialogPoint";

/** "29 products" for an area of one kind with a count, else the area's name ("Menus & filters"). */
export function translateWhat(i18n: I18n, category: CategoryId, estimate: BulkEstimate): string {
  const items = ITEM_COUNT_KEYS[category];
  return items && estimate.items ? i18n.t(items, { count: estimate.items }) : categoryName(i18n, category);
}

export interface TranslateConfirmProps {
  id: string;
  /** The area to translate and what translating it does; null until one is chosen. */
  target: { category: CategoryId; estimate: BulkEstimate } | null;
  languageName: string;
  publishMode: "DRAFT" | "AUTO_PUBLISH";
  /** AI characters left this month. */
  aiRemaining: number;
  i18n: I18n;
  onConfirm: (input: { category: CategoryId; includeAttached: boolean }) => void;
}

export function TranslateConfirm({ id, target, languageName, publishMode, aiRemaining, i18n, onConfirm }: TranslateConfirmProps) {
  const { t } = i18n;
  const attached = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  const what = target ? translateWhat(i18n, target.category, target.estimate) : "";
  const heading = target ? t("language.confirm.heading", { what, language: languageName }) : t("language.action.translate");
  const estimate = target?.estimate;
  const states = estimate
    ? new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(
        (["missing", "outdated", "failed"] as const).filter((s) => estimate.texts[s] > 0).map((s) => t(`language.confirm.state.${s}`, { count: estimate.texts[s] })),
      )
    : "";
  const texts = estimate ? estimate.texts.missing + estimate.texts.outdated + estimate.texts.failed : 0;
  return (
    <s-modal id={id} heading={heading} accessibilityLabel={heading}>
      {target && estimate ? (
        // Rebuilt for each area, so the checkbox starts empty.
        <s-stack key={target.category} direction="block" gap="base">
          <Point icon={CATEGORIES[target.category].icon} title={t("language.confirm.what")}>
            <s-text color="subdued">
              {estimate.items
                ? t("language.confirm.whatItems", { items: what, texts: t("language.confirm.texts", { count: texts }), states })
                : t("language.confirm.whatTexts", { texts: t("language.confirm.texts", { count: texts }), states })}
            </s-text>
          </Point>
          {publishMode === "AUTO_PUBLISH" ? (
            <Point icon="check-circle" title={t("language.confirm.live")}>
              <s-text color="subdued">{t("language.confirm.liveDetail")}</s-text>
            </Point>
          ) : (
            <Point icon="clock" title={t("language.confirm.review")}>
              <s-text color="subdued">{t("language.confirm.reviewDetail", { review: t("common.nav.review") })}</s-text>
            </Point>
          )}
          <Point icon="shield-check-mark" title={t("language.confirm.keep")}>
            <s-text color="subdued">{t("language.confirm.keepDetail")}</s-text>
          </Point>
          {/* AI characters have one icon in the whole app (gauge, as on the Plan page); wand means "translate with AI". */}
          <Point icon="gauge" title={t("language.confirm.chars")}>
            <s-text color="subdued">
              {estimate.chars !== null ? t("language.confirm.charsDetail", { chars: estimate.chars, remaining: aiRemaining }) : t("language.confirm.charsUnknown", { remaining: aiRemaining })}
            </s-text>
            {estimate.chars !== null && estimate.chars > aiRemaining ? <s-text tone="caution">{t("language.confirm.charsOver")}</s-text> : null}
          </Point>
          {estimate.attached ? <s-checkbox ref={attached} label={t("language.confirm.attached")} details={t("language.confirm.attachedDetails")} /> : null}
        </s-stack>
      ) : null}
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor={id}
        command="--hide"
        onClick={() => target && onConfirm({ category: target.category, includeAttached: Boolean(attached.current?.checked) })}
      >
        {target ? t("language.confirm.submit", { what }) : t("language.action.translate")}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        {t("common.action.cancel")}
      </s-button>
    </s-modal>
  );
}
