/**
 * Review's control card: the languages as tabs with flags and counts
 * (visible languages first, a hidden one says so in words; a select on a
 * wide card with more than six), a search that runs while typing, the areas
 * and "With notes" as chips (all in view on a wide card, one row that swipes
 * sideways on a phone, as the languages do there), the job's or the old
 * field filter's scope, and the strip with the page's count, the share
 * already decided, the payoff for a page of one language and the page's two
 * actions. Filters are links (instant, no "Apply"); every change starts on
 * the first page. While the strip is scrolled out of view, the same count
 * and actions float at the foot of the window (FloatingBar).
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Form, useSubmit } from "react-router";
import type { ReviewPageData } from "../.server/review/page";
import type { I18n } from "../i18n/i18n";
import { switcherKind } from "../lib/content-language";
import { localeCountry } from "../lib/flags";
import { languagePath } from "../lib/language-categories";
import { languageOrder, pageProgress, reviewHref, type Facets, type ReviewQuery } from "../lib/review-view";
import { ALL } from "../lib/select-all";
import { areaIcon, areaName, focusSoon, languageLabel, NARROW, WIDE } from "./ReviewCard";
import { Flag } from "./Flag";
import { PLAIN_LIST } from "./LanguageLayout";
import { ProgressBar } from "./ProgressBar";
import { Button } from "./Button";
import { Strong } from "./Type";

/** Typing pauses this long before the search runs. */
const SEARCH_DELAY_MS = 350;
const COUNT = { fontVariantNumeric: "tabular-nums" } as const;
const NO_WRAP = { whiteSpace: "nowrap" } as const;

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

/** "Arabisch versteckt 3": a tab as a screen reader names it (the visible words, in their order). */
function tabLabel(tab: LanguageTab, i18n: I18n): string {
  return [tab.name, tab.hidden ? i18n.t("review.lang.hidden") : null, i18n.number(tab.count)].filter(Boolean).join(" ");
}

/** A tab's flag, name (semibold on the chosen one), "hidden" in words under it, and its count. */
function TabBody({ tab, chosen, data, i18n }: { tab: LanguageTab; chosen: boolean; data: ReviewPageData; i18n: I18n }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {tab.locale ? <Flag country={localeCountry(tab.locale, data.marketCountries)} fallback={tab.locale} size={20} /> : null}
      <s-stack direction="block">
        <span style={NO_WRAP}>{chosen ? <Strong>{tab.name}</Strong> : <s-text>{tab.name}</s-text>}</span>
        {tab.hidden ? (
          <s-stack direction="inline" gap="small-400" alignItems="center">
            <s-icon type="hide" color="subdued" size="small" />
            <span style={NO_WRAP}>
              <s-text color="subdued">{i18n.t("review.lang.hidden")}</s-text>
            </span>
          </s-stack>
        ) : null}
      </s-stack>
      <s-text color="subdued">
        <span style={COUNT}>{i18n.number(tab.count)}</span>
      </s-text>
    </s-stack>
  );
}

/** A swiped row starts at its chosen item, so the filter in use is in view (no page scroll; nothing where the row isn't shown). */
function revealChosen(row: HTMLElement | null) {
  const chosen = row?.querySelector<HTMLElement>('[aria-current="true"]');
  if (!row || !chosen) return;
  const from = row.getBoundingClientRect();
  const box = chosen.getBoundingClientRect().width ? chosen.getBoundingClientRect() : (chosen.firstElementChild?.getBoundingClientRect() ?? null);
  if (!box || !from.width) return;
  if (box.left < from.left || box.right > from.right) row.scrollLeft += box.left - from.left - 16;
}

/**
 * The languages as tabs, 44 px high like the Jobs page's: they wrap on a wide card; on a phone (`swipe`) they are
 * one row that swipes sideways and starts at the chosen tab. A link's words are read once, from a label of their
 * own (WCAG 2.5.3: the visible words, in order).
 */
function LanguageTabs({ tabs, query, data, i18n, swipe }: { tabs: LanguageTab[]; query: ReviewQuery; data: ReviewPageData; i18n: I18n; swipe: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (swipe) revealChosen(list.current);
  }, [swipe, query.locale]);
  return (
    <nav aria-label={i18n.t("review.lang.label")}>
      <ul ref={list} className={swipe ? "lv-review-tabs lv-review-tabs--swipe" : "lv-review-tabs"}>
        {tabs.map((tab) => (
          <li key={tab.locale ?? "all"}>
            {/* The tabs of a row are equally high (a hidden language's tab has two lines). */}
            {query.locale === tab.locale ? (
              <span aria-current="true" style={{ display: "grid" }}>
                <s-stack
                  direction="block"
                  justifyContent="center"
                  background="strong"
                  borderRadius="base"
                  paddingInline="small-100"
                  paddingBlock="small-300"
                  minBlockSize="44px"
                  blockSize="100%"
                >
                  <TabBody tab={tab} chosen data={data} i18n={i18n} />
                </s-stack>
              </span>
            ) : (
              <s-clickable href={reviewHref(query, { locale: tab.locale })} borderRadius="base" blockSize="100%">
                <s-text accessibilityVisibility="exclusive">{tabLabel(tab, i18n)}</s-text>
                <s-stack
                  direction="block"
                  justifyContent="center"
                  paddingInline="small-100"
                  paddingBlock="small-300"
                  minBlockSize="44px"
                  blockSize="100%"
                  accessibilityVisibility="hidden"
                >
                  <TabBody tab={tab} chosen={false} data={data} i18n={i18n} />
                </s-stack>
              </s-clickable>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
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

/**
 * More than six languages on a wide card: one select with "Show", as the Content page has it (nothing changes
 * until it is pressed). Each option names its count, and a hidden language says so.
 */
function LanguageSelect({ tabs, query, i18n }: { tabs: LanguageTab[]; query: ReviewQuery; i18n: I18n }) {
  const { t } = i18n;
  return (
    <nav aria-label={t("review.lang.label")}>
      <Form method="get">
        <KeptFilters query={query} omit="locale" />
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="end">
          <s-select name="lang" label={t("review.lang.select")} value={query.locale ?? ALL}>
            {tabs.map((tab) => (
              <s-option key={tab.locale ?? ALL} value={tab.locale ?? ALL}>
                {t(tab.hidden ? "review.lang.optionHidden" : "review.lang.option", { language: tab.name, count: tab.count })}
              </s-option>
            ))}
          </s-select>
          <Button type="submit">{t("review.lang.show")}</Button>
        </s-grid>
      </Form>
    </nav>
  );
}

/**
 * The search was being typed in when it last ran: the page is drawn afresh
 * for the new results, and the field takes the focus back (caret at the
 * end), so typing goes on where it was.
 */
let searchHadFocus = false;

/** The search: runs while typing (after a pause, from two characters on) and at once on Enter. */
function Search({ query, i18n }: { query: ReviewQuery; i18n: I18n }) {
  const { t } = i18n;
  const submit = useSubmit();
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    if (!searchHadFocus) return;
    searchHadFocus = false;
    focusSoon(() => field.current);
    requestAnimationFrame(() => {
      const input = field.current?.shadowRoot?.querySelector("input");
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  }, []);
  const run = () => {
    searchHadFocus = Boolean(form.current?.contains(document.activeElement));
  };
  const onInput = (event: Event) => {
    const text = (event.currentTarget as HTMLInputElement).value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (text.length === 1) return;
    timer.current = setTimeout(() => {
      if (!form.current) return;
      run();
      void submit(form.current, { replace: true });
    }, SEARCH_DELAY_MS);
  };
  return (
    <Form method="get" ref={form} role="search" onSubmit={run}>
      <KeptFilters query={query} omit="search" />
      <s-search-field
        ref={field}
        name="q"
        label={t("common.action.search")}
        labelAccessibilityVisibility="exclusive"
        placeholder={t("review.filter.searchPlaceholder")}
        value={query.search ?? ""}
        onInput={onInput}
      />
    </Form>
  );
}

/**
 * The areas (each text in its own area: they add up to "All areas") and "With notes". A wide card shows every chip
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
          <ul style={{ ...PLAIN_LIST, display: "flex", flexWrap: wrap ? "wrap" : "nowrap", gap: 8 }}>
            {[{ area: null, count: all }, ...facets.areas].map((option) => {
              const text = `${option.area ? areaName(i18n, option.area) : t("review.filter.allAreas")} ${i18n.number(option.count)}`;
              const icon = option.area ? <s-icon slot="graphic" type={areaIcon(option.area)} /> : null;
              return (
                <li key={option.area ?? "all"} style={{ flex: "none" }}>
                  {query.area === option.area ? (
                    <span aria-current="true">
                      <s-chip color="strong">
                        {icon}
                        {text}
                      </s-chip>
                    </span>
                  ) : (
                    <s-clickable-chip href={reviewHref(query, { area: option.area })}>
                      {icon}
                      {text}
                    </s-clickable-chip>
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
          {query.flagged ? (
            <span aria-current="true">
              <s-clickable-chip color="strong" href={reviewHref(query, { flagged: false })} accessibilityLabel={t("review.filter.remove", { name: hints })}>
                <s-icon slot="graphic" type="alert-triangle" />
                {hints}
              </s-clickable-chip>
            </span>
          ) : (
            <s-clickable-chip href={reviewHref(query, { flagged: true })}>
              <s-icon slot="graphic" type="alert-triangle" />
              {hints}
            </s-clickable-chip>
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
  const tabs = languageTabs(data, facets, i18n);
  return (
    <s-section padding="none">
      <s-query-container>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            {data.facets.languages.length > 1 ? (
              <>
                {/* A phone: the tabs' row that swipes, then the search (the row sits in this stack, not in a grid
                    track, so its width never widens the card). */}
                <s-box display={NARROW}>
                  <LanguageTabs tabs={tabs} query={query} data={data} i18n={i18n} swipe />
                </s-box>
                {/* A wide card: the search beside the first line of tabs (they may wrap), or beside the select. */}
                <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 280px, 1fr" gap="base" alignItems="start">
                  <s-box display={WIDE}>
                    {switcherKind(tabs.length - 1) === "select" ? (
                      <LanguageSelect tabs={tabs} query={query} i18n={i18n} />
                    ) : (
                      <LanguageTabs tabs={tabs} query={query} data={data} i18n={i18n} swipe={false} />
                    )}
                  </s-box>
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
