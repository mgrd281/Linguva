/**
 * How a text gets to customers, in three numbered steps with one figure
 * each: to translate (missing, outdated, failed), waiting for the
 * merchant's approval, and live. It explains why the percentage only rises
 * after approving, so the language page shows it while texts wait for
 * approval. Each step leads with its state's icon; steps two and three are
 * tinted in their states' colours; on a phone each step is its figure and a
 * short label.
 */
import type { I18n } from "../i18n/i18n";
import { STATE_COLOURS, SURFACE_COLOUR, TRACK_COLOUR } from "./Coverage";
import { StateIcon } from "./ItemStates";
import { Strong } from "./Type";

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
    {
      // Translating has one picture app-wide; the wand is kept for the button that lets the AI do it.
      icon: <s-icon type="language-translate" color="subdued" size="small" />,
      title: t("language.strip.translate"),
      short: t("language.strip.translateShort"),
      count: steps.open,
      detail: t("language.strip.translateDetail", { count: steps.open }),
    },
    {
      icon: <StateIcon state="waiting" size="small" />,
      title: t("language.strip.review"),
      short: t("language.strip.reviewShort"),
      count: steps.waiting,
      detail: steps.waiting ? t("language.strip.reviewDetail", { count: steps.waiting }) : t("language.strip.reviewNone"),
    },
    {
      icon: <StateIcon state="complete" size="small" />,
      title: t("language.strip.live"),
      short: t("language.strip.liveShort"),
      count: steps.live,
      detail: t("language.strip.liveDetail", { count: steps.live, percent }),
    },
  ];
  return (
    <section aria-label={label}>
      <s-query-container>
        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="@container (inline-size > 640px) base, small-200">
          {items.map((item, i) => (
            <div key={item.title} style={BOXES[i]}>
              <s-box display={WIDE}>
                <s-stack direction="inline" gap="small-300" alignItems="center">
                  {item.icon}
                  <Strong>{item.title}</Strong>
                </s-stack>
              </s-box>
              <span className="lv-figure">{i18n.number(item.count)}</span>
              <s-box display={WIDE}>
                <s-text>{item.detail}</s-text>
              </s-box>
              <s-box display={NARROW}>
                <s-stack direction="inline" gap="small-300" alignItems="center">
                  {item.icon}
                  <s-text>{item.short}</s-text>
                </s-stack>
              </s-box>
            </div>
          ))}
        </s-grid>
      </s-query-container>
    </section>
  );
}
