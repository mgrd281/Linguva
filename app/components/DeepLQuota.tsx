/**
 * The DeepL keys' remaining quota as rings, for the operator's own stores:
 * one ring per key with what is left in the middle, and the state in words.
 * Its parts (ring, key tile, colours, badges) are shared with the
 * translation services card (TranslationEngines.tsx).
 */
import type { DeepLKeyUsage } from "../.server/providers/deepl-usage";
import type { I18n } from "../i18n/i18n";
import { TRACK_COLOUR } from "./Coverage";
import { IconTile } from "./CategoryCard";
import { ITEM_STATE_LOOK } from "./ItemStates";

const RADIUS = 46;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type Key = Omit<DeepLKeyUsage, "plan"> & { plan: string };

/** Share left, 0–100; null when DeepL reports no limit or couldn't be asked. */
export function shareLeft(key: Pick<DeepLKeyUsage, "used" | "limit">): number | null {
  if (key.used === null || key.limit === null || key.limit <= 0) return null;
  return Math.max(0, Math.min(100, ((key.limit - key.used) / key.limit) * 100));
}

export function colourFor(left: number | null, state: DeepLKeyUsage["state"]): string {
  if (state !== "ok" || left === null) return ITEM_STATE_LOOK.missing.colour;
  if (left < 10) return ITEM_STATE_LOOK.failed.colour;
  if (left < 30) return ITEM_STATE_LOOK.outdated.colour;
  return ITEM_STATE_LOOK.complete.colour;
}

export function QuotaRing({ left, colour, figure, caption, label }: { left: number | null; colour: string; figure: string; caption: string; label: string }) {
  const length = left === null ? 0 : Math.max(left > 0 ? 3 : 0, (left / 100) * CIRCUMFERENCE);
  return (
    <div style={{ position: "relative", width: 96, height: 96, flex: "none" }}>
      <svg width={96} height={96} viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={TRACK_COLOUR} strokeWidth={STROKE} />
        {length > 0 ? (
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={colour}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
            transform="rotate(-90 60 60)"
          />
        ) : null}
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 21, lineHeight: 1.15, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{figure}</span>
        <s-text color="subdued">{caption}</s-text>
      </div>
    </div>
  );
}

const STATE_TEXT = {
  resting: "overview.deepl.state.resting",
  refused: "overview.deepl.state.refused",
  unreachable: "overview.deepl.state.unreachable",
} as const;

export const STATE_BADGE = {
  ok: { tone: "success", icon: "check-circle" },
  resting: { tone: "warning", icon: "clock" },
  refused: { tone: "critical", icon: "alert-circle" },
  unreachable: { tone: "neutral", icon: "alert-circle" },
} as const;

/** One key's tile: its ring, plan, hint, usage and state when it isn't ok. */
export function DeepLKeyTile({ keyUsage: key, i18n }: { keyUsage: Key; i18n: I18n }) {
  const { t, number, percent } = i18n;
  const left = shareLeft(key);
  const name = t("overview.deepl.key", { position: key.position });
  const figure = key.state === "refused" || key.state === "unreachable" ? "–" : left === null ? "∞" : percent(Math.floor(left));
  const badge = STATE_BADGE[key.state];
  return (
    <s-box padding="base" border="base" borderRadius="large-100">
      <s-grid gridTemplateColumns="auto 1fr" columnGap="base" alignItems="center">
        <QuotaRing
          left={key.state === "ok" ? left : 0}
          colour={colourFor(left, key.state)}
          figure={figure}
          caption={t("overview.deepl.left")}
          label={t("overview.deepl.ringLabel", { name, figure })}
        />
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">{name}</s-text>
          <s-text color="subdued">
            {key.plan === "free" ? "Free" : "Pro"} · …{key.hint}
          </s-text>
          {key.used !== null ? (
            <s-text>
              {key.limit !== null
                ? t("overview.deepl.remaining", { left: number(Math.max(0, key.limit - key.used)), limit: number(key.limit) })
                : t("overview.deepl.unlimited", { used: number(key.used) })}
            </s-text>
          ) : null}
          {key.state !== "ok" ? (
            <s-stack direction="inline">
              <s-badge tone={badge.tone} icon={badge.icon}>
                {t(STATE_TEXT[key.state])}
              </s-badge>
            </s-stack>
          ) : null}
        </s-stack>
      </s-grid>
    </s-box>
  );
}

export function DeepLQuota({ keys, i18n }: { keys: Key[]; i18n: I18n }) {
  const { t, number } = i18n;
  const counted = keys.filter((k) => k.state !== "refused" && k.used !== null && k.limit !== null);
  const totalLimit = counted.reduce((s, k) => s + (k.limit ?? 0), 0);
  const totalLeft = counted.reduce((s, k) => s + Math.max(0, (k.limit ?? 0) - (k.used ?? 0)), 0);
  return (
    <s-section accessibilityLabel={t("overview.deepl.heading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <IconTile icon="key" size={40} />
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <h2 style={{ margin: 0, fontSize: 16, lineHeight: "24px", fontWeight: 650 }}>{t("overview.deepl.heading")}</h2>
              <s-badge icon="lock">{t("overview.deepl.onlyYou")}</s-badge>
            </s-stack>
            {keys.length > 1 && totalLimit > 0 ? (
              <s-text color="subdued">{t("overview.deepl.total", { left: number(totalLeft), limit: number(totalLimit) })}</s-text>
            ) : null}
          </s-stack>
        </s-stack>
        {keys.length === 0 ? (
          <s-text color="subdued">{t("overview.deepl.none")}</s-text>
        ) : (
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 460px) 1fr 1fr, (inline-size > 720px) 1fr 1fr 1fr, 1fr" gap="base">
              {keys.map((key) => {
                return <DeepLKeyTile key={key.position} keyUsage={key} i18n={i18n} />;
              })}
            </s-grid>
          </s-query-container>
        )}
      </s-stack>
    </s-section>
  );
}
