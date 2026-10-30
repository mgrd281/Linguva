/**
 * An area's items in a language (the list on /app/languages/:locale/:category):
 * filters by each item's one state that add up to "All", a name search
 * where Shopify can search, then the items in groups by state, open work
 * first, each group saying in one line what its state means. A row shows
 * the item's picture, its name, what customers see in the language, and
 * each of its texts as an icon and a word; "Open" leads to the editor.
 * Rows are a plain list (no row is a button), 50 a page.
 */
import { Form } from "react-router";
import type { CategoryItems, CategoryRow, ListState } from "../.server/languages/language-page";
import type { I18n, MessageKey } from "../i18n/i18n";
import { itemErrorMessage, itemKindLabel, jobErrorMessage } from "../i18n/labels";
import { isMetafieldCoverageType, type FieldGroup } from "../lib/coverage-rules";
import { CATEGORIES, categoryPath, ITEM_STATES, type CategoryId, type ItemState } from "../lib/language-categories";
import { TRACK_COLOUR } from "./Coverage";
import { PLAIN_LIST } from "./LanguageLayout";
import { StateIcon } from "./ItemStates";

/** A list's address with its filter, search and position. */
export function listHref(locale: string, category: CategoryId, query: { state?: ListState; q?: string; after?: string | null }): string {
  const params = new URLSearchParams();
  if (query.state && query.state !== "all") params.set("state", query.state);
  if (query.q) params.set("q", query.q);
  if (query.after) params.set("after", query.after);
  const search = params.toString();
  return `${categoryPath(locale, category)}${search ? `?${search}` : ""}`;
}

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

/** What one item is, for areas with things of several kinds ("Menu item", "Shipping method"). */
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

function kindWord(i18n: I18n, type: string): string | null {
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
  primaryLocale: string | null;
}

/** What customers see of the item in the language: its translated name, or that they still see the original. */
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
  if (row.translated) {
    return (
      <s-text color="subdued">
        {t("language.list.row.translated", { language: names.language })}{" "}
        <span lang={names.locale} dir="auto" style={BREAK}>
          {quoted(row.translated)}
        </span>
      </s-text>
    );
  }
  if (!row.title || row.state === "complete") return null;
  return (
    <s-text color="subdued">
      {t("language.list.row.notYet", { language: names.language })}{" "}
      <span lang={names.primaryLocale ?? undefined} style={BREAK}>
        {quoted(row.title)}
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
          <s-badge tone="info">{t("coverage.items.smart.translating")}</s-badge>
        </s-stack>
      ) : row.smart === "excluded" ? (
        <s-stack direction="inline">
          <s-badge>{t("coverage.items.smart.excluded")}</s-badge>
        </s-stack>
      ) : row.smart === "waiting" && smart?.nextCheck && smart.zone ? (
        <s-text color="subdued">
          {t("language.list.smart.waiting", { time: t("automatic.schedule.zone", { time: i18n.dateTimeIn(smart.nextCheck, smart.zone), zone: smart.zone }) })}
        </s-text>
      ) : null}
    </>
  );
}

function ItemRow({ row, data, i18n, names }: { row: CategoryRow; data: CategoryItems; i18n: I18n; names: ListNames }) {
  const { t } = i18n;
  const name = rowName(i18n, row);
  // Areas with things of several kinds say which kind each one is.
  const kind = CATEGORIES[data.category.id].types.length > 1 && !isMetafieldCoverageType(row.type) ? kindWord(i18n, row.type) : null;
  const open = t("language.list.row.open");
  return (
    <s-box padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="start">
        <Thumbnail image={row.image} icon={CATEGORIES[data.category.id].icon} />
        <s-stack direction="block" gap="small-200">
          <s-stack direction="block" gap="small-500">
            {kind ? <s-text color="subdued">{kind}</s-text> : null}
            <span style={BREAK}>
              <s-text type="strong">{name}</s-text>
            </span>
            <CustomerLine row={row} i18n={i18n} names={names} />
          </s-stack>
          <TextChips row={row} i18n={i18n} />
          <RowNotes row={row} i18n={i18n} smart={data.smart} />
        </s-stack>
        {row.href ? (
          <span style={{ whiteSpace: "nowrap" }}>
            <s-link href={row.href} accessibilityLabel={`${open}: ${name}`}>
              {open} ›
            </s-link>
          </span>
        ) : null}
      </s-grid>
    </s-box>
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

/** "All 48 · Failed 1 · Outdated 3 …": the shown one is the current filter, the others links. */
function Filters({ data, i18n }: { data: CategoryItems; i18n: I18n }) {
  const { t } = i18n;
  const { locale } = data.language;
  const chosen = data.filter.state;
  const options: Array<{ state: ListState; label: string; count: number }> = [
    { state: "all", label: t("language.list.filter.all"), count: data.counts.all },
    // States without items are left out, unless chosen.
    ...ITEM_STATES.filter((s) => data.counts[s] > 0 || s === chosen).map((s) => ({ state: s, label: t(`language.state.${s}`), count: data.counts[s] })),
  ];
  return (
    <nav aria-label={t("language.list.filter.label")}>
      <ul style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const text = `${option.label} ${i18n.number(option.count)}`;
          const icon = option.state === "all" ? null : <StateIcon slot="graphic" state={option.state} size="small" />;
          return (
            <li key={option.state}>
              {option.state === chosen ? (
                <span aria-current="true">
                  <s-chip color="strong">
                    {icon}
                    {text}
                  </s-chip>
                </span>
              ) : (
                <s-clickable-chip href={listHref(locale, data.category.id, { state: option.state, q: data.filter.q })}>
                  {icon}
                  {text}
                </s-clickable-chip>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Search by name (a GET form: the filter stays, the list starts again from the top). */
function Search({ data, i18n }: { data: CategoryItems; i18n: I18n }) {
  const { t } = i18n;
  const label = t("language.list.search.label");
  return (
    <Form method="get" action={listHref(data.language.locale, data.category.id, {})}>
      {data.filter.state !== "all" ? <input type="hidden" name="state" value={data.filter.state} /> : null}
      <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="end">
        <s-search-field name="q" label={label} labelAccessibilityVisibility="exclusive" placeholder={label} value={data.filter.q} />
        <s-button type="submit">{t("language.list.search.submit")}</s-button>
      </s-grid>
    </Form>
  );
}

export function CategoryList({ data, i18n, names }: { data: CategoryItems; i18n: I18n; names: ListNames }) {
  const { t } = i18n;
  const { locale } = data.language;
  const id = data.category.id;
  const query = data.filter.q;
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
    <s-section padding="none" heading={t("language.list.rows.heading")}>
      <s-box padding="none base base">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">{t("language.list.rows.intro")}</s-text>
          {data.category.searchable ? <Search data={data} i18n={i18n} /> : null}
          {query ? (
            <s-stack direction="inline" gap="small-200 base" alignItems="center">
              <s-text>
                {data.counts.all ? t("language.list.search.results", { count: data.counts.all, query: quotedQuery }) : t("language.list.search.none", { query: quotedQuery })}
              </s-text>
              <s-link href={listHref(locale, id, { state: data.filter.state })}>{t("language.list.search.clear")}</s-link>
            </s-stack>
          ) : null}
          {data.counts.all ? <Filters data={data} i18n={i18n} /> : null}
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
                <ItemRow row={row} data={data} i18n={i18n} names={names} />
              </li>
            ))}
          </ul>
          {/* The whole group is on its own filter when this page shows only part of it. */}
          {data.filter.state === "all" && group.rows.length < data.counts[group.state] ? (
            <s-box padding="none base base">
              <s-link href={listHref(locale, id, { state: group.state, q: query })}>{t("language.card.allCount", { count: data.counts[group.state] })} ›</s-link>
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
                {page.number > 1 ? <s-button href={listHref(locale, id, { state: data.filter.state, q: query })}>{t("language.list.page.first")}</s-button> : null}
                {page.nextCursor ? (
                  <s-button href={listHref(locale, id, { state: data.filter.state, q: query, after: page.nextCursor })}>{t("language.list.page.next")}</s-button>
                ) : null}
              </s-stack>
            </s-grid>
          </s-box>
        </>
      ) : null}
    </s-section>
  );
}
