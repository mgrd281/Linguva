/**
 * An area's items in a language (the list on /app/languages/:locale/:category),
 * one card: filters by each item's one state that add up to "All" (the shown
 * one in the app's chosen look; none while every item has the same state), a
 * name search as you type where Shopify can search, then the items in groups by state,
 * open work first, each group saying in one line what its state means. A row
 * shows the item's picture, its name, what customers see in the language,
 * and each of its texts as an icon and a word; the whole row opens the
 * editor (its name is the link, stretched over the row, so what the row says
 * stays readable), 50 a page.
 */
import { Link } from "react-router";
import type { CategoryItems, CategoryRow, ListState } from "../.server/languages/language-page";
import type { I18n, MessageKey } from "../i18n/i18n";
import { itemErrorMessage, itemKindLabel, jobErrorMessage } from "../i18n/labels";
import { isMetafieldCoverageType, type FieldGroup } from "../lib/coverage-rules";
import { CATEGORIES, categoryPath, ITEM_STATES, withOrigin, type CategoryId, type ItemState, type Origin } from "../lib/language-categories";
import { TRACK_COLOUR } from "./Coverage";
import { CARD, PLAIN_LIST } from "./LanguageLayout";
import { StateIcon } from "./ItemStates";
import { SearchForm } from "./SearchField";
import { Button } from "./Button";
import { Strong } from "./Type";

/** A list's address with its filter, search and position, and where the list was opened from. */
export function listHref(locale: string, category: CategoryId, query: { state?: ListState; q?: string; after?: string | null; from?: Origin }): string {
  const params = new URLSearchParams();
  if (query.state && query.state !== "all") params.set("state", query.state);
  if (query.q) params.set("q", query.q);
  if (query.after) params.set("after", query.after);
  if (query.from) params.set("from", query.from);
  const search = params.toString();
  return `${categoryPath(locale, category)}${search ? `?${search}` : ""}`;
}

/** An icon inside a line of text (a link's chevron). */
const INLINE_ICON = { display: "inline-flex", verticalAlign: "middle", marginInlineStart: 2 } as const;

/** Each text of an item by what it is, in the merchant's words (URL handles are never listed). */
const TEXT_NAMES: Record<Exclude<FieldGroup, "url">, MessageKey> = {
  title: "language.list.text.title",
  description: "language.list.text.description",
  seo_title: "language.list.text.seo_title",
  seo_description: "language.list.text.seo_description",
  alt: "language.list.text.alt",
  value: "language.list.text.value",
  other: "language.list.text.other",
};
/** Pages, blog posts and blogs have a title rather than a name. */
const TITLED: ReadonlySet<string> = new Set(["PAGE", "ARTICLE", "BLOG"]);

function textName(i18n: I18n, group: FieldGroup, type: string): string {
  if (group === "title" && TITLED.has(type)) return i18n.t("language.list.text.heading");
  return i18n.t(TEXT_NAMES[group === "url" ? "other" : group]);
}

/**
 * What one item is, for areas with things of several kinds ("Menu item", "Shipping method"): the words of
 * the lists, also on the language page's cards (one word per thing).
 */
const KIND_WORDS: Partial<Record<string, MessageKey>> = {
  MENU: "language.list.kind.MENU",
  LINK: "language.list.kind.LINK",
  FILTER: "language.list.kind.FILTER",
  PRODUCT_OPTION: "language.list.kind.PRODUCT_OPTION",
  PRODUCT_OPTION_VALUE: "language.list.kind.PRODUCT_OPTION_VALUE",
  SHOP: "language.preview.google",
  SHOP_POLICY: "language.list.kind.SHOP_POLICY",
  DELIVERY_METHOD_DEFINITION: "language.list.kind.DELIVERY_METHOD_DEFINITION",
  PAYMENT_GATEWAY: "language.list.kind.PAYMENT_GATEWAY",
  SELLING_PLAN_GROUP: "language.list.kind.SELLING_PLAN_GROUP",
  SELLING_PLAN: "language.list.kind.SELLING_PLAN",
  BLOG: "language.list.kind.BLOG",
  ARTICLE: "language.list.kind.ARTICLE",
  MEDIA_IMAGE: "language.list.kind.MEDIA_IMAGE",
  COLLECTION_IMAGE: "language.list.kind.COLLECTION_IMAGE",
  ARTICLE_IMAGE: "language.list.kind.ARTICLE_IMAGE",
  PRODUCT_METAFIELD: "language.list.kind.field",
  COLLECTION_METAFIELD: "language.list.kind.field",
  PAGE_METAFIELD: "language.list.kind.field",
  ARTICLE_METAFIELD: "language.list.kind.field",
};

export function kindWord(i18n: I18n, type: string): string | null {
  const key = KIND_WORDS[type];
  return key ? i18n.t(key) : null;
}

/** The row's name: a custom field's own name, else the item's name, else its kind and reference. */
function rowName(i18n: I18n, row: CategoryRow): string {
  if (isMetafieldCoverageType(row.type)) {
    if (row.label) return row.label;
  } else if (row.title) {
    return row.title;
  }
  return i18n.t("coverage.items.untitled", { type: kindWord(i18n, row.type) ?? itemKindLabel(i18n, row.type), reference: row.reference });
}

/** Thumbnails: 64 px on a wide screen, 48 px on a phone. */
const THUMB = "clamp(48px, 14vw, 64px)";
const GROUP_HEADING = { margin: 0, fontSize: 13, lineHeight: "20px", fontWeight: 650 } as const;
const BREAK = { overflowWrap: "anywhere" } as const;

function Thumbnail({ image, icon }: { image: CategoryRow["image"]; icon: (typeof CATEGORIES)[CategoryId]["icon"] }) {
  return (
    <div style={{ width: THUMB, height: THUMB, borderRadius: 10, overflow: "hidden", background: TRACK_COLOUR, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {/* The name is written beside it. */}
      {image ? <img src={image.url} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> : <s-icon type={icon} color="subdued" />}
    </div>
  );
}

export interface ListNames {
  /** The language inside a sentence ("Dänisch", "danois"), and its code for the translated words. */
  language: string;
  locale: string;
  /** The store's own language, what customers see where nothing is translated. */
  primary: string;
}

/**
 * What customers see of the item in the language: its translated name. Where
 * nothing is translated they see the name above, which its group already
 * says ("Customers still see English here"), so the row doesn't repeat it.
 */
function CustomerLine({ row, i18n, names }: { row: CategoryRow; i18n: I18n; names: ListNames }) {
  const { t } = i18n;
  const quoted = (text: string) => t("language.preview.quoted", { text });
  if (isMetafieldCoverageType(row.type)) {
    return row.title ? (
      <s-text color="subdued">
        <span style={BREAK}>{t("language.list.row.owner", { owner: quoted(row.title) })}</span>
      </s-text>
    ) : null;
  }
  if (!row.translated) return null;
  return (
    <s-text color="subdued">
      {t("language.list.row.translated", { language: names.language })}{" "}
      <span lang={names.locale} dir="auto" style={BREAK}>
        {quoted(row.translated)}
      </span>
    </s-text>
  );
}

function TextChips({ row, i18n }: { row: CategoryRow; i18n: I18n }) {
  if (!row.texts.length) return null;
  return (
    <ul style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {row.texts.map((text) => {
        const name = textName(i18n, text.group, row.type);
        return (
          <li key={text.group}>
            <s-chip accessibilityLabel={`${name}, ${i18n.t(`language.word.${text.state}`)}`}>
              <StateIcon slot="graphic" state={text.state} size="small" />
              {name}
            </s-chip>
          </li>
        );
      })}
    </ul>
  );
}

/** Why a row needs attention: its texts changed in the original, or why its translation failed. */
function RowNotes({ row, i18n, smart }: { row: CategoryRow; i18n: I18n; smart: CategoryItems["smart"] }) {
  const { t } = i18n;
  const changed = row.texts.filter((text) => text.state === "outdated").map((text) => textName(i18n, text.group, row.type));
  const failure = row.failureCode ? (itemErrorMessage(i18n, row.failureCode) ?? jobErrorMessage(i18n, row.failureCode)) : null;
  return (
    <>
      {changed.length ? <s-text tone="caution">{t("language.list.row.outdated", { texts: changed.join(", ") })}</s-text> : null}
      {failure ? <s-text tone="critical">{failure}</s-text> : null}
      {row.smart === "translating" ? (
        <s-stack direction="inline">
          <s-badge tone="info" icon="in-progress">
            {t("coverage.items.smart.translating")}
          </s-badge>
        </s-stack>
      ) : row.smart === "excluded" ? (
        <s-stack direction="inline">
          <s-badge icon="minus-circle">{t("coverage.items.smart.excluded")}</s-badge>
        </s-stack>
      ) : row.smart === "waiting" && smart?.nextCheck && smart.zone ? (
        <s-text color="subdued">
          {t("language.list.smart.waiting", { time: t("automatic.schedule.zone", { time: i18n.dateTimeIn(smart.nextCheck, smart.zone), zone: smart.zone }) })}
        </s-text>
      ) : null}
    </>
  );
}

/**
 * One item. With an editor, the whole row opens it: its name is the link
 * (read "Open: <name>"), stretched over the row (ui.css, .lv-row), with a
 * chevron at the end; the rest of the row stays text, read in its order.
 * The editor gets where the list was opened from, so its way back keeps it.
 */
function ItemRow({ row, data, i18n, names, origin }: { row: CategoryRow; data: CategoryItems; i18n: I18n; names: ListNames; origin: Origin }) {
  const { t } = i18n;
  const name = rowName(i18n, row);
  // Areas with things of several kinds say which kind each one is.
  const kind = CATEGORIES[data.category.id].types.length > 1 && !isMetafieldCoverageType(row.type) ? kindWord(i18n, row.type) : null;
  return (
    <div className="lv-row" {...(row.href ? { "data-linked": "" } : {})}>
      <s-grid gridTemplateColumns={row.href ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr)"} gap="base" alignItems="start">
        <Thumbnail image={row.image} icon={CATEGORIES[data.category.id].icon} />
        <s-stack direction="block" gap="small-200">
          <s-stack direction="block" gap="small-500">
            {kind ? <s-text color="subdued">{kind}</s-text> : null}
            {row.href ? (
              <Link to={withOrigin(row.href, origin)} className="lv-row__link">
                <span className="lv-sr">{t("language.list.row.open")}: </span>
                {name}
              </Link>
            ) : (
              <span style={BREAK}>
                <Strong>{name}</Strong>
              </span>
            )}
            <CustomerLine row={row} i18n={i18n} names={names} />
          </s-stack>
          <TextChips row={row} i18n={i18n} />
          <RowNotes row={row} i18n={i18n} smart={data.smart} />
        </s-stack>
        {row.href ? (
          // Beside the picture's middle (its height follows the screen width).
          <div style={{ display: "flex", alignItems: "center", height: THUMB }}>
            <s-icon type="chevron-right" color="subdued" />
          </div>
        ) : null}
      </s-grid>
    </div>
  );
}

/** A group's heading: its state, how many items have it, and what it means for customers. */
function GroupHeading({ state, count, data, i18n, names }: { state: ItemState; count: number; data: CategoryItems; i18n: I18n; names: ListNames }) {
  const { t } = i18n;
  const meaning = {
    failed: t("language.words.failed"),
    outdated: t("language.words.outdated"),
    missing: t("language.words.missing", { primary: names.primary }),
    waiting: t("language.words.waiting"),
    complete: t("language.list.group.complete", { language: names.language }),
  }[state];
  const review = state === "waiting" ? data.category.review : null;
  return (
    <s-box background="subdued" padding="small-200 base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small-200" alignItems="center">
        <StateIcon state={state} size="small" />
        <s-stack direction="inline" gap="small-300 small-200" alignItems="center">
          <h3 style={GROUP_HEADING}>{t(`language.state.${state}`)}</h3>
          <s-badge>{i18n.number(count)}</s-badge>
          <s-text color="subdued">{meaning}</s-text>
        </s-stack>
        {review ? (
          <span style={{ whiteSpace: "nowrap" }}>
            <s-link href={review.href}>{t("language.next.review.action")}</s-link>
          </span>
        ) : null}
      </s-grid>
    </s-box>
  );
}

/**
 * "All 48 · Failed 1 · Outdated 3 …": the shown one is the current filter, in the app's chosen look (the
 * blue ring and tint, ui.css .lv-filter), the others links.
 */
function Filters({ data, i18n, origin }: { data: CategoryItems; i18n: I18n; origin: Origin }) {
  const { t } = i18n;
  const { locale } = data.language;
  const chosen = data.filter.state;
  // Items of one state: "All" and that state would show the same items, and its group heading names it.
  // A chosen state keeps the row, as the way back to All.
  if (chosen === "all" && ITEM_STATES.filter((s) => data.counts[s] > 0).length < 2) return null;
  const options: Array<{ state: ListState; label: string; count: number }> = [
    { state: "all", label: t("language.list.filter.all"), count: data.counts.all },
    // States without items are left out, unless chosen.
    ...ITEM_STATES.filter((s) => data.counts[s] > 0 || s === chosen).map((s) => ({ state: s, label: t(`language.state.${s}`), count: data.counts[s] })),
  ];
  return (
    <nav aria-label={t("language.list.filter.label")}>
      <ul className="lv-filters">
        {options.map((option) => {
          const text = `${option.label} ${i18n.number(option.count)}`;
          const icon = option.state === "all" ? null : <StateIcon state={option.state} size="small" />;
          return (
            <li key={option.state}>
              {option.state === chosen ? (
                <span className="lv-filter" aria-current="true">
                  {icon}
                  {text}
                </span>
              ) : (
                <Link className="lv-filter" to={listHref(locale, data.category.id, { state: option.state, q: data.filter.q, from: origin })}>
                  {icon}
                  {text}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Search by name as you type (SearchForm, as Review's: after a pause, from two characters, at once on
 * Enter, the focus kept): a GET form, so the filter stays and the list starts again from the top.
 */
function Search({ data, i18n, origin }: { data: CategoryItems; i18n: I18n; origin: Origin }) {
  const label = i18n.t("language.list.search.label");
  return (
    <SearchForm action={listHref(data.language.locale, data.category.id, {})} label={label} placeholder={label} value={data.filter.q}>
      {data.filter.state !== "all" ? <input type="hidden" name="state" value={data.filter.state} /> : null}
      {origin ? <input type="hidden" name="from" value={origin} /> : null}
    </SearchForm>
  );
}

export function CategoryList({ data, i18n, names, origin = null }: { data: CategoryItems; i18n: I18n; names: ListNames; origin?: Origin }) {
  const { t } = i18n;
  const { locale } = data.language;
  const id = data.category.id;
  const query = data.filter.q;
  const from = origin;
  const quotedQuery = t("language.preview.quoted", { text: query });
  // Rows come in state order: consecutive rows of one state are its group.
  const groups: Array<{ state: ItemState; rows: CategoryRow[] }> = [];
  for (const row of data.rows) {
    const last = groups[groups.length - 1];
    if (last && last.state === row.state) last.rows.push(row);
    else groups.push({ state: row.state, rows: [row] });
  }
  const { page } = data;
  return (
    // A native section with the card's edge (Polaris draws its sections flat on a phone); its heading in the
    // type scale, as the language page's "Area by area".
    <section aria-labelledby="list-heading">
      <s-box {...CARD} padding="none" overflow="hidden">
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <h2 id="list-heading" className="lv-h2">
              {t("language.list.rows.heading")}
            </h2>
            {data.category.searchable ? <Search data={data} i18n={i18n} origin={from} /> : null}
            {query ? (
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                <s-text>
                  {data.counts.all ? t("language.list.search.results", { count: data.counts.all, query: quotedQuery }) : t("language.list.search.none", { query: quotedQuery })}
                </s-text>
                <s-link href={listHref(locale, id, { state: data.filter.state, from })}>{t("language.list.search.clear")}</s-link>
              </s-stack>
            ) : null}
            {data.counts.all ? <Filters data={data} i18n={i18n} origin={from} /> : null}
            {data.titlesUnavailable ? <s-text color="subdued">{i18n.t("language.card.previewError")}</s-text> : null}
          </s-stack>
        </s-box>

        {groups.map((group) => (
          <s-stack key={`${group.state}-${group.rows[0]!.id}`} direction="block">
            <GroupHeading state={group.state} count={data.counts[group.state]} data={data} i18n={i18n} names={names} />
            <ul style={PLAIN_LIST}>
              {group.rows.map((row, i) => (
                <li key={row.id}>
                  {i > 0 ? <s-divider /> : null}
                  <ItemRow row={row} data={data} i18n={i18n} names={names} origin={from} />
                </li>
              ))}
            </ul>
            {/* The whole group is on its own filter when this page shows only part of it; a group of every item
                goes on with the pages below (its filter would list the same items). */}
            {data.filter.state === "all" && group.rows.length < data.counts[group.state] && data.counts[group.state] < data.counts.all ? (
              <s-box padding="none base base">
                <s-link href={listHref(locale, id, { state: group.state, q: query, from })}>
                  {t("language.card.allCount", { count: data.counts[group.state] })}
                  <span style={INLINE_ICON}>
                    <s-icon type="chevron-right" size="small" />
                  </span>
                </s-link>
              </s-box>
            ) : null}
          </s-stack>
        ))}
        {!data.rows.length && data.counts.all ? (
          <s-box padding="base">
            <s-text color="subdued">{t("language.list.groupEmpty")}</s-text>
          </s-box>
        ) : null}

        {page.nextCursor || page.number > 1 ? (
          <>
            <s-divider />
            <s-box padding="base">
              <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
                <s-text color="subdued">{t("language.list.page.position", { page: page.number, from: page.from, to: page.to, total: page.total })}</s-text>
                <s-stack direction="inline" gap="small-200">
                  {page.number > 1 ? <Button href={listHref(locale, id, { state: data.filter.state, q: query, from })}>{t("language.list.page.first")}</Button> : null}
                  {page.nextCursor ? (
                    <Button href={listHref(locale, id, { state: data.filter.state, q: query, after: page.nextCursor, from })}>{t("language.list.page.next")}</Button>
                  ) : null}
                </s-stack>
              </s-grid>
            </s-box>
          </>
        ) : null}
      </s-box>
    </section>
  );
}
