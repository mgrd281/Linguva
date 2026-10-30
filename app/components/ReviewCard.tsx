/**
 * One card of Review ("Übersetzungen prüfen"): an item in one language with
 * its picture, name, area and language, and each of its texts in reading
 * order: the original (grey) beside the translation (white), the quality
 * hints next to the text's name, and three actions per text ("Bearbeiten",
 * ✕ that asks first, "✓ Freigeben"). After an action each text says what
 * happened, in words and an icon; a card whose texts are all decided folds
 * to one line. The card's own request (a text or "Alle 4 freigeben") runs
 * on its own fetcher, so several cards can be in flight.
 *
 * Wide cards show the actions in the text's label row and the texts side
 * by side; narrow ones (a phone) stack the texts and put the same actions,
 * in the same order, under them (hidden copies are display:none).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import type { ReviewCard, ReviewDraft } from "../.server/review/page";
import type { ReviewPreview } from "../.server/review/previews";
import type { I18n, MessageKey } from "../i18n/i18n";
import { fieldName, hasMessage, issueName, itemKindLabel } from "../i18n/labels";
import { localeCountry } from "../lib/flags";
import { CATEGORIES, EXTRAS, isCategoryId } from "../lib/language-categories";
import { upperFirst } from "../lib/name-lists";
import type { AreaKey } from "../lib/review-areas";
import { hintText, highlightNumbers, markNumbersInHtml, numberMarks, type ReviewIssue } from "../lib/review-hints";
import { cardDone, type ClientOutcome, type ReviewActionResult } from "../lib/review-view";
import { SEO_KEYS } from "../lib/seo";
import { MARK_COLOUR, STATE_COLOURS, TRACK_COLOUR } from "./Coverage";
import type { IconName } from "./DialogPoint";
import { Flag } from "./Flag";
import { HtmlPreview, previewHeight } from "./HtmlPreview";
import { PLAIN_LIST } from "./LanguageLayout";
import { SeoCounter } from "./SeoPanel";
import { StructuredView } from "./StructuredValue";

/** Wide card: texts side by side, actions in the label row. */
export const WIDE = "@container (inline-size > 640px) auto, none";
/** Narrow card (a phone): texts stacked, actions under them. */
export const NARROW = "@container (inline-size > 640px) none, auto";
const COLUMNS = "@container (inline-size > 640px) 1fr 1fr, 1fr";

const CARD_TITLE = { margin: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600, overflowWrap: "anywhere" } as const;
const TEXT = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
const ONE_LINE = { display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" } as const;
const MARK = { background: MARK_COLOUR, color: "inherit", borderRadius: 3, padding: "0 1px" } as const;

/** Pages, blog posts and blogs have a title rather than a name. */
const TITLED: ReadonlySet<string> = new Set(["PAGE", "ARTICLE", "BLOG"]);

export function areaName(i18n: I18n, area: AreaKey): string {
  if (area === "other") return i18n.t("review.filter.other");
  if (area === "theme" || area === "notifications" || area === "urls") return i18n.t(`language.extra.${area}.name`);
  return i18n.t(`language.category.${area}.name`);
}

export function areaIcon(area: AreaKey): IconName {
  if (area === "other") return "text-block";
  if (area === "theme" || area === "notifications" || area === "urls") return EXTRAS[area].icon;
  return isCategoryId(area) ? CATEGORIES[area].icon : "text-block";
}

/** A language's name as a label ("Französisch", "Français"). */
export function languageLabel(i18n: I18n, locale: string, names: Record<string, string>): string {
  return upperFirst(i18n.language(locale, names[locale]));
}

/** A text's name in the merchant's words: Name, Beschreibung, Google-Titel, Bildtext, "Zusatzinfo: Material", Webadresse, … */
export function textLabel(i18n: I18n, draft: ReviewDraft, liveFieldName: string | null | undefined): string {
  const { t } = i18n;
  if (draft.key === "handle") return t("review.field.handle");
  switch (draft.group) {
    case "title":
      return TITLED.has(draft.type ?? "") ? t("language.list.text.heading") : t("language.list.text.title");
    case "description":
      return t("language.list.text.description");
    case "seo_title":
      return t("language.list.text.seo_title");
    case "seo_description":
      return t("language.list.text.seo_description");
    case "alt":
      return t("language.list.text.alt");
    case "value": {
      const name = liveFieldName ?? draft.fieldName;
      return name ? t("review.field.customField", { name }) : t("language.list.kind.field");
    }
    default:
      return fieldName(i18n, draft.key);
  }
}

/** A card's name: the stored or live title, else what kind of thing it is, else "untitled". */
export function cardTitle(i18n: I18n, card: ReviewCard, liveTitle: string | null): string {
  if (card.title) return card.title;
  if (liveTitle) return liveTitle;
  if (card.kindWord) {
    const key = card.kindWord.endsWith("_METAFIELD") ? "language.list.kind.field" : `language.list.kind.${card.kindWord}`;
    return hasMessage(key) ? i18n.t(key) : itemKindLabel(i18n, card.kindWord);
  }
  return i18n.t("review.draft.untitled");
}

/** The words of a text's outcome ("Freigegeben – Kunden sehen es jetzt."). */
export function outcomeText(i18n: I18n, outcome: ClientOutcome, language: string, hidden: boolean): string {
  const { t } = i18n;
  switch (outcome.status) {
    case "published":
      return hidden ? t("review.result.approvedHidden", { language }) : t("review.result.approved");
    case "rejected":
      return t("review.result.rejected");
    case "stale":
      return t(`review.result.stale.${outcome.reason}`);
    case "changed":
      return t("review.result.changed");
    case "failed": {
      if (outcome.reason === "HANDLE_INVALID") {
        const problem = outcome.detail ? `editor.handle.problem.${outcome.detail}` : null;
        return problem && hasMessage(problem) ? t("review.result.failed.HANDLE_INVALID", { problem: t(problem, { max: 255 }) }) : t("review.result.failed.generic");
      }
      if (outcome.reason === "SHOPIFY_REJECTED") return t("review.result.failed.SHOPIFY_REJECTED", { detail: outcome.detail ?? "" });
      const key = `review.result.failed.${outcome.reason}`;
      return hasMessage(key) ? t(key) : t("review.result.failed.generic");
    }
  }
}

/** The page's state and handlers a card works with. */
export interface CardContext {
  i18n: I18n;
  names: Record<string, string>;
  primaryLocale: string | null;
  published: Record<string, boolean>;
  marketCountries: string[] | null;
  previews: Record<string, ReviewPreview> | null;
  previewsFailed: boolean;
  edits: Record<string, string>;
  open: Record<string, boolean>;
  asking: { id: string; kind: "reject" | "handle" } | null;
  outcomes: Record<string, ClientOutcome>;
  /** Items with a card in more than one language on the page: their controls name the language too. */
  repeatedItems: ReadonlySet<string>;
  /** Texts of any request in flight. */
  busy: ReadonlySet<string>;
  /** The page's own request runs: every action waits. */
  pageBusy: boolean;
  issuesOf(draft: ReviewDraft): ReviewIssue[];
  /** Why a text being edited can't be approved: "empty", or a web address's problem. */
  problemOf(draft: ReviewDraft): string | null;
  isEdited(draft: ReviewDraft): boolean;
  setValue(id: string, value: string): void;
  startEdit(draft: ReviewDraft): void;
  cancelEdit(draft: ReviewDraft): void;
  ask(id: string, kind: "reject" | "handle"): void;
  cancelAsk(): void;
  /** Builds the request for these texts (ids, tokens, edited values, confirmed web addresses). */
  form(intent: "approve" | "reject", drafts: readonly ReviewDraft[], confirmed?: readonly string[]): FormData;
  onResult(result: ReviewActionResult, ids: readonly string[], cardKey: string): void;
  reload(): void;
}

/** The card's (or a text's) picture: the store's picture, the area's icon without one, an empty square while loading. */
function Picture({ src, icon, size, loading }: { src: string | null | undefined; icon: IconName; size: string; loading: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ width: size, height: size, borderRadius: 10, overflow: "hidden", background: TRACK_COLOUR, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {/* The name is written beside it. */}
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      ) : loading ? null : (
        <s-icon type={icon} color="subdued" />
      )}
    </div>
  );
}

function Separator() {
  return (
    <span aria-hidden="true">
      <s-text color="subdued">·</s-text>
    </span>
  );
}

/** "▣ Produkte · 🇫🇷 Französisch (versteckt) · Im Editor öffnen". */
function MetaLine({ card, title, ctx, editorLink }: { card: ReviewCard; title: string; ctx: CardContext; editorLink: boolean }) {
  const { t } = ctx.i18n;
  const hidden = ctx.published[card.locale] === false;
  const link = card.href ? (
    <s-link href={card.href} accessibilityLabel={`${t("review.draft.openEditor")}: ${title}`}>
      {t("review.draft.openEditor")}
    </s-link>
  ) : null;
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon type={areaIcon(card.area)} color="subdued" size="small" />
        <s-text color="subdued">{areaName(ctx.i18n, card.area)}</s-text>
        <Separator />
        <Flag country={localeCountry(card.locale, ctx.marketCountries)} fallback={card.locale} size={20} />
        <s-text color="subdued">{languageLabel(ctx.i18n, card.locale, ctx.names)}</s-text>
        {hidden ? (
          <s-stack direction="inline" gap="small-500" alignItems="center">
            <s-icon type="hide" color="subdued" size="small" />
            <s-text color="subdued">{t("review.lang.hidden")}</s-text>
          </s-stack>
        ) : null}
        {editorLink && link ? (
          <s-box display={WIDE}>
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <Separator />
              {link}
            </s-stack>
          </s-box>
        ) : null}
      </s-stack>
      {/* On a phone the link has a line of its own (touch targets apart). */}
      {editorLink && link ? <s-box display={NARROW}>{link}</s-box> : null}
    </s-stack>
  );
}

function HintBadges({ issues, i18n }: { issues: readonly ReviewIssue[]; i18n: I18n }) {
  const { t } = i18n;
  return (
    <>
      {issues.map((issue, i) => {
        const hint = hintText(issue);
        return (
          <s-stack key={`${issue.code}-${i}`} direction="inline" gap="small-300" alignItems="center">
            <s-badge tone="caution" icon="alert-triangle">
              {t("review.hint.label", { text: hint.key ? t(hint.key, hint.vars) : issueName(i18n, issue.code) })}
            </s-badge>
            {/* The merchant's own word, apart from the badge (it may be in any language). */}
            {hint.word ? <s-text color="subdued">{t("language.preview.quoted", { text: hint.word })}</s-text> : null}
          </s-stack>
        );
      })}
    </>
  );
}

/** Plain text with the given numbers marked (decorative: the hint says it in words). */
function Marked({ text, numbers }: { text: string; numbers: readonly string[] }) {
  return (
    <>
      {highlightNumbers(text, numbers).map((part, i) =>
        part.mark ? (
          <mark key={i} style={MARK}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A box's language: visible on a phone (no column header), for screen readers only on wide cards. */
function BoxLanguage({ name, i18n }: { name: string; i18n: I18n }) {
  return (
    <>
      <s-box display={NARROW}>
        <s-text color="subdued">{name}</s-text>
      </s-box>
      <s-box display={WIDE}>
        <s-text accessibilityVisibility="exclusive">{i18n.t("review.columns.boxLabel", { language: name })}</s-text>
      </s-box>
    </>
  );
}

/** A rendered box's language, inside it above the preview: on a phone only (the frame's title names it for screen readers). */
function FrameLanguage({ name }: { name: string }) {
  return (
    <s-box display={NARROW} padding="small-100 base none">
      <s-text color="subdued">{name}</s-text>
    </s-box>
  );
}

function OriginalBox({ children, name, i18n, lang }: { children: ReactNode; name: string; i18n: I18n; lang: string | null }) {
  return (
    <s-box padding="small-100 base" background="subdued" borderRadius="base">
      <BoxLanguage name={name} i18n={i18n} />
      <s-text color="subdued">
        <span lang={lang ?? undefined} dir="auto" style={TEXT}>
          {children}
        </span>
      </s-text>
    </s-box>
  );
}

function TranslationBox({ children, name, i18n, lang, rtl }: { children: ReactNode; name: string; i18n: I18n; lang: string; rtl: boolean }) {
  return (
    <s-box padding="small-100 base" border="base" borderRadius="base">
      <BoxLanguage name={name} i18n={i18n} />
      <s-text>
        <span lang={lang} dir={rtl ? "rtl" : "auto"} style={TEXT}>
          {children}
        </span>
      </s-text>
    </s-box>
  );
}

/** Focuses a Polaris control once it can take focus (it may not in the first frame). */
export function focusSoon(find: () => HTMLElement | null) {
  let tries = 0;
  const attempt = () => {
    const el = find();
    el?.focus();
    // A Polaris host stands for its inner control: the document's active element is the host.
    const done = el !== null && (document.activeElement === el || el.contains(document.activeElement));
    if (!done && tries++ < 30) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Whether a control is on screen: a Polaris host draws no box itself (display: contents), its inner control does. */
function shown(el: HTMLElement): boolean {
  const inner = (el.shadowRoot?.querySelector("button, a, input, textarea") as HTMLElement | null) ?? el;
  return typeof inner.checkVisibility === "function" ? inner.checkVisibility() : inner.getClientRects().length > 0;
}

/** The copy of a control that is shown (wide or narrow card). */
export function visible(selector: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(shown) ?? null;
}

/**
 * Results already shown. A keyed fetcher keeps its last result while the
 * page is drawn afresh for new data (a filter, the next page, "Reload"), so
 * a card or page drawn again would show it once more: a stale outcome on a
 * newer text, a toast or banner for something done on another page.
 */
const shownResults = new WeakSet<object>();

/** True the first time a request's result is seen (it is shown then), false ever after. */
export function firstSight(result: object): boolean {
  if (shownResults.has(result)) return false;
  shownResults.add(result);
  return true;
}

interface RowProps {
  card: ReviewCard;
  draft: ReviewDraft;
  title: string;
  ctx: CardContext;
  /** This card's request runs. */
  cardBusy: boolean;
  approve(drafts: readonly ReviewDraft[], confirmed?: readonly string[]): void;
  reject(draft: ReviewDraft): void;
}

function TextActions({ draft, title, ctx, cardBusy, approve, copy }: RowProps & { copy: "wide" | "narrow" }) {
  const { t } = ctx.i18n;
  const label = textLabel(ctx.i18n, draft, ctx.previews?.[draft.id]?.fieldName);
  const editing = Boolean(ctx.open[draft.id]);
  // One request per card at a time; the page's request holds every action.
  const disabled = ctx.pageBusy || cardBusy || ctx.busy.has(draft.id);
  const editable = draft.kind === "plain" || draft.kind === "html" || draft.kind === "handle";
  const html = draft.kind === "html";
  const tip = `review-tip-${draft.id}-${copy}`;
  const editButton = editable ? (
    editing ? (
      <s-button
        variant="tertiary"
        data-review-edit={draft.id}
        accessibilityLabel={t("review.field.cancelLabel", { field: label, title })}
        onClick={() => ctx.cancelEdit(draft)}
        {...(disabled ? { disabled: true } : {})}
      >
        {t("common.action.cancel")}
      </s-button>
    ) : (
      <s-button
        variant="tertiary"
        icon={html ? "code" : "edit"}
        data-review-edit={draft.id}
        accessibilityLabel={t(html ? "review.field.editHtmlLabel" : "review.field.editLabel", { field: label, title })}
        onClick={() => ctx.startEdit(draft)}
        {...(disabled ? { disabled: true } : {})}
      >
        {t(html ? "review.field.editHtml" : "review.field.edit")}
      </s-button>
    )
  ) : null;
  const rejectButton = (
    <>
      <s-button
        variant="tertiary"
        icon="x"
        interestFor={tip}
        data-review-reject={draft.id}
        accessibilityLabel={t("review.field.rejectLabel", { field: label, title })}
        onClick={() => ctx.ask(draft.id, "reject")}
        {...(disabled ? { disabled: true } : {})}
      />
      <s-tooltip id={tip}>{t("review.field.reject")}</s-tooltip>
    </>
  );
  const problem = ctx.problemOf(draft);
  const approveButton = (
    <s-button
      icon="check"
      data-review-approve={draft.id}
      accessibilityLabel={t("review.field.approveLabel", { field: label, title })}
      // A new web address asks first; any other text goes at once.
      onClick={() => (draft.kind === "handle" ? ctx.ask(draft.id, "handle") : approve([draft]))}
      {...(disabled || problem ? { disabled: true } : {})}
      {...(ctx.busy.has(draft.id) && !ctx.pageBusy ? { loading: true } : {})}
    >
      {t("review.field.approve")}
    </s-button>
  );
  return copy === "wide" ? (
    <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="end">
      {editButton}
      {rejectButton}
      {approveButton}
    </s-stack>
  ) : (
    <s-grid gridTemplateColumns="minmax(0, 1fr) auto auto" gap="base" alignItems="center">
      <s-stack direction="inline">{editButton ?? <span />}</s-stack>
      {rejectButton}
      {approveButton}
    </s-grid>
  );
}

/** The inline question before rejecting (it can't be undone) or before a new web address goes live. */
function Question({ card, draft, title, ctx, approve, reject, label }: RowProps & { label: string }) {
  const { t } = ctx.i18n;
  const kind = ctx.asking?.kind;
  const language = ctx.i18n.language(card.locale, ctx.names[card.locale]);
  useEffect(() => {
    focusSoon(() => visible(`[data-review-confirm="${draft.id}"]`));
  }, [draft.id]);
  const cancel = () => {
    ctx.cancelAsk();
    focusSoon(() => visible(kind === "reject" ? `[data-review-reject="${draft.id}"]` : `[data-review-approve="${draft.id}"]`));
  };
  // Escape answers "Cancel".
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancel();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });
  return (
    <div ref={box}>
      {kind === "reject" ? (
        <s-banner tone="critical" heading={t("review.field.rejectQuestion")}>
          <s-paragraph>{t("review.field.rejectNote")}</s-paragraph>
          <s-button slot="secondary-actions" tone="critical" data-review-confirm={draft.id} accessibilityLabel={t("review.field.rejectLabel", { field: label, title })} onClick={() => reject(draft)}>
            {t("review.field.reject")}
          </s-button>
          <s-button slot="secondary-actions" onClick={cancel}>
            {t("common.action.cancel")}
          </s-button>
        </s-banner>
      ) : (
        <s-banner tone="warning" heading={t("review.field.handleQuestion", { language })}>
          <s-button
            slot="secondary-actions"
            data-review-confirm={draft.id}
            accessibilityLabel={t("review.field.approveLabel", { field: label, title })}
            onClick={() => approve([draft], [draft.id])}
            {...(ctx.problemOf(draft) ? { disabled: true } : {})}
          >
            {t("review.field.approve")}
          </s-button>
          <s-button slot="secondary-actions" onClick={cancel}>
            {t("common.action.cancel")}
          </s-button>
        </s-banner>
      )}
    </div>
  );
}

/** The original and the translation (or its editor), by kind. */
function Texts({ card, draft, title, ctx }: RowProps) {
  const { i18n } = ctx;
  const { t } = i18n;
  const label = textLabel(i18n, draft, ctx.previews?.[draft.id]?.fieldName);
  const primaryName = ctx.primaryLocale ? languageLabel(i18n, ctx.primaryLocale, ctx.names) : t("review.draft.original");
  const language = languageLabel(i18n, card.locale, ctx.names);
  const issues = ctx.issuesOf(draft);
  const marks = numberMarks(issues);
  const editing = Boolean(ctx.open[draft.id]);
  const value = ctx.edits[draft.id] ?? draft.value;
  const dir = card.rtl ? "rtl" : "auto";
  const problem = ctx.problemOf(draft);
  const fieldText = t("review.field.textLabel", { field: label, language: i18n.language(card.locale, ctx.names[card.locale]) });
  const area = useRef<HTMLElementTagNameMap["s-text-area"]>(null);
  const field = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  useEffect(() => {
    if (editing) focusSoon(() => area.current ?? field.current);
  }, [editing]);
  const problemText = problem ? (draft.kind === "handle" ? t(`editor.handle.problem.${problem}` as MessageKey, { max: 255 }) : t("review.field.empty")) : undefined;
  const onInput = (event: Event) => ctx.setValue(draft.id, (event.currentTarget as HTMLInputElement).value);

  if (draft.kind === "html" || draft.kind === "richText") {
    const source = markNumbersInHtml(draft.sourcePreview ?? "", marks.source);
    // While the merchant edits HTML the frame shows what they type (sandboxed, as in the editor).
    const shown = markNumbersInHtml(ctx.isEdited(draft) || editing ? value : (draft.valuePreview ?? ""), marks.target);
    const height = Math.max(previewHeight(source), previewHeight(shown));
    return (
      <s-stack direction="block" gap="small-200">
        {/* While the translation is edited, the original keeps its own height. */}
        <s-grid gridTemplateColumns={COLUMNS} gap="base" alignItems={editing ? "start" : "stretch"}>
          <HtmlPreview
            html={source}
            title={t("review.draft.originalTitle", { title, field: label })}
            lang={ctx.primaryLocale ?? ""}
            tone="subdued"
            height={height}
            boxPadding
            label={<FrameLanguage name={primaryName} />}
          />
          <s-stack direction="block" gap="small-200">
            <HtmlPreview
              html={shown}
              title={t("review.draft.previewTitle", { title, field: label })}
              lang={card.locale}
              dir={dir}
              height={height}
              boxPadding
              label={<FrameLanguage name={language} />}
            />
            {editing && draft.kind === "html" ? (
              <div lang={card.locale} dir={dir}>
                <s-text-area ref={area} label={fieldText} labelAccessibilityVisibility="exclusive" value={value} rows={6} onInput={onInput} {...(problemText ? { error: problemText } : {})} />
              </div>
            ) : null}
          </s-stack>
        </s-grid>
        {draft.kind === "richText" ? <s-text color="subdued">{t("review.field.asShown")}</s-text> : null}
      </s-stack>
    );
  }

  if (draft.kind === "list" && draft.listType) {
    return (
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns={COLUMNS} gap="base">
          <s-stack direction="block" gap="small-300">
            <s-box display={NARROW}>
              <s-text color="subdued">{primaryName}</s-text>
            </s-box>
            <StructuredView type={draft.listType} value={draft.source} title={t("review.draft.originalTitle", { title, field: label })} lang={ctx.primaryLocale ?? ""} />
          </s-stack>
          <s-stack direction="block" gap="small-300">
            <s-box display={NARROW}>
              <s-text color="subdued">{language}</s-text>
            </s-box>
            <StructuredView type={draft.listType} value={draft.value} title={t("review.draft.previewTitle", { title, field: label })} lang={card.locale} {...(card.rtl ? { dir: "rtl" as const } : {})} />
          </s-stack>
        </s-grid>
        <s-text color="subdued">{t("review.field.asShown")}</s-text>
      </s-stack>
    );
  }

  const handle = draft.kind === "handle";
  const show = (text: string, numbers: readonly string[]) => (handle ? `…/${text}` : <Marked text={text} numbers={numbers} />);
  const rows = value.length <= 60 ? 1 : value.length <= 200 ? 3 : 6;
  return (
    <s-stack direction="block" gap="small-200">
      <s-grid gridTemplateColumns={COLUMNS} gap="base" alignItems={editing ? "start" : "stretch"}>
        <OriginalBox name={primaryName} i18n={i18n} lang={ctx.primaryLocale}>
          {show(draft.source, marks.source)}
        </OriginalBox>
        {editing ? (
          <s-stack direction="block" gap="small-200">
            <div lang={card.locale} dir={dir}>
              {handle ? (
                <s-text-field ref={field} label={fieldText} labelAccessibilityVisibility="exclusive" value={value} onInput={onInput} {...(problemText ? { error: problemText } : {})} />
              ) : (
                <s-text-area ref={area} label={fieldText} labelAccessibilityVisibility="exclusive" value={value} rows={rows} onInput={onInput} {...(problemText ? { error: problemText } : {})} />
              )}
            </div>
            {SEO_KEYS.includes(draft.key) ? <SeoCounter fieldKey={draft.key} value={value} source={draft.source} showIssues={false} /> : null}
          </s-stack>
        ) : (
          <TranslationBox name={language} i18n={i18n} lang={card.locale} rtl={card.rtl}>
            {show(value, marks.target)}
          </TranslationBox>
        )}
      </s-grid>
      {handle ? (
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-icon type="alert-triangle" tone="caution" size="small" />
          <s-text tone="caution">{t("review.field.handleNote", { language: i18n.language(card.locale, ctx.names[card.locale]) })}</s-text>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

/** A decided text: one calm line with its outcome (icon and words). */
function ResultLine({ card, draft, title, ctx, outcome, label }: RowProps & { outcome: ClientOutcome; label: string }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const hidden = ctx.published[card.locale] === false;
  const text = outcomeText(i18n, outcome, i18n.language(card.locale, ctx.names[card.locale]), hidden);
  const look: { icon: IconName; tone?: "success" | "caution" | "info"; tint: string | null; subdued?: boolean } =
    outcome.status === "published"
      ? { icon: "check-circle-filled", tone: "success", tint: `${STATE_COLOURS.complete}14` }
      : outcome.status === "rejected"
        ? { icon: "x-circle", tint: null, subdued: true }
        : outcome.status === "stale" && outcome.reason === "SOURCE_CHANGED"
          ? { icon: "refresh", tone: "caution", tint: `${STATE_COLOURS.outdated}14` }
          : { icon: "info", tone: "info", tint: null, subdued: true };
  const quote = outcome.status === "published" && (draft.kind === "plain" || draft.kind === "handle") ? (ctx.edits[draft.id] ?? draft.value) : null;
  const line = (
    <s-box padding="small-100 base" {...(look.subdued ? { background: "subdued" as const } : {})}>
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
        {look.tone ? <s-icon type={look.icon} tone={look.tone} /> : <s-icon type={look.icon} color="subdued" />}
        <s-stack direction="inline" gap="small-100 small-200" alignItems="center">
          <s-text type="strong">{label}</s-text>
          {look.tone === "success" ? <s-text tone="success">{text}</s-text> : look.tone === "caution" ? <s-text tone="caution">{text}</s-text> : <s-text>{text}</s-text>}
          {quote ? (
            <span lang={card.locale} dir="auto" style={ONE_LINE}>
              <s-text color="subdued">{t("language.preview.quoted", { text: quote })}</s-text>
            </span>
          ) : null}
          {outcome.status === "stale" && outcome.reason === "SOURCE_CHANGED" && card.href ? (
            <s-link href={card.href} accessibilityLabel={`${t("review.draft.openEditor")}: ${title}`}>
              {t("review.draft.openEditor")}
            </s-link>
          ) : null}
          {outcome.status === "changed" ? (
            <s-button variant="tertiary" onClick={ctx.reload}>
              {t("review.result.reload")}
            </s-button>
          ) : null}
        </s-stack>
      </s-grid>
    </s-box>
  );
  return look.tint ? <div style={{ background: look.tint }}>{line}</div> : line;
}

function TextRow(props: RowProps) {
  const { card, draft, ctx } = props;
  const { i18n } = ctx;
  const { t } = i18n;
  const preview = ctx.previews?.[draft.id];
  const label = textLabel(i18n, draft, preview?.fieldName);
  const outcome = ctx.outcomes[draft.id];
  if (outcome && outcome.status !== "failed") return <ResultLine {...props} outcome={outcome} label={label} />;
  const issues = ctx.issuesOf(draft);
  const asking = ctx.asking?.id === draft.id;
  const image = draft.group === "alt" ? preview?.own : null;
  return (
    <s-box padding="base">
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {draft.group === "alt" && (image || (ctx.previews === null && !ctx.previewsFailed)) ? (
              <Picture src={image?.url} icon="image" size="40px" loading={ctx.previews === null && !ctx.previewsFailed} />
            ) : null}
            <s-text type="strong">{label}</s-text>
            <HintBadges issues={issues} i18n={i18n} />
            {draft.fromImport ? <s-badge icon="import">{t("review.field.fromImport")}</s-badge> : null}
            {ctx.isEdited(draft) ? (
              <s-badge tone="info" icon="edit">
                {t("review.field.edited")}
              </s-badge>
            ) : null}
          </s-stack>
          <s-box display={WIDE}>{asking ? null : <TextActions {...props} copy="wide" />}</s-box>
        </s-grid>
        {asking ? <Question {...props} label={label} /> : null}
        {outcome?.status === "failed" ? (
          <s-banner tone="critical">
            <s-paragraph>{outcomeText(i18n, outcome, i18n.language(card.locale, ctx.names[card.locale]), false)}</s-paragraph>
          </s-banner>
        ) : null}
        <Texts {...props} />
        {asking ? null : (
          <s-box display={NARROW}>
            <TextActions {...props} copy="narrow" />
          </s-box>
        )}
      </s-stack>
    </s-box>
  );
}

export function ReviewCardView({ card, ctx }: { card: ReviewCard; ctx: CardContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const fetcher = useFetcher<ReviewActionResult>({ key: `review-card-${card.key}` });
  const sent = useRef<string[]>([]);
  const onResult = ctx.onResult;
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !firstSight(fetcher.data)) return;
    onResult(fetcher.data, sent.current, card.key);
  }, [fetcher.state, fetcher.data, onResult, card.key]);

  const previews = ctx.previews;
  const live = previews ? card.drafts.map((d) => previews[d.id]?.title).find(Boolean) ?? null : null;
  const title = cardTitle(i18n, card, live);
  const language = languageLabel(i18n, card.locale, ctx.names);
  // What the controls name: the item, and its language where the page has it in several (no two controls share a name).
  const named = ctx.repeatedItems.has(card.item) ? `${title} (${language})` : title;
  const cardBusy = fetcher.state !== "idle";
  const submit = (intent: "approve" | "reject", drafts: readonly ReviewDraft[], confirmed?: readonly string[]) => {
    sent.current = drafts.map((d) => d.id);
    fetcher.submit(ctx.form(intent, drafts, confirmed), { method: "post" });
  };
  const approve = (drafts: readonly ReviewDraft[], confirmed?: readonly string[]) => submit("approve", drafts, confirmed);
  const reject = (draft: ReviewDraft) => submit("reject", [draft]);

  const outcomes = card.drafts.map((d) => ctx.outcomes[d.id]);
  const undecided = card.drafts.filter((d) => !ctx.outcomes[d.id]);
  const approvable = undecided.filter((d) => d.kind !== "handle");
  const hints = undecided.filter((d) => ctx.issuesOf(d).length > 0).length;
  const picture = previews ? card.drafts.map((d) => previews[d.id]?.card?.url).find(Boolean) ?? null : null;
  const loading = previews === null && !ctx.previewsFailed;

  if (cardDone(outcomes)) {
    const approved = outcomes.filter((o) => o?.status === "published").length;
    const rejected = outcomes.filter((o) => o?.status === "rejected").length;
    return (
      <s-section padding="none" accessibilityLabel={`${title}, ${language}`}>
        <s-query-container>
          <s-box padding="base">
            <s-grid gridTemplateColumns="@container (inline-size > 640px) auto 1fr auto, auto 1fr" gap="base" alignItems="center">
              <Picture src={picture} icon={areaIcon(card.area)} size="40px" loading={loading} />
              <s-stack direction="block" gap="small-300">
                <h2 style={CARD_TITLE}>{title}</h2>
                <MetaLine card={card} title={title} ctx={ctx} editorLink={false} />
              </s-stack>
              <s-stack direction="inline" gap="small-100 base" alignItems="center">
                {approved ? (
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-icon type="check-circle-filled" tone="success" size="small" />
                    <s-text tone="success">{t("review.card.approved", { count: approved })}</s-text>
                  </s-stack>
                ) : null}
                {rejected ? (
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-icon type="x-circle" color="subdued" size="small" />
                    <s-text color="subdued">{t("review.card.rejected", { count: rejected })}</s-text>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-grid>
          </s-box>
        </s-query-container>
      </s-section>
    );
  }

  const blocked = card.drafts.some((d) => ctx.problemOf(d)) || card.drafts.some((d) => ctx.asking?.id === d.id);
  const hintCount = (
    <s-badge tone="caution" icon="alert-triangle">
      {t("review.card.hints", { count: hints })}
    </s-badge>
  );
  const rowProps = { card, title: named, ctx, cardBusy, approve, reject };
  return (
    <s-section padding="none" accessibilityLabel={`${title}, ${language}`}>
      <s-query-container>
        <s-box padding="base">
          <s-grid gridTemplateColumns="@container (inline-size > 640px) auto 1fr auto, auto 1fr" gap="base" alignItems="start">
            <Picture src={picture} icon={areaIcon(card.area)} size="clamp(48px, 14vw, 56px)" loading={loading} />
            <s-stack direction="block" gap="small-300">
              <h2 style={CARD_TITLE}>{title}</h2>
              <MetaLine card={card} title={named} ctx={ctx} editorLink />
              {/* On a phone the note count goes under the lines, which keep the card's width. */}
              {hints ? (
                <s-box display={NARROW}>
                  <s-stack direction="inline">{hintCount}</s-stack>
                </s-box>
              ) : null}
              {card.continued ? (
                <s-stack direction="inline">
                  <s-badge>{t("review.card.continued")}</s-badge>
                </s-stack>
              ) : null}
              {card.continues ? (
                <s-stack direction="inline">
                  <s-badge>{t("review.card.continues")}</s-badge>
                </s-stack>
              ) : null}
            </s-stack>
            {hints ? <s-box display={WIDE}>{hintCount}</s-box> : <span />}
          </s-grid>
        </s-box>
        {/* Decorative: each box names its language itself. */}
        <div aria-hidden="true">
          <s-box display={WIDE} padding="none base small-200">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-text color="subdued">
                {ctx.primaryLocale
                  ? t("review.columns.original", { language: languageLabel(i18n, ctx.primaryLocale, ctx.names) })
                  : t("review.draft.original")}
              </s-text>
              <s-stack direction="inline" gap="small-300" alignItems="center">
                <Flag country={localeCountry(card.locale, ctx.marketCountries)} fallback={card.locale} size={20} />
                <s-text color="subdued">{language}</s-text>
              </s-stack>
            </s-grid>
          </s-box>
        </div>
        <ul style={PLAIN_LIST}>
          {card.drafts.map((draft) => (
            <li key={draft.id}>
              <s-divider />
              <TextRow {...rowProps} draft={draft} />
            </li>
          ))}
        </ul>
        {approvable.length >= 2 ? (
          <>
            <s-divider />
            <s-box padding="base">
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  icon="check"
                  accessibilityLabel={t("review.card.approveAllLabel", { count: approvable.length, title, language })}
                  onClick={() => approve(approvable)}
                  {...(ctx.pageBusy || blocked || approvable.some((d) => ctx.busy.has(d.id)) ? { disabled: true } : {})}
                  {...(cardBusy ? { loading: true } : {})}
                >
                  {t("review.card.approveAll", { count: approvable.length })}
                </s-button>
              </s-stack>
            </s-box>
          </>
        ) : null}
      </s-query-container>
    </s-section>
  );
}

