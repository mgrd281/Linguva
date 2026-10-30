/**
 * Review's control card: the languages as tabs with flags and counts, a
 * search that runs while typing, the areas and "With notes" as chips (all
 * in view on a wide card, one row that swipes sideways on a phone), the
 * job's or the old field filter's scope, the payoff for a page of one
 * language, and the strip with the page's two actions. Filters are links
 * (instant, no "Apply"); every change starts on the first page.
 */
import { useEffect, useRef } from "react";
import { Form, useSubmit } from "react-router";
import type { ReviewPageData } from "../.server/review/page";
import type { I18n } from "../i18n/i18n";
import { localeCountry } from "../lib/flags";
import { languagePath } from "../lib/language-categories";
import { reviewHref, type Facets, type ReviewQuery } from "../lib/review-view";
import { areaIcon, areaName, focusSoon, languageLabel, NARROW, WIDE } from "./ReviewCard";
import { Flag } from "./Flag";
import { PLAIN_LIST } from "./LanguageLayout";

/** Typing pauses this long before the search runs. */
const SEARCH_DELAY_MS = 350;
const COUNT = { fontVariantNumeric: "tabular-nums" } as const;
/** A tab's padding: roomy on a wide card, tighter on a phone, where four languages then fit in two lines. */
const TAB_PADDING = "@container (inline-size > 640px) small-200 small-100, small-200";

export interface PageActions {
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

function LanguageTabs({ data, facets, query, i18n }: { data: ReviewPageData; facets: Facets; query: ReviewQuery; i18n: I18n }) {
  const { t } = i18n;
  const languages = facets.languages
    .map((l) => ({ ...l, name: languageLabel(i18n, l.locale, data.names) }))
    .sort((a, b) => a.name.localeCompare(b.name, i18n.locale));
  const tabs = [
    { locale: null as string | null, name: t("language.list.filter.all"), count: facets.total },
    ...languages,
  ];
  return (
    <nav aria-label={t("review.lang.label")}>
      <ul style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 4 }}>
        {tabs.map((tab) => {
          const hidden = tab.locale !== null && data.published[tab.locale] === false;
          const content = (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {tab.locale ? <Flag country={localeCountry(tab.locale, data.marketCountries)} fallback={tab.locale} size={20} /> : null}
              <s-text type={query.locale === tab.locale ? "strong" : "generic"}>{tab.name}</s-text>
              {hidden ? (
                <>
                  <s-icon type="hide" color="subdued" size="small" />
                  <s-text accessibilityVisibility="exclusive">{t("review.lang.hidden")}</s-text>
                </>
              ) : null}
              <s-text color="subdued">
                <span style={COUNT}>{i18n.number(tab.count)}</span>
              </s-text>
            </s-stack>
          );
          return (
            <li key={tab.locale ?? "all"}>
              {query.locale === tab.locale ? (
                <span aria-current="true">
                  <s-box padding={TAB_PADDING} borderRadius="base" background="strong">
                    {content}
                  </s-box>
                </span>
              ) : (
                <s-clickable href={reviewHref(query, { locale: tab.locale })} padding={TAB_PADDING} borderRadius="base">
                  {content}
                </s-clickable>
              )}
            </li>
          );
        })}
      </ul>
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
      {query.locale ? <input type="hidden" name="lang" value={query.locale} /> : null}
      {query.area ? <input type="hidden" name="area" value={query.area} /> : null}
      {query.flagged ? <input type="hidden" name="flagged" value="1" /> : null}
      {query.jobId ? <input type="hidden" name="job" value={query.jobId} /> : null}
      {query.group ? <input type="hidden" name="group" value={query.group} /> : null}
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
    const row = swiped.current;
    const chosen = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !chosen) return;
    const from = row.getBoundingClientRect();
    const box = chosen.getBoundingClientRect().width ? chosen.getBoundingClientRect() : (chosen.firstElementChild?.getBoundingClientRect() ?? null);
    if (!box || !from.width) return;
    if (box.left < from.left || box.right > from.right) row.scrollLeft += box.left - from.left - 16;
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

export function ReviewControls({
  data,
  facets,
  query,
  actions,
  previewsFailed,
  i18n,
}: {
  data: ReviewPageData;
  facets: Facets;
  query: ReviewQuery;
  actions: PageActions;
  previewsFailed: boolean;
  i18n: I18n;
}) {
  const { t } = i18n;
  const quoted = query.search ? t("language.preview.quoted", { text: query.search }) : "";
  const payoffLanguage = data.payoff ? i18n.language(data.payoff.locale, data.names[data.payoff.locale]) : "";
  const disabled = actions.busy || actions.waiting || actions.blocked !== null;
  // Rejecting sends no edited text: an emptied one doesn't hold it, an open question does.
  const rejectDisabled = actions.busy || actions.waiting || actions.blocked === "question";
  const summary =
    actions.undecided > 0
      ? `${t("review.page.summary", { count: actions.undecided })}${data.page.nextCursor || !data.page.isFirstPage ? ` · ${t("review.page.position", { from: data.page.from, to: data.page.to, total: data.page.matching })}` : ""}`
      : t("review.page.allDecided");
  return (
    <s-section padding="none">
      <s-query-container>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            {data.facets.languages.length > 1 ? (
              // The search beside the first line of tabs (they may wrap).
              <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 280px, 1fr" gap="base" alignItems="start">
                <LanguageTabs data={data} facets={facets} query={query} i18n={i18n} />
                <Search query={query} i18n={i18n} />
              </s-grid>
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
            {/* While texts of its language still wait (the counts drop as the merchant decides). */}
            {data.payoff && (facets.languages.find((l) => l.locale === data.payoff!.locale)?.count ?? 0) > 0 ? (
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                <s-icon type="chart-line" tone="info" />
                <s-stack direction="@container (inline-size > 640px) inline, block" gap="small-200" alignItems="baseline">
                  <s-text tone="info">{t("review.payoff", { language: payoffLanguage, percent: i18n.percent(data.payoff.percent) })}</s-text>
                  <s-link href={languagePath(data.payoff.locale)}>{`${t("review.payoff.link", { language: languageLabel(i18n, data.payoff.locale, data.names) })} ›`}</s-link>
                </s-stack>
              </s-grid>
            ) : null}
            {previewsFailed ? <s-text color="subdued">{t("review.previews.error")}</s-text> : null}
          </s-stack>
        </s-box>
        {/* A selection with nothing in it has nothing to decide: the page says so below the card. */}
        {data.page.size > 0 ? <s-divider /> : null}
        {data.page.size > 0 ? (
          <s-box padding="base" background="subdued">
            <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="small-200 base" alignItems="center">
              <s-text>{summary}</s-text>
              {actions.undecided > 0 ? (
                <s-stack direction="inline" gap="small-200 base" alignItems="center" justifyContent="end">
                  {actions.approving ? <s-text color="subdued">{t("review.page.busy")}</s-text> : null}
                  {!actions.busy && actions.blocked ? (
                    <s-text color="subdued">{t(actions.blocked === "empty" ? "review.page.blocked.empty" : "review.page.blocked.question")}</s-text>
                  ) : null}
                  <s-button variant="tertiary" tone="critical" commandFor="review-reject" command="--show" {...(rejectDisabled ? { disabled: true } : {})}>
                    {t("review.page.rejectAll")}
                  </s-button>
                  {actions.approvable > 0 ? (
                    <s-button
                      variant="primary"
                      icon="check"
                      commandFor="review-approve"
                      command="--show"
                      {...(disabled ? { disabled: true } : {})}
                      {...(actions.approving ? { loading: true } : {})}
                    >
                      {t(actions.allOnPage ? "review.page.approveAll" : "review.page.approveAllOnPage", { count: actions.approvable })}
                    </s-button>
                  ) : null}
                </s-stack>
              ) : null}
            </s-grid>
          </s-box>
        ) : null}
      </s-query-container>
    </s-section>
  );
}
