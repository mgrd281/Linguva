/**
 * The translation services in use, for the operator's own stores when an
 * engine beside DeepL is set up (DeepL alone keeps DeepLQuota): the order,
 * the DeepL keys' rings, and one tile per Microsoft Azure / Google Cloud
 * engine with its state, access, data location and how many of the store's
 * languages it serves. Never a key beyond its last four characters.
 */
import type { EnginesCard, EngineTile } from "../.server/providers/engine-status";
import type { I18n } from "../i18n/i18n";
import { ENGINE_NAMES } from "../lib/engines";
import { IconTile } from "./CategoryCard";
import { DeepLKeyTile } from "./DeepLQuota";

/** The DeepL group's and each engine tile's heading (one level below the card's h2). */
const GROUP_HEADING = { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 650 } as const;

const TILE_BADGE = {
  ok: { tone: "success", icon: "check-circle" },
  resting: { tone: "warning", icon: "clock" },
  refused: { tone: "critical", icon: "alert-circle" },
  unreachable: { tone: "neutral", icon: "alert-circle" },
} as const;

/** The state in words: accepted, resting until a time (used up or not answering), refused, not reachable. */
function stateText(i18n: I18n, tile: EngineTile): string {
  const engine = ENGINE_NAMES[tile.id];
  if (tile.state === "resting" && tile.rest) {
    return i18n.t(tile.rest.kind === "quota" ? "overview.engines.state.quota" : "overview.engines.state.outage", { time: i18n.dateTime(tile.rest.until) });
  }
  if (tile.state === "refused") return i18n.t("overview.engines.state.refused", { engine });
  if (tile.state === "unreachable") return i18n.t("overview.engines.state.unreachable", { engine });
  return i18n.t("overview.engines.state.ok");
}

function accessText(i18n: I18n, tile: EngineTile): string {
  const access = tile.access.kind === "region" ? i18n.t("overview.engines.access.region", { region: tile.access.region }) : i18n.t(`overview.engines.access.${tile.access.kind}`);
  // A key shows its last four characters; a service account its project.
  return tile.access.kind === "serviceAccount" ? `${access} · ${tile.hint}` : `${access} · …${tile.hint}`;
}

function Counts({ i18n, firstChoice, canStepIn, total }: { i18n: I18n; firstChoice: number; canStepIn: number; total: number }) {
  return (
    <s-stack direction="block" gap="small-500">
      <s-text>{i18n.t("overview.engines.firstChoice", { count: firstChoice, total })}</s-text>
      {canStepIn > 0 ? <s-text color="subdued">{i18n.t("overview.engines.canStepIn", { count: canStepIn })}</s-text> : null}
    </s-stack>
  );
}

export function TranslationEngines({ card, i18n }: { card: EnginesCard; i18n: I18n }) {
  const { t } = i18n;
  const order = card.order.map((id) => ENGINE_NAMES[id]).join(" → ");
  return (
    <s-section accessibilityLabel={t("overview.engines.heading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <IconTile icon="globe" size={40} />
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <h2 style={{ margin: 0, fontSize: 16, lineHeight: "24px", fontWeight: 650 }}>{t("overview.engines.heading")}</h2>
              <s-badge icon="lock">{t("overview.deepl.onlyYou")}</s-badge>
            </s-stack>
            <s-text color="subdued">{t("overview.engines.order", { order })}</s-text>
          </s-stack>
        </s-stack>
        {card.deepl ? (
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge>{String(card.deepl.position)}</s-badge>
              <h3 style={GROUP_HEADING}>{t("overview.engines.deepl")}</h3>
            </s-stack>
            {card.deepl.keys.length === 0 ? (
              <s-text color="subdued">{t("overview.deepl.none")}</s-text>
            ) : (
              <s-query-container>
                <s-grid gridTemplateColumns="@container (inline-size > 460px) 1fr 1fr, (inline-size > 720px) 1fr 1fr 1fr, 1fr" gap="base">
                  {card.deepl.keys.map((key) => (
                    <DeepLKeyTile key={key.position} keyUsage={key} i18n={i18n} />
                  ))}
                </s-grid>
              </s-query-container>
            )}
            <Counts i18n={i18n} firstChoice={card.deepl.firstChoice} canStepIn={card.deepl.canStepIn} total={card.totalLanguages} />
          </s-stack>
        ) : null}
        {card.tiles.length ? (
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 460px) 1fr 1fr, 1fr" gap="base">
              {card.tiles.map((tile) => {
                const badge = TILE_BADGE[tile.state];
                return (
                  <s-box key={tile.id} padding="base" border="base" borderRadius="large-100">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-badge>{String(tile.position)}</s-badge>
                        {/* A heading like the DeepL group's: heading navigation reaches the engines whose state matters most. */}
                        <h3 style={GROUP_HEADING}>{ENGINE_NAMES[tile.id]}</h3>
                      </s-stack>
                      <s-text color="subdued">{accessText(i18n, tile)}</s-text>
                      <s-text color="subdued">{t(`overview.engines.dataLocation.${tile.dataLocation}`)}</s-text>
                      <Counts i18n={i18n} firstChoice={tile.firstChoice} canStepIn={tile.canStepIn} total={card.totalLanguages} />
                      <s-stack direction="inline">
                        <s-badge tone={badge.tone} icon={badge.icon}>
                          {stateText(i18n, tile)}
                        </s-badge>
                      </s-stack>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-grid>
          </s-query-container>
        ) : null}
      </s-stack>
    </s-section>
  );
}
