/**
 * Review's control card: the languages in the shared picker (LanguagePicker:
 * chips with flags and counts, visible languages first, a hidden one says so
 * in words; a select that opens a language at once above six), a search that
 * runs while typing, the areas and "With notes" as an area list's filter pills
 * (all in view on a wide card, one row that swipes sideways on a phone, as the
 * languages do there), the job's or the old
 * field filter's scope, and the strip with the page's count, the share
 * already decided, the payoff for a page of one language and the page's two
 * actions. Filters are links (instant, no "Apply"); every change starts on
 * the first page. While the strip is scrolled out of view, the same count
 * and actions float at the foot of the window (FloatingBar).
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { ReviewPageData } from "../.server/review/page";
import type { I18n } from "../i18n/i18n";
import { switcherKind } from "../lib/content-language";
import { localeCountry } from "../lib/flags";
import { languagePath } from "../lib/language-categories";
import { languageOrder, pageProgress, reviewHref, type Facets, type ReviewQuery } from "../lib/review-view";
import { ALL } from "../lib/select-all";
import { areaIcon, areaName, languageLabel, NARROW, WIDE } from "./ReviewCard";
import { LanguagePicker, type PickerLanguage } from "./LanguagePicker";
import { ProgressBar } from "./ProgressBar";
import { SearchForm } from "./SearchField";
import { Button } from "./Button";
import { Strong } from "./Type";

/** A phone's chips stay on the one row that swipes. */
const NO_WRAP = { flexWrap: "nowrap" } as const;

export interface PageActions {
  /** Texts on the page. */
  total: number;
  /** Undecided texts on the page (web addresses included) and those "Approve all" approves (without them). */
  undecided: number;
  approvable: number;
  /** The page holds every matching text. */
  allOnPage: boolean;
  /** The page's own request runs. */
  busy: boolean;
  /** That request approves (the strip says it can take a moment; rejecting is quick). */
  approving: boolean;
  /** Some request runs (a text's, a card's or the page's): the page's buttons wait, so no text is sent twice at once. */
  waiting: boolean;
  /** Why "Approve all" waits: an emptied or invalid text being edited, or an open question ("Reject all" waits for a question only). */
  blocked: "empty" | "question" | null;
}

/** A language tab ("All" has no locale). */
interface LanguageTab {
  locale: string | null;
  name: string;
  count: number;
  hidden: boolean;
}

/** "All" first, then the languages with waiting texts: visible ones, then hidden ones, each by name. */
function languageTabs(data: ReviewPageData, facets: Facets, i18n: I18n): LanguageTab[] {
  const languages = languageOrder(
    facets.languages.map((l): LanguageTab => ({ locale: l.locale, count: l.count, name: languageLabel(i18n, l.locale, data.names), hidden: data.published[l.locale] === false })),
    i18n.locale,
  );
  return [{ locale: null, name: i18n.t("language.list.filter.all"), count: facets.total, hidden: false }, ...languages];
}

/** "Arabisch versteckt 3": a language as a screen reader names it (the visible words, in their order). */
function tabLabel(tab: LanguageTab, i18n: I18n): string {
  return [tab.name, tab.hidden ? i18n.t("content.language.hidden") : null, i18n.number(tab.count)].filter(Boolean).join(" ");
}

/** The tabs as the shared picker draws them: each with its flag, "hidden" under a hidden one's name, its count, the same page in it. */
function pickerTabs(tabs: readonly LanguageTab[], query: ReviewQuery, data: ReviewPageData, i18n: I18n): PickerLanguage[] {
  return tabs.map((tab) => ({
    value: tab.locale ?? ALL,
    locale: tab.locale,
    country: tab.locale ? localeCountry(tab.locale, data.marketCountries) : null,
    name: tab.name,
    hidden: tab.hidden,
    figure: i18n.number(tab.count),
    label: tabLabel(tab, i18n),
    // The select's option names its count, and a hidden language says so.
    option: i18n.t(tab.hidden ? "review.lang.optionHidden" : "review.lang.option", { language: tab.name, count: tab.count }),
    href: reviewHref(query, { locale: tab.locale }),
  }));
}

/** A swiped row starts at its chosen item, so the filter in use is in view (no page scroll; nothing where the row isn't shown). */
function revealChosen(row: HTMLElement | null) {
  const chosen = row?.querySelector<HTMLElement>('[aria-current="true"]');
  if (!row || !chosen) return;
  const from = row.getBoundingClientRect();
  const box = chosen.getBoundingClientRect();
  if (!box.width || !from.width) return;
  if (box.left < from.left || box.right > from.right) row.scrollLeft += box.left - from.left - 16;
}

/** The filters a form keeps when it changes one of them (`omit`): the page's address without it. */
function KeptFilters({ query, omit }: { query: ReviewQuery; omit: "locale" | "search" }) {
  return (
    <>
      {query.locale && omit !== "locale" ? <input type="hidden" name="lang" value={query.locale} /> : null}
      {query.area ? <input type="hidden" name="area" value={query.area} /> : null}
      {query.flagged ? <input type="hidden" name="flagged" value="1" /> : null}
      {query.search && omit !== "search" ? <input type="hidden" name="q" value={query.search} /> : null}
      {query.jobId ? <input type="hidden" name="job" value={query.jobId} /> : null}
      {query.group ? <input type="hidden" name="group" value={query.group} /> : null}
    </>
  );
}

/** The search: runs while typing (after a pause, from two characters on) and at once on Enter (SearchField). */
function Search({ query, i18n }: { query: ReviewQuery; i18n: I18n }) {
  const { t } = i18n;
  return (
    <SearchForm label={t("common.action.search")} placeholder={t("review.filter.searchPlaceholder")} value={query.search ?? ""}>
      <KeptFilters query={query} omit="search" />
    </SearchForm>
  );
}

/**
 * The areas (each text in its own area: they add up to "All areas") and "With notes", as an area list's filters
 * (ui.css .lv-filter: pills with their icon, the chosen one in the app's chosen look). A wide card shows every chip
 * (the areas wrap, "With notes" stays at the end of the first line); a phone has one row that swipes sideways. The
 * copy for the other width is display:none, so it is neither focusable nor read.
 */
function Chips({ data, facets, query, i18n }: { data: ReviewPageData; facets: Facets; query: ReviewQuery; i18n: I18n }) {
  const { t } = i18n;
  const showAreas = data.facets.areas.length > 1;
  const showHints = facets.flagged > 0 || query.flagged;
  // A phone's row starts at its chosen chip, so the filter in use is in view (no page scroll; nothing on a wide card).
  const swiped = useRef<HTMLDivElement>(null);
  useEffect(() => {
    revealChosen(swiped.current);
  }, [query.area, query.flagged]);
  if (!showAreas && !showHints) return null;
  const all = facets.areas.reduce((n, a) => n + a.count, 0);
  const hints = `${t("review.filter.hints")} ${i18n.number(facets.flagged)}`;
  const row = (wrap: boolean) => (
    <div ref={wrap ? undefined : swiped} style={{ display: "flex", alignItems: wrap ? "flex-start" : "center", gap: 8, paddingBlock: 2, ...(wrap ? {} : { overflowX: "auto" as const }) }}>
      {showAreas ? (
        // A wide card: it takes the room left beside "With notes" and wraps in it. A phone: its natural width, swiped.
        <nav aria-label={t("review.filter.areaLabel")} style={wrap ? { flex: "0 1 auto", minWidth: 0 } : { flex: "none" }}>
          <ul className="lv-filters" style={wrap ? undefined : NO_WRAP}>
            {[{ area: null, count: all }, ...facets.areas].map((option) => {
              const text = `${option.area ? areaName(i18n, option.area) : t("review.filter.allAreas")} ${i18n.number(option.count)}`;
              const icon = option.area ? <s-icon type={areaIcon(option.area)} size="small" /> : null;
              return (
                <li key={option.area ?? "all"} style={{ flex: "none" }}>
                  {query.area === option.area ? (
                    <span className="lv-filter" aria-current="true">
                      {icon}
                      {text}
                    </span>
                  ) : (
                    <Link className="lv-filter" to={reviewHref(query, { area: option.area })}>
                      {icon}
                      {text}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {showAreas && showHints ? (
        <div aria-hidden="true" style={{ alignSelf: "stretch", display: "flex", flex: "none" }}>
          <s-divider direction="block" />
        </div>
      ) : null}
      {showHints ? (
        <div style={{ flex: "none" }}>
          {/* Chosen, it is the way back to all texts: a link in the chosen look, named for what it does. */}
          {query.flagged ? (
            <Link className="lv-filter" aria-current="true" to={reviewHref(query, { flagged: false })} aria-label={t("review.filter.remove", { name: hints })}>
              <s-icon type="alert-triangle" size="small" />
              {hints}
            </Link>
          ) : (
            <Link className="lv-filter" to={reviewHref(query, { flagged: true })}>
              <s-icon type="alert-triangle" size="small" />
              {hints}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      <s-box display={WIDE}>{row(true)}</s-box>
      <s-box display={NARROW}>{row(false)}</s-box>
    </>
  );
}

/** A filter the page came with (a job's texts, the old field filter), with the way back to all. */
function ScopeChip({ text, href, i18n }: { text: string; href: string; i18n: I18n }) {
  const { t } = i18n;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-chip>
        <s-icon slot="graphic" type="filter" />
        {text}
      </s-chip>
      <s-link href={href} accessibilityLabel={t("review.filter.remove", { name: text })}>
        {t("review.filter.showAll")}
      </s-link>
    </s-stack>
  );
}

/**
 * The strip's count: "6 Übersetzungen auf dieser Seite" until the first decision, then "Noch 4 von 6 offen";
 * with more than one page, where this page is ("· 1–50 von 60"); "everything decided" once nothing is open.
 */
export function stripSummary(data: ReviewPageData, actions: PageActions, i18n: I18n): string {
  const { t } = i18n;
  const progress = pageProgress(actions.total, actions.undecided);
  if (progress.kind === "done") return t("review.page.allDecided");
  const count = progress.kind === "fresh" ? t("review.page.summary", { count: actions.undecided }) : t("review.page.open", { count: actions.undecided, total: actions.total });
  const paged = data.page.nextCursor || !data.page.isFirstPage;
  return paged ? `${count} · ${t("review.page.position", { from: data.page.from, to: data.page.to, total: data.page.matching })}` : count;
}

/** Why the page's buttons wait, or that approving runs: one short line beside them. */
function pageNote(actions: PageActions, i18n: I18n): string | null {
  if (actions.approving) return i18n.t("review.page.busy");
  if (!actions.busy && actions.blocked) return i18n.t(actions.blocked === "empty" ? "review.page.blocked.empty" : "review.page.blocked.question");
  return null;
}

/** The page's two actions: "Alle ablehnen" and the page's one primary, "Alle N freigeben" (each opens its question). */
function PageButtons({ actions, i18n }: { actions: PageActions; i18n: I18n }) {
  const { t } = i18n;
  const disabled = actions.busy || actions.waiting || actions.blocked !== null;
  // Rejecting sends no edited text: an emptied one doesn't hold it, an open question does.
  const rejectDisabled = actions.busy || actions.waiting || actions.blocked === "question";
  return (
    <>
      <Button variant="tertiary" tone="critical" commandFor="review-reject" command="--show" {...(rejectDisabled ? { disabled: true } : {})}>
        {t("review.page.rejectAll")}
      </Button>
      {actions.approvable > 0 ? (
        <Button
          variant="primary"
          icon="check"
          commandFor="review-approve"
          command="--show"
          {...(disabled ? { disabled: true } : {})}
          {...(actions.approving ? { loading: true } : {})}
        >
          {t(actions.allOnPage ? "review.page.approveAll" : "review.page.approveAllOnPage", { count: actions.approvable })}
        </Button>
      ) : null}
    </>
  );
}

/**
 * "Wenn du alles freigibst, ist Französisch zu 12 % übersetzt." beside the button it explains, while texts of its
 * language still wait (the counts drop as the merchant decides): neutral words with the figure in semibold, the
 * icon of a figure that grows, and the way to the language.
 */
function Payoff({ data, facets, i18n }: { data: ReviewPageData; facets: Facets; i18n: I18n }) {
  const payoff = data.payoff;
  if (!payoff || (facets.languages.find((l) => l.locale === payoff.locale)?.count ?? 0) === 0) return null;
  const language = i18n.language(payoff.locale, data.names[payoff.locale]);
  // {percent} stays in the sentence until here, where it is split to set the figure in semibold.
  const [before, after = ""] = i18n.t("review.payoff", { language }).split("{percent}");
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
      <s-icon type="chart-histogram-growth" tone="success" />
      <s-stack direction="@container (inline-size > 640px) inline, block" gap="small-500 small-200" alignItems="baseline">
        <s-text>
          {before}
          <Strong>{i18n.percent(payoff.percent)}</Strong>
          {after}
        </s-text>
        <s-link href={languagePath(payoff.locale)}>{i18n.t("review.payoff.link", { language: languageLabel(i18n, payoff.locale, data.names) })}</s-link>
      </s-stack>
    </s-grid>
  );
}

export function ReviewControls({
  data,
  facets,
  query,
  actions,
  previewsFailed,
  i18n,
  stripRef,
}: {
  data: ReviewPageData;
  facets: Facets;
  query: ReviewQuery;
  actions: PageActions;
  previewsFailed: boolean;
  i18n: I18n;
  /** The strip with the page's actions (the page shows them at the window's foot while it is out of view). */
  stripRef?: (element: HTMLDivElement | null) => void;
}) {
  const { t } = i18n;
  const quoted = query.search ? t("language.preview.quoted", { text: query.search }) : "";
  const summary = stripSummary(data, actions, i18n);
  const progress = pageProgress(actions.total, actions.undecided);
  const note = pageNote(actions, i18n);
  const tabs = pickerTabs(languageTabs(data, facets, i18n), query, data, i18n);
  // Chips up to six languages ("All" isn't one), else the select that opens a language as soon as it is picked.
  const kind = switcherKind(tabs.length - 1);
  const picker = (swipe: boolean) => (
    <LanguagePicker
      languages={tabs}
      current={query.locale ?? ALL}
      i18n={i18n}
      label={t("review.lang.select")}
      navLabel={t("review.lang.label")}
      swipe={swipe}
      kind={kind}
      fallback={{ keep: <KeptFilters query={query} omit="locale" /> }}
    />
  );
  return (
    <s-section padding="none">
      <s-query-container>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            {data.facets.languages.length > 1 ? (
              <>
                {/* A phone: the languages' row that swipes (or the select), then the search (the row sits in this
                    stack, not in a grid track, so its width never widens the card). */}
                <s-box display={NARROW}>{picker(true)}</s-box>
                {/* A wide card: the search beside the first line of languages (they may wrap), or beside the select. */}
                <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 280px, 1fr" gap="base" alignItems="start">
                  <s-box display={WIDE}>{picker(false)}</s-box>
                  <Search query={query} i18n={i18n} />
                </s-grid>
              </>
            ) : (
              // One language: no tabs, the search has the row.
              <Search query={query} i18n={i18n} />
            )}
            <Chips data={data} facets={facets} query={query} i18n={i18n} />
            {data.job || query.group ? (
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                {data.job ? (
                  <ScopeChip text={t("review.filter.job", { date: i18n.date(data.job.createdAt, "medium") })} href={reviewHref(query, { jobId: null })} i18n={i18n} />
                ) : null}
                {query.group ? <ScopeChip text={t(`review.scope.group.${query.group as "seo" | "handle" | "content"}`)} href={reviewHref(query, { group: null })} i18n={i18n} /> : null}
              </s-stack>
            ) : null}
            {/* Without matches the page says so once, below the card, with its "Clear search" button. */}
            {query.search && data.page.matching ? (
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                <s-text>{t("language.list.search.results", { count: data.page.matching, query: quoted })}</s-text>
                <s-link href={reviewHref(query, { search: null })}>{t("language.list.search.clear")}</s-link>
              </s-stack>
            ) : null}
            {previewsFailed ? <s-text color="subdued">{t("review.previews.error")}</s-text> : null}
          </s-stack>
        </s-box>
        {/* A selection with nothing in it has nothing to decide: the page says so below the card. */}
        {data.page.size > 0 ? <s-divider /> : null}
        {data.page.size > 0 ? (
          <div ref={stripRef} data-review-strip="">
            <s-box padding="base" background="subdued">
              <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="small-200 base" alignItems="center">
                <s-stack direction="block" gap="small-300">
                  <s-text>{summary}</s-text>
                  {/* The share already decided (decorative: the count says it in words). */}
                  {progress.kind === "open" ? (
                    <div className="lv-review-progress" aria-hidden="true">
                      <ProgressBar value={progress.percent} label={summary} />
                    </div>
                  ) : null}
                  <Payoff data={data} facets={facets} i18n={i18n} />
                </s-stack>
                {actions.undecided > 0 ? (
                  <s-stack direction="inline" gap="small-200 base" alignItems="center" justifyContent="end">
                    {note ? <s-text color="subdued">{note}</s-text> : null}
                    <PageButtons actions={actions} i18n={i18n} />
                  </s-stack>
                ) : null}
              </s-grid>
            </s-box>
          </div>
        ) : null}
      </s-query-container>
    </s-section>
  );
}

/**
 * The page's decision at the foot of the window while the strip is scrolled out of view, after a page of cards:
 * the same count and both buttons (they open the same two questions). The page shows it only while the strip is out
 * of view, so the screen never shows two primary buttons. Drawn into the document's body, outside the page's
 * containers (a query container would hold a fixed element in its own box). Its height, as drawn, sizes the room
 * under the page's last line and the window's scroll padding, so nothing (and no focused control: WCAG 2.4.11)
 * stays hidden under it. Styles: ui.css, .lv-review-bar.
 */
export function FloatingBar({ data, actions, i18n }: { data: ReviewPageData; actions: PageActions; i18n: I18n }) {
  const note = pageNote(actions, i18n);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = inner.current;
    const root = document.documentElement;
    if (!element) return;
    const measure = () => root.style.setProperty("--lv-review-bar-h", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    root.classList.add("lv-review-bar-on");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.classList.remove("lv-review-bar-on");
      root.style.removeProperty("--lv-review-bar-h");
    };
  }, []);
  return createPortal(
    <div className="lv-review-bar" data-review-bar="">
      <div ref={inner} className="lv-review-bar__inner">
        <div className="lv-review-bar__text">
          <span className="lv-review-bar__summary">{stripSummary(data, actions, i18n)}</span>
          {note ? <span className="lv-review-bar__note">{note}</span> : null}
        </div>
        <div className="lv-review-bar__actions">
          <PageButtons actions={actions} i18n={i18n} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
