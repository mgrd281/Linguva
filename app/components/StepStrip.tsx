/**
 * How a text gets to customers, in three numbered steps with one figure
 * each: to translate (missing, outdated, failed), waiting for the
 * merchant's approval, and live. It explains why the percentage only rises
 * after approving. Steps two and three are tinted in their states' colours;
 * on a phone each step is its figure and a short label.
 */
import type { I18n } from "../i18n/i18n";
import { STATE_COLOURS, SURFACE_COLOUR, TRACK_COLOUR } from "./Coverage";

const box = (background: string, border: string) =>
  ({ background, border: `1px solid ${border}`, borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }) as const;

// Light tints of the states' colours (hex alpha), so the colour source stays Coverage.tsx.
const BOXES = [
  box(SURFACE_COLOUR, TRACK_COLOUR),
  box(`${STATE_COLOURS.draft}14`, `${STATE_COLOURS.draft}40`),
  box(`${STATE_COLOURS.complete}14`, `${STATE_COLOURS.complete}40`),
];

/** Narrower than this, each step shows its figure and a short label only, side by side. */
const WIDE = "@container (inline-size > 640px) auto, none";
const NARROW = "@container (inline-size > 640px) none, auto";

export function StepStrip({ steps, percent, label, i18n }: { steps: { open: number; waiting: number; live: number }; percent: string; label: string; i18n: I18n }) {
  const { t } = i18n;
  const items = [
    { title: t("language.strip.translate"), short: t("language.strip.translateShort"), count: steps.open, detail: t("language.strip.translateDetail", { count: steps.open }) },
    {
      title: t("language.strip.review"),
      short: t("language.strip.reviewShort"),
      count: steps.waiting,
      detail: steps.waiting ? t("language.strip.reviewDetail", { count: steps.waiting }) : t("language.strip.reviewNone"),
    },
    { title: t("language.strip.live"), short: t("language.strip.liveShort"), count: steps.live, detail: t("language.strip.liveDetail", { count: steps.live, percent }) },
  ];
  return (
    <section aria-label={label}>
      <s-query-container>
        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="@container (inline-size > 640px) base, small-200">
          {items.map((item, i) => (
            <div key={item.title} style={BOXES[i]}>
              <s-box display={WIDE}>
                <s-text type="strong">{item.title}</s-text>
              </s-box>
              <span style={{ fontSize: 24, lineHeight: "30px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{i18n.number(item.count)}</span>
              <s-box display={WIDE}>
                <s-text>{item.detail}</s-text>
              </s-box>
              <s-box display={NARROW}>
                <s-text>{item.short}</s-text>
              </s-box>
            </div>
          ))}
        </s-grid>
      </s-query-container>
    </section>
  );
}
