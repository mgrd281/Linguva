/**
 * One area of a language (Products, Menus & filters, …) on the language
 * page: its figure, its states, a few real examples from the store, and
 * what to do there. The title is the link to the area's list; translating
 * is a separate button that opens the confirm dialog (no nested controls).
 *
 * Examples come later than the card (a separate request): pictures with
 * their names for products, collections, blog posts and images, a list of
 * names for pages, and each original beside its translation for everything
 * else. Shown are names and states only, never a translation without its
 * original next to it.
 */
import type { CategoryPreview, LanguagePage, PreviewItem } from "../.server/languages/language-page";
import type { I18n, MessageKey } from "../i18n/i18n";
import { itemKindLabel } from "../i18n/labels";
import type { IconName } from "../lib/icons";
import { CATEGORIES, type CategoryId } from "../lib/language-categories";
import { percentLabel, TRACK_COLOUR } from "./Coverage";
import { StateCountList, StateIcon, StateMarker, TextStateBar } from "./ItemStates";
import { ProgressBar } from "./ProgressBar";

export type LanguageCategory = LanguagePage["categories"][number];

/** "48 products": the things an area's item count names. */
export const ITEM_COUNT_KEYS: Partial<Record<CategoryId, MessageKey>> = {
  products: "language.category.products.items",
  collections: "language.category.collections.items",
  metaobjects: "language.category.metaobjects.items",
  pages: "language.category.pages.items",
  blog: "language.category.blog.items",
  images: "language.category.images.items",
};

const DETAIL: Partial<Record<CategoryId, MessageKey>> = {
  products: "language.category.products.detail",
  navigation: "language.category.navigation.detail",
  options: "language.category.options.detail",
  checkout: "language.category.checkout.detail",
  customFields: "language.category.customFields.detail",
  metaobjects: "language.category.metaobjects.detail",
  pages: "language.category.pages.detail",
  images: "language.category.images.detail",
};

/** Areas shown by pictures with their names; pages as a list of names; the rest as originals beside their translations. */
const PICTURES: ReadonlySet<CategoryId> = new Set(["products", "collections", "blog", "images"]);
/** Pictures on a card beside others, and on a phone. */
const SMALL_ROW = 3;
/** Narrower than this, only the featured card shows examples (one row of pictures). */
const WIDE = "@container (inline-size > 500px) auto, none";

export const BIG_FIGURE = { fontSize: 24, lineHeight: "28px", fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", whiteSpace: "nowrap" } as const;
const CLAMP = (lines: number) => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }) as const;

export function categoryName(i18n: I18n, id: CategoryId): string {
  return i18n.t(`language.category.${id}.name`);
}

/** "48 products · Name, description and texts for Google" (also the Content page's tiles). */
export function detailLine(i18n: I18n, category: { id: CategoryId; items: number | null; textTypes: readonly string[] }): string {
  const items = ITEM_COUNT_KEYS[category.id];
  const plans = category.textTypes.some((type) => type === "SELLING_PLAN_GROUP" || type === "SELLING_PLAN");
  const detail = category.id === "checkout" && plans ? "language.category.checkout.detailPlans" : DETAIL[category.id];
  return [items && category.items ? i18n.t(items, { count: category.items }) : null, detail ? i18n.t(detail) : null].filter(Boolean).join(" · ");
}

/**
 * An icon in a soft square: an area's, a content type's or a notice's
 * picture, and the Plan page's plan, meter and feature tiles
 * (`color="base"`). Squares under 32 px take the small icon unless
 * `iconSize` says otherwise.
 */
export function IconTile({ icon, size = 36, color = "subdued", iconSize }: { icon: IconName; size?: number; color?: "base" | "subdued"; iconSize?: "small" | "base" }) {
  return (
    <s-stack background="subdued" borderRadius="base" inlineSize={`${size}px`} blockSize={`${size}px`} alignItems="center" justifyContent="center">
      <s-icon type={icon} color={color} size={iconSize ?? (size < 32 ? "small" : "base")} />
    </s-stack>
  );
}

interface PreviewProps {
  category: CategoryId;
  items: PreviewItem[];
  i18n: I18n;
  locale: string;
  primaryName: string;
}

/**
 * Under a picture: its state, then what customers see ("outdated · “Regnjakke”",
 * "still German", "failed · still German"). A draft isn't in Shopify yet, so
 * a waiting item shows its state only.
 */
function itemLine({ item, i18n, primaryName }: { item: PreviewItem; i18n: I18n; primaryName: string }) {
  const word = item.state === "missing" ? null : i18n.t(`language.word.${item.state}`);
  const shown = item.translated
    ? { text: i18n.t("language.preview.quoted", { text: item.translated }), translated: true }
    : item.state === "waiting" || item.state === "complete"
      ? null
      : { text: i18n.t("language.preview.still", { language: primaryName }), translated: false };
  return { word, shown };
}

function Tile({ item, icon, i18n, locale, primaryName }: { item: PreviewItem; icon: (typeof CATEGORIES)[CategoryId]["icon"] } & Omit<PreviewProps, "category" | "items">) {
  const { word, shown } = itemLine({ item, i18n, primaryName });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: TRACK_COLOUR, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {item.image ? (
          <img src={item.image.url} alt={item.image.alt ?? ""} loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <s-icon type={icon} color="subdued" />
        )}
        <StateMarker state={item.state} />
      </div>
      {item.original ? (
        <span style={CLAMP(2)}>
          <s-text type="strong">{item.original}</s-text>
        </span>
      ) : null}
      <span style={CLAMP(2)}>
        <s-text color="subdued">
          {word}
          {word && shown ? " · " : null}
          {shown ? shown.translated ? <span lang={locale} dir="auto">{shown.text}</span> : shown.text : null}
        </s-text>
      </span>
    </div>
  );
}

function Pictures({ category, items, featured, ...rest }: PreviewProps & { featured: boolean }) {
  const icon = CATEGORIES[category].icon;
  const shown = featured ? items : items.slice(0, SMALL_ROW);
  return (
    <div style={{ display: "grid", gridTemplateColumns: featured ? "repeat(auto-fill, minmax(104px, 1fr))" : `repeat(${SMALL_ROW}, minmax(0, 1fr))`, gap: 12 }}>
      {shown.map((item, i) =>
        // On a phone the featured card keeps one row.
        i < SMALL_ROW ? (
          <Tile key={item.id} item={item} icon={icon} {...rest} />
        ) : (
          <s-box key={item.id} display={WIDE}>
            <Tile item={item} icon={icon} {...rest} />
          </s-box>
        ),
      )}
    </div>
  );
}

const ROW = { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBlockStart: `1px solid ${TRACK_COLOUR}`, minWidth: 0 } as const;

/** What one row shows on its right: the translation with its state's icon, or the state's word. */
function Outcome({ item, i18n, locale }: { item: PreviewItem; i18n: I18n; locale: string }) {
  return (
    <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, flex: item.translated ? "0 1 auto" : "none", minWidth: 0, textAlign: "end" }}>
      <StateIcon state={item.textState ?? item.state} size="small" />
      {item.translated ? (
        <span lang={locale} dir="auto" style={CLAMP(2)}>
          <s-text>{i18n.t("language.preview.quoted", { text: item.translated })}</s-text>
        </span>
      ) : (
        <span style={{ whiteSpace: "nowrap" }}>
          <s-text color="subdued">{i18n.t(`language.word.${item.textState ?? item.state}`)}</s-text>
        </span>
      )}
    </span>
  );
}

/** Originals beside their translations ("Menu · Hiking ✓ “Vandring”"), or page names with their states. */
function Rows({ category, items, i18n, locale }: PreviewProps) {
  const label = (item: PreviewItem) => {
    if (category === "pages" || category === "metaobjects") return null;
    if (item.label) return item.label;
    if (item.type === "SHOP") return i18n.t("language.preview.google");
    return itemKindLabel(i18n, item.type);
  };
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${TRACK_COLOUR}`, borderRadius: 10, overflow: "hidden" }}>
      {items.map((item, i) => {
        const kind = label(item);
        return (
          <li key={item.id} style={i === 0 ? { ...ROW, borderBlockStart: 0 } : ROW}>
            {kind ? (
              <span style={{ flex: "0 0 72px", minWidth: 0, ...CLAMP(1) }}>
                <s-text color="subdued">{kind}</s-text>
              </span>
            ) : null}
            <span style={{ flex: "1 1 auto", minWidth: 0, ...CLAMP(2) }}>
              <s-text>{item.original ?? "—"}</s-text>
            </span>
            {category === "pages" ? (
              <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, flex: "none", whiteSpace: "nowrap" }}>
                <StateIcon state={item.state} size="small" />
                <s-text color="subdued">{i18n.t(`language.word.${item.state}`)}</s-text>
              </span>
            ) : (
              <Outcome item={item} i18n={i18n} locale={locale} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Grey shapes where the examples will be, until they are loaded. */
function Placeholder({ pictures, featured }: { pictures: boolean; featured: boolean }) {
  const shape = { background: TRACK_COLOUR, borderRadius: 10 } as const;
  return (
    <div aria-hidden="true">
      {pictures ? (
        <div style={{ display: "grid", gridTemplateColumns: featured ? "repeat(auto-fill, minmax(104px, 1fr))" : `repeat(${SMALL_ROW}, minmax(0, 1fr))`, gap: 12 }}>
          {Array.from({ length: SMALL_ROW }, (_, i) => (
            <div key={i} style={{ ...shape, aspectRatio: "1 / 1" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ ...shape, height: 28 }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Preview({ category, preview, featured, i18n, locale, primaryName }: { category: CategoryId; preview: CategoryPreview | null; featured: boolean; i18n: I18n; locale: string; primaryName: string }) {
  const pictures = PICTURES.has(category);
  if (!preview) return <Placeholder pictures={pictures} featured={featured} />;
  if (!preview.items.length) return preview.error ? <s-text color="subdued">{i18n.t("language.card.previewError")}</s-text> : null;
  const props = { category, items: preview.items, i18n, locale, primaryName };
  return (
    <s-stack direction="block" gap="small-200">
      {pictures ? <Pictures {...props} featured={featured} /> : <Rows {...props} />}
      {preview.error ? <s-text color="subdued">{i18n.t("language.card.previewError")}</s-text> : null}
    </s-stack>
  );
}

/** A running translation in this area, in items, in place of the translate button. */
function JobProgress({ job, name, i18n }: { job: NonNullable<LanguageCategory["job"]>; name: string; i18n: I18n }) {
  const { t } = i18n;
  return (
    <s-box padding="small-100 base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{job.discoveryDone && job.total > 0 ? t("language.card.job", { done: job.done, total: job.total }) : t("language.card.jobFinding")}</s-text>
        {job.discoveryDone && job.total > 0 ? <ProgressBar value={(job.done / job.total) * 100} label={t("language.card.jobLabel", { category: name })} /> : null}
      </s-stack>
    </s-box>
  );
}

export interface CategoryCardProps {
  category: LanguageCategory;
  i18n: I18n;
  /** The language the card is about, and the store's own (what customers see where nothing is translated). */
  locale: string;
  primaryName: string;
  /** Its examples; null while they load. */
  preview: CategoryPreview | null;
  /** The first, wide card: more pictures, and examples on a phone too. */
  featured: boolean;
  /** Translating can start here: the confirm dialog's id, what to do before it opens, and whether it is starting. */
  translate: { modalId: string; onOpen: () => void; loading: boolean } | null;
}

export function CategoryCard({ category, i18n, locale, primaryName, preview, featured, translate }: CategoryCardProps) {
  const { t } = i18n;
  const name = categoryName(i18n, category.id);
  const { tally, state } = category;
  const detail = detailLine(i18n, category);
  // Nothing was read without access: no figure, only how to allow it.
  const figure = state.kind === "no-access" ? "—" : percentLabel(i18n, tally.complete, tally.total);
  const open = tally.counts.missing + tally.counts.outdated + tally.counts.failed;
  const all = category.items ? t("language.card.allCount", { count: category.items }) : t("language.card.all");
  const examples = <Preview category={category.id} preview={preview} featured={featured} i18n={i18n} locale={locale} primaryName={primaryName} />;
  return (
    <s-section accessibilityLabel={name}>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="start">
          <IconTile icon={CATEGORIES[category.id].icon} />
          <s-stack direction="block" gap="small-500">
            <s-heading>
              <s-link href={category.href}>{name}</s-link>
            </s-heading>
            {detail ? <s-text color="subdued">{detail}</s-text> : null}
          </s-stack>
          <s-stack direction="block" alignItems="end">
            <span style={BIG_FIGURE}>{figure}</span>
            {tally.total > 0 && state.kind !== "no-access" ? (
              <s-text color="subdued">{t("language.card.figure", { complete: tally.complete, total: tally.total })}</s-text>
            ) : null}
          </s-stack>
        </s-grid>

        {tally.total > 0 && state.kind !== "no-access" ? <TextStateBar counts={tally.counts} label={name} i18n={i18n} /> : null}
        {state.kind === "no-access" ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="lock" color="subdued" size="small" />
            <s-text color="subdued">{t("language.card.noAccess")}</s-text>
            {state.href ? <s-link href={state.href}>{t("coverage.types.allowAccess")}</s-link> : null}
          </s-stack>
        ) : state.kind === "counting" ? (
          <s-text color="subdued">{t("language.card.counting")}</s-text>
        ) : state.kind === "incomplete" ? (
          <s-text color="subdued">{t("language.card.incomplete")}</s-text>
        ) : null}
        {state.kind !== "no-access" ? <StateCountList counts={tally.counts} i18n={i18n} /> : null}

        {tally.total > 0 ? featured ? examples : <s-box display={WIDE}>{examples}</s-box> : null}

        {category.id === "checkout" && category.textTypes.includes("SHOP_POLICY") ? <s-text color="subdued">{t("language.card.legal")}</s-text> : null}
        {/* Image descriptions and custom fields are translated with their products (bulkTypesOf). */}
        {(category.id === "images" || category.id === "customFields") && open > 0 ? <s-text color="subdued">{t("language.card.withOwners")}</s-text> : null}
        {category.automatic ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="calendar-time" color="subdued" size="small" />
            <s-text color="subdued">{t("language.card.automatic")}</s-text>
          </s-stack>
        ) : null}
        {category.job ? <JobProgress job={category.job} name={name} i18n={i18n} /> : null}

        <s-divider />
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
          <s-stack direction="inline" gap="small-100 base" alignItems="center">
            <s-link href={category.href} accessibilityLabel={`${all}: ${name}`}>
              {all} ›
            </s-link>
            {category.review ? (
              <s-link href={category.review.href} accessibilityLabel={`${t("language.card.review", { count: category.review.count })}: ${name}`}>
                {t("language.card.review", { count: category.review.count })}
              </s-link>
            ) : null}
            {category.job ? <s-link href={category.job.href}>{t("language.card.jobOpen")}</s-link> : null}
          </s-stack>
          {translate && !category.job ? (
            <s-button
              icon="wand"
              commandFor={translate.modalId}
              command="--show"
              onClick={translate.onOpen}
              accessibilityLabel={`${t("language.action.translate")}: ${name}`}
              {...(translate.loading ? { loading: true } : {})}
            >
              {t("language.action.translate")}
            </s-button>
          ) : null}
        </s-grid>
      </s-stack>
    </s-section>
  );
}
