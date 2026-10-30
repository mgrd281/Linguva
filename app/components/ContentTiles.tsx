/**
 * The Content page's pieces ("Inhalte", app/routes/app.content._index.tsx):
 * the language chips, the permission card, the count notice, an area's tile
 * (one link per area, no control inside), the pictures on it, "More texts"
 * with the theme's and the notifications' parts, and the folds of what
 * can't be translated now.
 *
 * Polaris web components; inline styles only where Polaris has nothing (list
 * resets, the picture pile, the summary reset, single-line names), colours
 * from Coverage.tsx only. Every state is an icon and words.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Form, type useFetcher } from "react-router";
import type { ContentArea, ContentGroup, ContentPage } from "../.server/content/content-page";
import type { I18n, MessageKey } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";
import { hasAttached, PART_ICON, showsFigure, TILE_AREAS, type AttachedArea, type AttachedPart, type GroupId, type HubType } from "../lib/content-areas";
import { chipName, chipOrder, switcherKind } from "../lib/content-language";
import type { IconName } from "../lib/icons";
import { CATEGORIES, categoryOf, languagePath, TIERS } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";
import { BIG_FIGURE, detailLine, IconTile, ITEM_COUNT_KEYS } from "./CategoryCard";
import { percentLabel, SURFACE_COLOUR, TRACK_COLOUR } from "./Coverage";
import { Flag } from "./Flag";
import { OpenWorkLine, stateSummary, StateKey, TextStateBar } from "./ItemStates";
import { BIG_HEADING, PLAIN_LIST, StepNumber } from "./LanguageLayout";
import { ProgressBar } from "./ProgressBar";

type Language = ContentPage["languages"][number];
type Fetcher = ReturnType<typeof useFetcher>;

/** A card's heading (15/22, as the language page's tier headings) and the areas' heading (17/24). */
export const H2 = { ...BIG_HEADING, fontSize: 15, lineHeight: "22px", fontWeight: 650 } as const;
const AREAS_HEADING = { ...BIG_HEADING, fontSize: 17, lineHeight: "24px", fontWeight: 650 } as const;
/** A row's percentage, aligned for scanning down the rows. */
const ROW_FIGURE = { fontWeight: 650, fontVariantNumeric: "tabular-nums", textAlign: "end", whiteSpace: "nowrap" } as const;
/** A name that stays on one line (cut with "…" where it can't). */
const ONE_LINE = { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
/** An icon inside a line of text (a link's chevron). */
const INLINE_ICON = { display: "inline-flex", verticalAlign: "middle", marginInlineStart: 2 } as const;
/** A native disclosure's summary as a plain block (no triangle; the browser's focus ring stays). */
const SUMMARY = { display: "block", cursor: "pointer", listStyle: "none" } as const;
/** A card: on a phone too (Polaris draws sections flat there). */
const CARD = { background: "base", border: "base", borderRadius: "large-100" } as const;

/** "Products", "Legal texts": a content type in the merchant's words. */
export function partName(i18n: I18n, type: HubType): string {
  return i18n.t(`content.part.${type}.name`);
}

/** The area a type belongs to, in the language page's words ("Shop & Kasse", "Texte deines Designs"). */
function areaName(i18n: I18n, type: HubType): string {
  const area = categoryOf(type)!;
  return area === "theme" || area === "notifications" ? i18n.t(`language.extra.${area}.name`) : i18n.t(`language.category.${area}.name`);
}

// ─── Language ────────────────────────────────────────────────────────────────

/**
 * "Dänisch: 30 % übersetzt", "Arabisch (versteckt): noch nicht gezählt": a
 * language's chip as a screen reader names it. It is the link's own text,
 * read instead of the chip's words (an `aria-label` would have to repeat
 * those words exactly: WCAG 2.5.3, axe's label-content-name-mismatch).
 */
export function chipLabel(i18n: I18n, language: Language): string {
  const name = chipName(i18n, language);
  const shown = language.published ? name : i18n.t("resources.hiddenLanguage", { language: name });
  return language.measured
    ? i18n.t("content.language.chip", { language: shown, percent: percentLabel(i18n, language.complete, language.total) })
    : i18n.t("content.language.chipNotCounted", { language: shown });
}

function ChipBody({ language, i18n }: { language: Language; i18n: I18n }) {
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
      <Flag country={language.country} fallback={language.locale} size={20} />
      <s-stack direction="block">
        <span style={ONE_LINE}>
          <s-text type="strong">{chipName(i18n, language)}</s-text>
        </span>
        {language.published ? null : (
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-400" alignItems="center">
            <s-icon type="hide" size="small" color="subdued" />
            <span style={ONE_LINE}>
              <s-text color="subdued">{i18n.t("content.language.hidden")}</s-text>
            </span>
          </s-grid>
        )}
      </s-stack>
      <s-text color="subdued" fontVariantNumeric="tabular-nums">
        {language.measured ? percentLabel(i18n, language.complete, language.total) : "—"}
      </s-text>
    </s-grid>
  );
}

/**
 * A chip is 40 px high on a wide page and 44 px on a phone (touch): min-height
 * can't change with the width in Polaris' public props, the padding can.
 */
const CHIP_PADDING = "@container (inline-size > 640px) small-200, small";

/**
 * The store's languages with how far each is: visible ones first, each
 * group by its name; the current one isn't a link. More than six: one
 * select with a "Show" button (nothing changes until it is pressed).
 */
export function LanguageChips({ languages, current, i18n }: { languages: Language[]; current: string; i18n: I18n }) {
  const { t } = i18n;
  const ordered = chipOrder(i18n, languages);
  if (switcherKind(ordered.length) === "select") {
    return (
      <nav aria-label={t("content.language.nav")}>
        <Form method="get" action="/app/content">
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 360px auto 1fr, 1fr auto" gap="small-200" alignItems="end">
            <s-select name="lang" label={t("content.language.label")} value={current}>
              {ordered.map((l) => (
                <s-option key={l.locale} value={l.locale}>
                  {chipLabel(i18n, l)}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit">{t("content.language.show")}</s-button>
          </s-grid>
        </Form>
      </nav>
    );
  }
  return (
    <nav aria-label={t("content.language.nav")}>
      <s-grid gridTemplateColumns="@container (inline-size > 640px) auto 1fr, 1fr" gap="small-200 base" alignItems="center">
        <s-text type="strong">{t("content.language.label")}</s-text>
        <ul style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(168px, 100%), 1fr))", gap: 8 }}>
          {ordered.map((l) => (
            <li key={l.locale}>
              {l.locale === current ? (
                <span aria-current="page" style={{ display: "block" }}>
                  <s-stack
                    direction="block"
                    justifyContent="center"
                    background="strong"
                    border="base strong"
                    borderRadius="large-200"
                    paddingInline="base"
                    paddingBlock={CHIP_PADDING}
                    minBlockSize="40px"
                  >
                    <ChipBody language={l} i18n={i18n} />
                  </s-stack>
                </span>
              ) : (
                <s-clickable href={`/app/content?lang=${encodeURIComponent(l.locale)}`} background="base" border="base" borderRadius="large-200" inlineSize="100%">
                  <s-text accessibilityVisibility="exclusive">{chipLabel(i18n, l)}</s-text>
                  <s-stack direction="block" justifyContent="center" paddingInline="base" paddingBlock={CHIP_PADDING} minBlockSize="40px" accessibilityVisibility="hidden">
                    <ChipBody language={l} i18n={i18n} />
                  </s-stack>
                </s-clickable>
              )}
            </li>
          ))}
        </ul>
      </s-grid>
    </nav>
  );
}

/**
 * Under the chips: when the language was last counted, the way to its
 * language page (the next steps and the buttons that translate), and why a
 * hidden language or one outside the plan needs something first.
 */
export function LanguageMeta({ data, i18n }: { data: ContentPage; i18n: I18n }) {
  const { t } = i18n;
  const language = data.language!;
  const inSentence = i18n.language(language.locale, language.name);
  const counted = data.measured && data.measuredAt ? t("language.countedAt", { date: i18n.dateTime(data.measuredAt) }) : null;
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {counted ? <s-text color="subdued">{counted}</s-text> : null}
        {counted ? (
          <s-box display="@container (inline-size > 640px) auto, none">
            <span aria-hidden="true">
              <s-text color="subdued">·</s-text>
            </span>
          </s-box>
        ) : null}
        <s-link href={languagePath(language.locale)}>
          {t("content.language.next", { language: inSentence })}
          <span style={INLINE_ICON}>
            <s-icon type="chevron-right" size="small" />
          </span>
        </s-link>
      </s-stack>
      {language.published ? null : (
        <s-text color="subdued">
          {t("language.hiddenHelp")}{" "}
          <s-link href="shopify://admin/settings/languages" target="_top">
            {t("language.publishInShopify")}
          </s-link>
        </s-text>
      )}
      {data.planIncludes ? null : (
        <s-text color="subdued">
          {t("content.language.notInPlan", { language: inSentence })} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
        </s-text>
      )}
    </s-stack>
  );
}

// ─── Cards above the areas ──────────────────────────────────────────────────

/** A card with a picture on the left (hidden on a phone), its words, and its action. */
function NoticeCard({ id, icon, heading, children, action, wide = 640 }: { id: string; icon: IconName; heading: string; children?: ReactNode; action?: ReactNode; wide?: 560 | 640 }) {
  const grid = wide === 560 ? "@container (inline-size > 560px) auto 1fr auto, 1fr" : "@container (inline-size > 640px) auto 1fr auto, 1fr";
  const picture = wide === 560 ? "@container (inline-size > 560px) auto, none" : "@container (inline-size > 640px) auto, none";
  return (
    <section aria-labelledby={id}>
      <s-box {...CARD} padding="base">
        <s-grid gridTemplateColumns={grid} gap="base" alignItems="center">
          <s-box display={picture}>
            <IconTile icon={icon} />
          </s-box>
          <s-stack direction="block" gap="small-300">
            <h2 id={id} style={H2}>
              {heading}
            </h2>
            {children}
          </s-stack>
          {action ? <s-stack direction="inline">{action}</s-stack> : null}
        </s-grid>
      </s-box>
    </section>
  );
}

/**
 * Everything Linguva may not read yet, as permissions ("Legal texts"), and
 * one button that asks Shopify for all of them on one screen.
 */
export function AccessCard({ rows, fetcher, i18n, primary }: { rows: ContentPage["access"]; fetcher: Fetcher; i18n: I18n; primary: boolean }) {
  const { t } = i18n;
  const scopeName = (scope: string) => {
    const key = `content.access.scope.${scope}`;
    return hasMessage(key) ? t(key) : scope;
  };
  return (
    <section aria-labelledby="content-access">
      <s-box {...CARD} padding="large">
        <s-grid gridTemplateColumns="@container (inline-size > 560px) auto 1fr, 1fr" gap="base">
          <s-box display="@container (inline-size > 560px) auto, none">
            <IconTile icon="lock" />
          </s-box>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-300">
              <h2 id="content-access" style={H2}>
                {t("content.access.heading")}
              </h2>
              <s-paragraph color="subdued">{t("content.access.body")}</s-paragraph>
            </s-stack>
            <ul aria-label={t("content.access.list")} style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {rows.map((row) => (
                <li key={row.scope}>
                  <s-chip>
                    <s-icon slot="graphic" type="lock" />
                    {scopeName(row.scope)}
                  </s-chip>
                </li>
              ))}
            </ul>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="request-scope" />
              {rows.map((row) => (
                <input key={row.scope} type="hidden" name="scope" value={row.scope} />
              ))}
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                <s-button type="submit" variant={primary ? "primary" : "secondary"} {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                  {t("content.access.allow")}
                </s-button>
                <s-text color="subdued">{t("content.access.once")}</s-text>
              </s-stack>
            </fetcher.Form>
          </s-stack>
        </s-grid>
      </s-box>
    </section>
  );
}

/** The count notice the page shows, in this order: not counted, counting, the last count stalled or failed, newly unlocked. */
export type CountNoticeKind = "notCounted" | "counting" | "stalled" | "failed" | "recount";

export function countNotice(data: Pick<ContentPage, "language" | "measured" | "scanning" | "measurement" | "recount">): CountNoticeKind | null {
  if (!data.language) return null;
  if (!data.measured && !data.scanning) return "notCounted";
  if (data.scanning) return "counting";
  if (data.measurement.state === "stalled" || data.measurement.state === "failed") return data.measurement.state;
  const underWay = data.measurement.state === "queued" || data.measurement.state === "waiting" || data.measurement.state === "running";
  return data.recount.length && !underWay ? "recount" : null;
}

/**
 * The language isn't counted yet, a count reads it now, the last count
 * stalled or failed, or content was unlocked since the last count: what that
 * means, and the button that counts (none while a count runs, or where
 * background jobs can't run).
 */
export function CountCard({ data, i18n, counter, primary }: { data: ContentPage; i18n: I18n; counter: Fetcher; primary: boolean }) {
  const { t } = i18n;
  const kind = countNotice(data);
  if (!kind || !data.language) return null;
  const inSentence = i18n.language(data.language.locale, data.language.name);
  const m = data.measurement;
  const button = (label: string) =>
    m.state === "unavailable" ? (
      <s-text color="subdued">{t("coverage.error.JOBS_UNAVAILABLE")}</s-text>
    ) : data.canCount ? (
      <counter.Form method="post">
        <input type="hidden" name="intent" value="run" />
        <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
        <s-button type="submit" variant={primary ? "primary" : "secondary"} {...(counter.state !== "idle" ? { loading: true } : {})}>
          {label}
        </s-button>
      </counter.Form>
    ) : undefined;
  switch (kind) {
    case "notCounted":
      return (
        <NoticeCard id="content-count" icon="chart-donut" heading={t("content.count.heading", { language: upperFirst(inSentence) })} action={button(t("language.next.count.action"))}>
          <s-paragraph color="subdued">
            {t("language.hero.notCountedHelp")} {t("language.next.count.detail", { language: inSentence })}
          </s-paragraph>
        </NoticeCard>
      );
    case "counting":
      return (
        <NoticeCard id="content-count" icon="chart-donut" heading={t("language.hero.counting")}>
          <s-paragraph color="subdued">{t("language.hero.countingHelp")}</s-paragraph>
          {m.state === "running" ? (
            <s-stack direction="block" gap="small-300">
              <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("language.hero.progressLabel")} />
              <s-text color="subdued">{t("language.hero.progress", { done: m.done, total: m.total })}</s-text>
            </s-stack>
          ) : null}
        </NoticeCard>
      );
    case "stalled":
    case "failed":
      return (
        <NoticeCard id="content-count" icon="chart-donut" heading={kind === "stalled" ? t("language.hero.stalled") : t("language.hero.countFailed")} action={button(t("language.next.recount.action"))} />
      );
    case "recount":
      return (
        <NoticeCard
          id="content-count"
          icon="unlock"
          heading={t("content.recount.heading", { parts: languageList(i18n, data.recount.map((type) => partName(i18n, type))) })}
          action={button(t("language.next.recount.action"))}
        >
          <s-paragraph color="subdued">{t("content.recount.body")}</s-paragraph>
        </NoticeCard>
      );
  }
}

/** No additional language yet: where to add one (the areas still show what the store has). */
export function NoLanguagesCard({ i18n }: { i18n: I18n }) {
  const { t } = i18n;
  return (
    <NoticeCard
      id="content-no-languages"
      icon="language"
      heading={t("content.noLanguages.heading")}
      wide={560}
      action={
        <s-button variant="primary" href="shopify://admin/settings/languages" target="_top">
          {t("resources.noLanguages.open")}
        </s-button>
      }
    >
      <s-paragraph color="subdued">{t("content.noLanguages.body")}</s-paragraph>
    </NoticeCard>
  );
}

// ─── Area tiles ──────────────────────────────────────────────────────────────

/** Pictures of a tile's items: undefined where the tile shows none, null while they load. */
export type TilePictures = Array<{ url: string }> | null | undefined;

/** Up to four pictures of an area's items, overlapping (decorative: the area is named beside them). */
export function FacePile({ items }: { items: Array<{ url: string }> | null }) {
  const square = { width: 30, height: 30, borderRadius: 8, boxShadow: `0 0 0 2px ${SURFACE_COLOUR}`, background: TRACK_COLOUR, flex: "none" } as const;
  if (items === null) {
    return (
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ ...square, display: "block", marginInlineStart: i ? -8 : 0 }} />
        ))}
      </span>
    );
  }
  if (!items.length) return null;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex" }}>
      {items.slice(0, 4).map((item, i) => (
        <img key={item.url} src={item.url} alt="" loading="lazy" style={{ ...square, display: "block", objectFit: "cover", marginInlineStart: i ? -8 : 0 }} />
      ))}
    </span>
  );
}

/** Each area's sentence for what is translated with its items (literal keys: no dynamic family). */
const ATTACHED_NOTE: Record<AttachedArea, MessageKey> = {
  products: "content.tile.attached.products",
  collections: "content.tile.attached.collections",
  pages: "content.tile.attached.pages",
  blog: "content.tile.attached.blog",
};
const ATTACHED_PART: Record<AttachedPart, MessageKey> = {
  images: "content.tile.attachedPart.images",
  customFields: "content.tile.attachedPart.customFields",
};
const ATTACHED_ICON: Record<AttachedPart, IconName> = { images: "image", customFields: "metafields" };

/** A line under a tile's head: what keeps it from a figure, or what to do. */
interface TileLine {
  icon?: IconName;
  text: string;
}

/** The refused types of a tile or a group, in two kinds: a permission the card above can give, and none anyone can. */
function refusedLines(i18n: I18n, area: Pick<ContentArea, "locked" | "unavailable">): TileLine[] {
  const names = (types: readonly HubType[]) => languageList(i18n, types.map((type) => partName(i18n, type)));
  return [
    ...(area.locked.length ? [{ icon: "lock" as const, text: i18n.t("content.tile.locked", { parts: names(area.locked) }) }] : []),
    ...(area.unavailable.length ? [{ icon: "disabled" as const, text: i18n.t("content.tile.unavailable", { parts: names(area.unavailable) }) }] : []),
  ];
}

/** The words a tile shows instead of (or, while incomplete, under) its open work. */
export function tileLines(i18n: I18n, area: Pick<ContentArea, "state" | "locked" | "unavailable">): TileLine[] {
  const { t } = i18n;
  switch (area.state) {
    case "refused":
      return refusedLines(i18n, area);
    case "recount":
      return [{ text: t("content.tile.recount") }];
    case "counting":
      return [{ text: t("language.card.counting") }];
    case "notCounted":
      return [{ text: t("language.hero.notCounted") }];
    case "incomplete":
      return [{ text: t("language.card.incomplete") }];
    case "new":
      return [{ text: t("content.tile.new") }];
    case "nothing":
      return [{ text: t("language.hero.nothing") }];
    case "figure":
      return [];
  }
}

/**
 * The tile's name for screen readers: with a figure, the percentage and every
 * state with texts; otherwise the area and its lines; and that a translation
 * runs. It is the link's own text, read instead of the words inside the tile
 * (which are hidden from screen readers, so nothing is read twice).
 */
export function tileLabel(i18n: I18n, area: Pick<ContentArea, "id" | "state" | "tally" | "locked" | "unavailable" | "translating">): string {
  const name = i18n.t(`language.category.${area.id}.name`);
  const figure = showsFigure(area.state) && area.tally && area.tally.total > 0 ? area.tally : null;
  const parts = [
    figure ? i18n.t("content.tile.label", { area: name, percent: percentLabel(i18n, figure.complete, figure.total), states: stateSummary(i18n, figure.counts) }) : name,
    ...tileLines(i18n, area).map((line) => line.text),
    ...(area.translating ? [i18n.t("language.card.jobFinding")] : []),
  ];
  return `${parts.map((part) => part.replace(/[.\s]+$/, "")).join(". ")}.`;
}

function Lines({ lines, boxed }: { lines: TileLine[]; boxed: boolean }) {
  const list = (
    <s-stack direction="block" gap="small-300">
      {lines.map((line) =>
        line.icon ? (
          <s-grid key={line.text} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
            <s-icon type={line.icon} size="small" color="subdued" />
            <s-text>{line.text}</s-text>
          </s-grid>
        ) : (
          <s-text key={line.text} color="subdued">
            {line.text}
          </s-text>
        ),
      )}
    </s-stack>
  );
  return boxed ? (
    <s-box background="subdued" borderRadius="base" padding="small-200 base">
      {list}
    </s-box>
  ) : (
    list
  );
}

/**
 * One area as a whole-card link to its list in the chosen language: icon,
 * name and what it holds, the figure (or "—"), the bar, its open work, the
 * pictures of a few items, a running translation, and what is translated
 * with its items. Without a language: the same card, not a link, no figure.
 */
export function AreaTile({ area, i18n, pictures }: { area: ContentArea; i18n: I18n; pictures: TilePictures }) {
  const { t } = i18n;
  const name = t(`language.category.${area.id}.name`);
  const linked = area.href !== null;
  const figure = showsFigure(area.state) && area.tally ? area.tally : null;
  const countKey = ITEM_COUNT_KEYS[area.id];
  const itemsText = countKey && area.items ? t(countKey, { count: area.items }) : null;
  const wideDetail = detailLine(i18n, area);
  const narrowDetail = itemsText ?? detailLine(i18n, { ...area, items: null });
  const lines = tileLines(i18n, area);
  // Its state in words (open work with a figure), beside the pictures; without a language, only what is refused.
  const status =
    linked || area.state === "refused" ? (
      lines.length ? (
        <Lines lines={lines} boxed={area.state === "refused"} />
      ) : figure ? (
        <OpenWorkLine counts={figure.counts} i18n={i18n} />
      ) : null
    ) : null;
  const attachedNote =
    hasAttached(area.id) && area.attached.length
      ? upperFirst(t(ATTACHED_NOTE[area.id], { parts: languageList(i18n, area.attached.map((part) => t(ATTACHED_PART[part]))) }))
      : null;
  const body = (
    <s-query-container>
      <s-stack direction="block" gap="small-200" blockSize="100%" justifyContent="space-between" accessibilityVisibility={linked ? "hidden" : "visible"}>
        <s-stack direction="block" gap="small-200">
          <s-grid gridTemplateColumns={linked ? "auto minmax(0, 1fr) auto auto" : "auto minmax(0, 1fr)"} gap="base" alignItems="start">
            <IconTile icon={CATEGORIES[area.id].icon} />
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{name}</s-text>
              {wideDetail ? (
                <s-box display="@container (inline-size > 420px) auto, none">
                  <s-text color="subdued">{wideDetail}</s-text>
                </s-box>
              ) : null}
              {narrowDetail ? (
                <s-box display="@container (inline-size > 420px) none, auto">
                  <s-text color="subdued">{narrowDetail}</s-text>
                </s-box>
              ) : null}
            </s-stack>
            {linked ? (
              <s-stack direction="block" alignItems="end">
                {figure && figure.total > 0 ? (
                  <span style={BIG_FIGURE}>{percentLabel(i18n, figure.complete, figure.total)}</span>
                ) : (
                  <s-text color="subdued">
                    <span style={BIG_FIGURE}>—</span>
                  </s-text>
                )}
                {figure && figure.total > 0 ? (
                  <s-box display="@container (inline-size > 420px) auto, none">
                    <s-text color="subdued">{t("language.card.figure", { complete: figure.complete, total: figure.total })}</s-text>
                  </s-box>
                ) : null}
              </s-stack>
            ) : null}
            {linked ? (
              <s-stack direction="block" justifyContent="center" blockSize="28px">
                <s-icon type="chevron-right" color="subdued" />
              </s-stack>
            ) : null}
          </s-grid>
          {figure && figure.total > 0 ? (
            <div aria-hidden="true">
              <TextStateBar counts={figure.counts} label={name} i18n={i18n} />
            </div>
          ) : null}
          {status && pictures !== undefined ? (
            <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
              {status}
              <s-box display="@container (inline-size > 420px) auto, none">
                <FacePile items={pictures} />
              </s-box>
            </s-grid>
          ) : (
            status
          )}
          {area.translating ? (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="in-progress" tone="info" size="small" />
              <s-text>{t("language.card.jobFinding")}</s-text>
            </s-stack>
          ) : null}
        </s-stack>
        {attachedNote ? (
          <s-stack direction="block" gap="small-200">
            <s-divider />
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
              <s-stack direction="inline" gap="small-300">
                {area.attached.map((part) => (
                  <s-icon key={part} type={ATTACHED_ICON[part]} size="small" color="subdued" />
                ))}
              </s-stack>
              <s-text color="subdued">{attachedNote}</s-text>
            </s-grid>
          </s-stack>
        ) : null}
      </s-stack>
    </s-query-container>
  );
  return linked ? (
    <s-clickable href={area.href!} {...CARD} padding="base" blockSize="100%">
      <s-text accessibilityVisibility="exclusive">{tileLabel(i18n, area)}</s-text>
      {body}
    </s-clickable>
  ) : (
    <s-box {...CARD} padding="base" blockSize="100%">
      {body}
    </s-box>
  );
}

/**
 * "Area by area": the tiles in the language page's tiers, the order
 * customers meet them, two columns (one on a phone), with the key to the
 * states while a language is shown.
 */
export function Areas({ areas, i18n, picturesOf, withKey }: { areas: ContentArea[]; i18n: I18n; picturesOf: (area: ContentArea) => TilePictures; withKey: boolean }) {
  const { t } = i18n;
  const tiers = TIERS.map((tier) => ({ id: tier.id, areas: areas.filter((a) => a.tier === tier.id && TILE_AREAS.includes(a.id)) })).filter((tier) => tier.areas.length);
  if (!tiers.length) return null;
  return (
    <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="@container (inline-size > 760px) 1fr auto, 1fr" gap="small-200 base" alignItems="end">
        <s-stack direction="block" gap="small-500">
          <h2 style={AREAS_HEADING}>{t("language.areas.heading")}</h2>
          <s-text color="subdued">{t("language.areas.introNoPercent")}</s-text>
        </s-stack>
        {withKey ? <StateKey i18n={i18n} /> : null}
      </s-grid>
      {tiers.map((tier, n) => (
        <section key={tier.id} aria-labelledby={`tier-${tier.id}`}>
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <StepNumber n={n + 1} first />
              <h3 id={`tier-${tier.id}`} style={H2}>
                {t(`language.tier.${tier.id}.name`)}
              </h3>
              <s-box display="@container (inline-size > 500px) auto, none">
                <s-text color="subdued">– {t(`language.tier.${tier.id}.why`)}</s-text>
              </s-box>
            </s-stack>
            <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
              {tier.areas.map((area) => (
                <AreaTile key={area.id} area={area} i18n={i18n} pictures={picturesOf(area)} />
              ))}
            </s-grid>
          </s-stack>
        </section>
      ))}
    </s-stack>
  );
}

// ─── More texts ──────────────────────────────────────────────────────────────

const ROW_GRID = "@container (inline-size > 560px) auto 1fr 140px 52px auto, auto 1fr auto auto";
const PART_GRID = "@container (inline-size > 560px) auto 1fr 96px 52px auto, auto 1fr auto auto";

/** A row's bar (wide only; its information is in the row's words) and percentage. */
function RowFigure({ tally, name, i18n }: { tally: ContentGroup["tally"]; name: string; i18n: I18n }) {
  return (
    <>
      <s-box display="@container (inline-size > 560px) auto, none">
        <div aria-hidden="true">{tally && tally.total > 0 ? <TextStateBar counts={tally.counts} label={name} i18n={i18n} /> : null}</div>
      </s-box>
      <span style={ROW_FIGURE}>{tally && tally.total > 0 ? percentLabel(i18n, tally.complete, tally.total) : "—"}</span>
    </>
  );
}

function PartRow({ part, i18n }: { part: ContentGroup["parts"][number]; i18n: I18n }) {
  const { t } = i18n;
  const name = t(`content.part.${part.type}.name`);
  const inner = (
    <s-grid gridTemplateColumns={PART_GRID} gap="base" alignItems="center">
      <s-icon type={PART_ICON[part.type]} color="subdued" size="small" />
      <s-stack direction="block" gap="small-500">
        <s-text type="strong">{name}</s-text>
        <s-text color="subdued">{t(`content.part.${part.type}.hint`)}</s-text>
      </s-stack>
      <RowFigure tally={part.tally} name={name} i18n={i18n} />
      {part.href ? <s-icon type="chevron-right" color="subdued" /> : <span />}
    </s-grid>
  );
  return part.href ? (
    <s-clickable href={part.href} padding="small-200 base" minBlockSize="44px">
      {inner}
    </s-clickable>
  ) : (
    <s-box padding="small-200 base" minBlockSize="44px">
      {inner}
    </s-box>
  );
}

/**
 * The theme's or the notifications' texts: one row that opens their parts,
 * each a link to its list. Refused in part: the refused types are named
 * instead of a percentage, and the parts Linguva may read still open below.
 */
function GroupRow({ id, group, requested, i18n }: { id: GroupId; group: ContentGroup; requested: boolean; i18n: I18n }) {
  const { t } = i18n;
  const [open, setOpen] = useState(requested);
  const name = t(`language.extra.${id}.name`);
  const detail = t(`language.extra.${id}.detail`);
  const parts = t("content.more.parts", { count: group.parts.length });
  const lines = group.state === "recount" || group.state === "new" || group.state === "incomplete" ? tileLines(i18n, group) : [];
  const refused = group.state === "refused" ? refusedLines(i18n, group) : [];
  return (
    <details id={id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary style={SUMMARY}>
        <s-stack direction="block" justifyContent="center" padding="small-200 base" minBlockSize="64px">
          <s-grid gridTemplateColumns={ROW_GRID} gap="base" alignItems="center">
            <IconTile icon={id === "theme" ? "theme" : "email"} />
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{name}</s-text>
              <s-text color="subdued">
                {detail} · <span style={{ whiteSpace: "nowrap" }}>{parts}</span>
              </s-text>
              {lines.map((line) => (
                <s-text key={line.text} color="subdued">
                  {line.text}
                </s-text>
              ))}
              {refused.length ? <Lines lines={refused} boxed /> : null}
            </s-stack>
            <RowFigure tally={group.tally} name={name} i18n={i18n} />
            <s-icon type={open ? "chevron-up" : "chevron-down"} color="subdued" />
          </s-grid>
        </s-stack>
      </summary>
      <s-box padding="none base base">
        <s-box border="base" borderRadius="base">
          <ul style={PLAIN_LIST}>
            {group.parts.map((part, i) => (
              <li key={part.type}>
                {i > 0 ? <s-divider /> : null}
                <PartRow part={part} i18n={i18n} />
              </li>
            ))}
          </ul>
        </s-box>
      </s-box>
    </details>
  );
}

/** A group Linguva may read nothing of: the refused types instead of its percentage, and no parts to open. */
function RefusedRow({ id, group, i18n }: { id: GroupId; group: ContentGroup; i18n: I18n }) {
  const { t } = i18n;
  return (
    <div id={id}>
      <s-stack direction="block" justifyContent="center" padding="small-200 base" minBlockSize="64px">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="center">
          <IconTile icon={id === "theme" ? "theme" : "email"} />
          <s-stack direction="block" gap="small-200">
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{t(`language.extra.${id}.name`)}</s-text>
              <s-text color="subdued">{t(`language.extra.${id}.detail`)}</s-text>
            </s-stack>
            <Lines lines={refusedLines(i18n, group)} boxed />
          </s-stack>
          <span style={ROW_FIGURE}>—</span>
        </s-grid>
      </s-stack>
    </div>
  );
}

/**
 * "More texts": what the language's percentage leaves out. The theme's and
 * the notifications' texts open their parts (a requested one is open and
 * scrolled to); the web addresses are a link.
 */
export function MoreTexts({ extras, open, i18n }: { extras: ContentPage["extras"]; open: ContentPage["open"]; i18n: I18n }) {
  const { t } = i18n;
  // A group asked for in the URL (from a language page) comes into view once.
  useEffect(() => {
    if (open) document.getElementById(open)?.scrollIntoView({ block: "start" });
  }, [open]);
  const groups = (["theme", "notifications"] as const).flatMap((id) => (extras[id] ? [{ id, group: extras[id]! }] : []));
  if (!groups.length && !extras.urls) return null;
  const urlsName = t("language.extra.urls.name");
  return (
    <section aria-labelledby="content-more">
      <s-box {...CARD} padding="none">
        <s-box padding="base">
          <s-stack direction="block" gap="small-500">
            <h2 id="content-more" style={H2}>
              {t("content.more.heading")}
            </h2>
            <s-text color="subdued">{t("language.extras.intro")}</s-text>
          </s-stack>
        </s-box>
        <ul style={PLAIN_LIST}>
          {groups.map(({ id, group }) => (
            <li key={id}>
              <s-divider />
              {group.state === "refused" && !group.parts.length ? (
                <RefusedRow id={id} group={group} i18n={i18n} />
              ) : (
                <GroupRow id={id} group={group} requested={open === id} i18n={i18n} />
              )}
            </li>
          ))}
          {extras.urls ? (
            <li>
              <s-divider />
              <s-clickable href={extras.urls.href} padding="small-200 base" minBlockSize="64px">
                <s-grid gridTemplateColumns={ROW_GRID} gap="base" alignItems="center">
                  <IconTile icon="link" />
                  <s-stack direction="block" gap="small-500">
                    <s-text type="strong">{urlsName}</s-text>
                    <s-text color="subdued">{t("language.extra.urls.detail")}</s-text>
                  </s-stack>
                  <RowFigure tally={extras.urls.tally} name={urlsName} i18n={i18n} />
                  <s-icon type="chevron-right" color="subdued" />
                </s-grid>
              </s-clickable>
            </li>
          ) : null}
        </ul>
      </s-box>
    </section>
  );
}

// ─── Folds ───────────────────────────────────────────────────────────────────

function Fold({ heading, note, types, i18n }: { heading: string; note: string; types: HubType[]; i18n: I18n }) {
  const [open, setOpen] = useState(false);
  const names = types.map((type) => partName(i18n, type));
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary style={SUMMARY}>
        <s-stack direction="inline" gap="small-200" alignItems="center" padding="small-200 base" minBlockSize="52px">
          <s-icon type={open ? "chevron-down" : "chevron-right"} size="small" />
          <s-text type="strong">{heading}</s-text>
          <s-badge>{i18n.number(types.length)}</s-badge>
          {open ? null : <s-text color="subdued">{languageList(i18n, names, 4)}</s-text>}
        </s-stack>
      </summary>
      <s-box padding="none base base">
        <s-stack direction="block" gap="small-200">
          <s-paragraph color="subdued">{note}</s-paragraph>
          <ul style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: "4px 16px" }}>
            {types.map((type, i) => {
              const area = areaName(i18n, type);
              return (
                <li key={type}>
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                    <IconTile icon={PART_ICON[type]} size={28} />
                    <span>
                      <s-text type="strong">{names[i]}</s-text>
                      {/* The area, unless it has the type's own name ("Größentabellen & Co."). */}
                      {area === names[i] ? null : <s-text color="subdued"> · {area}</s-text>}
                    </span>
                  </s-grid>
                </li>
              );
            })}
          </ul>
        </s-stack>
      </s-box>
    </details>
  );
}

/** What can't be translated now: not in the store yet, and what Shopify doesn't let apps read. Folded, with counts. */
export function Folds({ empty, unavailable, i18n }: { empty: HubType[]; unavailable: HubType[]; i18n: I18n }) {
  const { t } = i18n;
  if (!empty.length && !unavailable.length) return null;
  return (
    <section aria-label={t("content.folds.label")}>
      <s-box {...CARD} padding="none">
        {empty.length ? <Fold heading={t("content.empty.heading")} note={t("content.empty.note")} types={empty} i18n={i18n} /> : null}
        {empty.length && unavailable.length ? <s-divider /> : null}
        {unavailable.length ? <Fold heading={t("content.unavailable.heading")} note={t("content.unavailable.note")} types={unavailable} i18n={i18n} /> : null}
      </s-box>
    </section>
  );
}

