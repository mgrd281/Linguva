/**
 * The translation editor's pieces (ResourceTranslationEditor, AttachedResourcesPanel): a text's name in
 * the merchant's words (Review's: Name, Beschreibung, Google-Titel, Webadresse), its one state as a
 * badge with its icon (a web address nobody wrote yet: optional), the notes beside it, a section's
 * heading row with its badges and action, the square tiles that jump to each text, and the count
 * inside a button. Styles in app/styles/ui.css (the editor's section, .lv-ed-*), the tiles on
 * Settings' .lv-tile.
 */
import type { MouseEvent, ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import { fieldName, issueName } from "../i18n/labels";
import type { IconName } from "../lib/icons";
import type { TextState } from "../lib/editor-view";
import { IconSquare, type Tint } from "./IconSquare";
import { focusSection } from "./SettingsParts";

/** Pages, blog posts and blogs have a title, everything else a name (as the area lists and Review say). */
const TITLED: ReadonlySet<string> = new Set(["PAGE", "ARTICLE", "BLOG"]);

/** Whether the kind's first text is a title: every text that mentions it says "title" too, not "name". */
export const isTitled = (kind: string) => TITLED.has(kind);

/** A text's name: Review's words where it has them, Shopify's field names otherwise ("Summary", "Product type"). */
export function textName(i18n: I18n, key: string, kind: string): string {
  const { t } = i18n;
  if (key === "title" || key === "name" || key === "label") return isTitled(kind) ? t("language.list.text.heading") : t("language.list.text.title");
  if (key === "body_html" || key === "body" || key === "description") return t("language.list.text.description");
  if (key === "meta_title") return t("language.list.text.seo_title");
  if (key === "meta_description") return t("language.list.text.seo_description");
  if (key === "handle") return t("review.field.handle");
  return fieldName(i18n, key);
}

type BadgeTone = "info" | "success" | "caution" | "critical" | undefined;

/** One icon per state, as the language pages draw them (ITEM_STATE_LOOK); a draft says where it came from. */
export const TEXT_STATE_LOOK: Record<TextState, { icon: IconName; tone: BadgeTone }> = {
  draft: { icon: "wand", tone: "info" },
  memory: { icon: "database", tone: "info" },
  edited: { icon: "edit", tone: "info" },
  published: { icon: "check-circle-filled", tone: "success" },
  outdated: { icon: "refresh", tone: "caution" },
  translated: { icon: "check-circle-filled", tone: "success" },
  missing: { icon: "circle-dashed", tone: undefined },
};

/** The state in words ("AI draft", "Memory 92% match", "Changed, not published", "Outdated"). */
export function textStateLabel(i18n: I18n, state: TextState, score?: number | null): string {
  const { t } = i18n;
  switch (state) {
    case "draft":
      return t("editor.badge.aiDraft");
    case "memory":
      return t("editor.badge.memoryMatch", { score: score ?? "" });
    case "edited":
      return t("editor.badge.edited");
    case "published":
      return t("common.state.published");
    case "outdated":
      return t("common.translationStatus.outdated");
    case "translated":
      return t("common.translationStatus.translated");
    default:
      return t("common.translationStatus.missing");
  }
}

/** A text's state: the first badge of its heading row. */
export function StateBadge({ i18n, state, score }: { i18n: I18n; state: TextState; score?: number | null }) {
  const look = TEXT_STATE_LOOK[state];
  return (
    <s-badge icon={look.icon} {...(look.tone ? { tone: look.tone } : {})}>
      {textStateLabel(i18n, state, score)}
    </s-badge>
  );
}

/**
 * A web address nobody has written yet: optional, so it never says "Not translated" beside the texts the
 * item's count includes (the count leaves web addresses out). Its state once written is a text's own.
 */
export function OptionalBadge({ i18n }: { i18n: I18n }) {
  return <s-badge icon="minus-circle">{i18n.t("editor.badge.optional")}</s-badge>;
}

/** The notes after the state: what AI's result should be checked for, and that a text is written by hand only. */
export function NoteBadges({ i18n, warnings, machine }: { i18n: I18n; warnings?: readonly string[] | null; machine: boolean }) {
  const { t } = i18n;
  return (
    <>
      {warnings?.length ? (
        <s-badge tone="caution" icon="alert-triangle">
          {t("editor.badge.review", { issues: warnings.map((code) => issueName(i18n, code)).join(", ") })}
        </s-badge>
      ) : null}
      {!machine ? <s-badge icon="edit">{t("editor.badge.manualOnly")}</s-badge> : null}
    </>
  );
}

/**
 * A section's heading row: its icon (a place's, optional), the name as an h2 the tiles move focus to
 * (`id`-heading), the badges beside it, and its one action at the end of the row.
 */
export function HeadingRow({ id, title, icon, tint = "grey", children, end }: { id: string; title: string; icon?: IconName; tint?: Tint; children?: ReactNode; end?: ReactNode }) {
  return (
    <div id={id} className="lv-ed-head-row">
      <div className="lv-ed-head-row__title">
        {icon ? <IconSquare icon={icon} tint={tint} size={28} /> : null}
        <h2 id={`${id}-heading`} tabIndex={-1} className="lv-h3 lv-ed-head-row__name">
          {title}
        </h2>
        {children}
      </div>
      {end ? <div className="lv-ed-head-row__end">{end}</div> : null}
    </div>
  );
}

export interface TextTile {
  /** The heading row's id it jumps to. */
  target: string;
  name: string;
  /** "optional": a web address nobody has written yet (OptionalBadge). */
  state: TextState | "open" | "done" | "optional";
  /** The state in words ("Outdated", "2 open", "Optional"). */
  word: string;
}

const TILE_ICON: Record<TextTile["state"], { icon: IconName; tone?: "success" | "info" | "caution" }> = {
  draft: { icon: "wand", tone: "info" },
  memory: { icon: "database", tone: "info" },
  edited: { icon: "edit", tone: "info" },
  published: { icon: "check-circle-filled", tone: "success" },
  outdated: { icon: "refresh", tone: "caution" },
  translated: { icon: "check-circle-filled", tone: "success" },
  missing: { icon: "circle-dashed" },
  open: { icon: "circle-dashed" },
  done: { icon: "check-circle-filled", tone: "success" },
  // No tone (drawn subdued): nothing is missing.
  optional: { icon: "minus-circle" },
};

/**
 * One square per text (the owner's square buttons, Settings' tiles): its state's icon, its name and
 * its state in a word. A tile moves to its text (focus on its heading); three in a row on a phone.
 */
export function TextTiles({ label, tiles }: { label: string; tiles: readonly TextTile[] }) {
  const jump = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    focusSection(target);
  };
  return (
    <nav aria-label={label} className="lv-ed-tiles">
      <ul className="lv-ed-tiles__list">
        {tiles.map((tile) => {
          const look = TILE_ICON[tile.state];
          return (
            <li key={tile.target} className="lv-ed-tiles__item">
              <a href={`#${tile.target}`} className="lv-tile lv-ed-tile" data-state={tile.state} onClick={(event) => jump(event, tile.target)}>
                <span className="lv-sr">{`${tile.name}: ${tile.word}`}</span>
                <span className="lv-ed-tile__mark" aria-hidden="true">
                  <s-icon type={look.icon} {...(look.tone ? { tone: look.tone } : { color: "subdued" })} />
                </span>
                <span className="lv-tile__name" aria-hidden="true">
                  {tile.name}
                </span>
                <span className="lv-tile__state" aria-hidden="true">
                  {tile.word}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * How many texts a button works on, in a small pill after its words (its name says it in full). The
 * leading space draws nothing in the pill but keeps the words and the figure apart in the button's
 * visible text ("Translate with AI 2"), which its name ("Translate with AI: 2 open texts") contains.
 */
export function CountChip({ count }: { count: number }) {
  return (
    <span className="lv-ed-count" aria-hidden="true">
      {` ${count}`}
    </span>
  );
}
