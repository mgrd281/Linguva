/**
 * The Overview's places: a card per country the store sells to, or per
 * language, each the way to that language's page. A country card names the
 * language its customers read, how much of it is translated and its
 * biggest open state; a country with several languages lists them as rows.
 * Countries without a language of their own, those whose language is hidden
 * or not offered there, and those reading the original are grouped in quiet
 * cards, so the grid keeps to what there is to translate.
 *
 * On a phone each card is one compact row with the percentage beside the
 * name, so a store selling to many countries stays short.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import type { StateCounts } from "../lib/coverage-rules";
import type { CountryCoverage, CountryLanguage } from "../lib/country-coverage";
import { localeCountry } from "../lib/flags";
import { languagePath } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";
import { percentLabel } from "./Coverage";
import { Flag } from "./Flag";
import { StateIcon, TextStateBar, textCounts } from "./ItemStates";
import { PLAIN_LIST } from "./LanguageLayout";

/** A language of the store as the Overview loads it (one per additional language). */
export interface PlaceLanguage {
  locale: string;
  /** Shopify's English name (the interface names it in its own language). */
  name: string | null;
  published: boolean;
  measured: boolean;
  /** The last count left some of its content unread. */
  partial: boolean;
  /** Content types it counts that Linguva has no access to. */
  unchecked: number;
  counts: StateCounts | null;
  complete: number;
  total: number;
}

interface PlaceContext {
  i18n: I18n;
  /** The store's languages by locale. */
  languages: ReadonlyMap<string, PlaceLanguage>;
  /** Areas being translated now, by locale ("Pages"). */
  running: ReadonlyMap<string, readonly string[]>;
  /** The original language inside a sentence ("Deutsch"). */
  primary: string;
  /** Some language is counted: until then, cards leave their figures out (the store's figure says why). */
  anyCounted: boolean;
}

const LANGUAGE_SETTINGS = "shopify://admin/settings/languages";

/** Narrow (a phone): one compact row per card; wide: figure and bar below the name. */
const COMPACT = "@container (inline-size > 640px) none, auto";
const WIDE = "@container (inline-size > 640px) auto, none";
const CARD_GRID = "@container (inline-size > 560px) 1fr 1fr, (inline-size > 860px) 1fr 1fr 1fr, 1fr";
const BIG_FIGURE = { fontSize: 24, lineHeight: "28px", fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" } as const;
const ROW_FIGURE = { fontWeight: 650, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

const counted = (language: PlaceLanguage | undefined): language is PlaceLanguage & { counts: StateCounts } =>
  Boolean(language && language.measured && language.total > 0 && language.counts);

/** A language's name as a title ("Dänisch", "Danois"). */
function titleOf(i18n: I18n, locale: string, language?: PlaceLanguage) {
  return upperFirst(i18n.language(locale, language?.name));
}

/** "29 %", or "—" while nothing is counted. */
function percentOf(i18n: I18n, language: PlaceLanguage | undefined) {
  return counted(language) ? percentLabel(i18n, language.complete, language.total) : "—";
}

/** The big figure and what it means: "29 % translated into Danish", or why there is none. */
function Figure({ language, caption, i18n }: { language: PlaceLanguage | undefined; caption: string; i18n: I18n }) {
  const { t } = i18n;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="baseline">
      <span style={BIG_FIGURE}>{percentOf(i18n, language)}</span>
      <s-text color="subdued">{counted(language) ? caption : language?.measured ? t("language.hero.nothing") : t("language.hero.notCounted")}</s-text>
    </s-stack>
  );
}

/**
 * One line with what matters most: what is being translated now, then
 * drafts waiting, failed and outdated texts (at most two), else what is
 * still missing, else done (never while something wasn't read).
 */
function StatusLine({ language, ctx }: { language: PlaceLanguage | undefined; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  if (!language) return null;
  const items: Array<{ key: string; icon: ReactNode; text: string }> = [];
  const running = ctx.running.get(language.locale);
  if (running?.length) items.push({ key: "job", icon: <s-icon type="in-progress" tone="info" size="small" />, text: t("overview.card.job", { areas: languageList(i18n, [...running]) }) });
  if (counted(language)) {
    const texts = textCounts(language.counts);
    for (const state of ["waiting", "failed", "outdated"] as const) {
      if (texts[state] > 0 && items.length < 2) items.push({ key: state, icon: <StateIcon state={state} size="small" />, text: t(`language.count.${state}`, { count: texts[state] }) });
    }
    if (!items.length && texts.missing > 0) items.push({ key: "missing", icon: <StateIcon state="missing" size="small" />, text: t("overview.card.missing", { count: texts.missing }) });
    if (!items.length) {
      // Complete as far as it was read: say what wasn't, never "done".
      items.push(
        language.partial
          ? { key: "partial", icon: <s-icon type="alert-triangle" tone="caution" size="small" />, text: t("language.card.incomplete") }
          : language.unchecked
            ? { key: "access", icon: <s-icon type="lock" color="subdued" size="small" />, text: t("overview.card.noAccess") }
            : { key: "done", icon: <StateIcon state="complete" size="small" />, text: t("overview.card.done") },
      );
    }
  }
  if (!items.length) return null;
  return (
    <s-stack direction="inline" gap="small-100 base" alignItems="center">
      {items.map((item) => (
        <s-stack key={item.key} direction="inline" gap="small-300" alignItems="center">
          {item.icon}
          <s-text color="subdued">{item.text}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

/** A whole card that opens a language: flag and names, the figure, the bar and the status line. */
function PlaceCard(props: { href: string; flag: ReactNode; title: string; subtitle?: string; badge?: ReactNode; language: PlaceLanguage | undefined; caption: string; ctx: PlaceContext }) {
  const { i18n } = props.ctx;
  const language = props.language;
  return (
    <s-section padding="none">
      <s-clickable href={props.href} padding="base" borderRadius="large-100">
        <s-stack direction="block" gap="small-200">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto auto" gap="small-200" alignItems="center">
            {props.flag}
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{props.title}</s-text>
                {props.badge}
              </s-stack>
              {props.subtitle ? <s-text color="subdued">{props.subtitle}</s-text> : null}
            </s-stack>
            <s-box display={COMPACT}>
              {props.ctx.anyCounted ? <span style={{ ...ROW_FIGURE, fontSize: 17 }}>{percentOf(i18n, language)}</span> : null}
            </s-box>
            <s-icon type="chevron-right" color="subdued" />
          </s-grid>
          {props.ctx.anyCounted ? (
            <s-box display={WIDE}>
              <s-stack direction="block" gap="small-200">
                <Figure language={language} caption={props.caption} i18n={i18n} />
                {counted(language) ? (
                  // The figure and the status line say it in words.
                  <div aria-hidden="true">
                    <TextStateBar counts={language.counts} label={props.title} i18n={i18n} />
                  </div>
                ) : null}
              </s-stack>
            </s-box>
          ) : null}
          <StatusLine language={language} ctx={props.ctx} />
        </s-stack>
      </s-clickable>
    </s-section>
  );
}

/** One of a country's languages: a row that opens it when the store has it. */
function LanguageRow({ entry, ctx }: { entry: CountryLanguage; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const language = ctx.languages.get(entry.locale);
  const name = titleOf(i18n, entry.locale, language);
  if (entry.primary || !language) {
    return (
      <s-box padding="small-200 base" minBlockSize="44px">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="center" minBlockSize="28px">
          <s-text type="strong">{name}</s-text>
          {entry.primary ? (
            <s-badge tone="success" icon="check-circle">
              {t("overview.card.original")}
            </s-badge>
          ) : (
            <s-text color="subdued">{t("overview.card.notAdded")}</s-text>
          )}
        </s-grid>
      </s-box>
    );
  }
  const state = entry.available ? null : entry.reason === "unpublished" ? t("language.hidden") : t("overview.card.notInMarket");
  return (
    <s-clickable href={languagePath(entry.locale)} padding="small-200 base" minBlockSize="44px">
      <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 64px auto auto, 1fr auto auto" gap="small-200" alignItems="center" minBlockSize="28px">
        <s-text type="strong">{name}</s-text>
        <s-box display={WIDE}>
          <div aria-hidden="true">{counted(language) && !state ? <TextStateBar counts={language.counts} label={name} i18n={i18n} height={6} /> : null}</div>
        </s-box>
        {state ? <s-text color="subdued">{state}</s-text> : ctx.anyCounted ? <span style={ROW_FIGURE}>{percentOf(i18n, language)}</span> : <span />}
        <s-icon type="chevron-right" color="subdued" />
      </s-grid>
    </s-clickable>
  );
}

/** A country that reads several languages (Switzerland, Belgium): each language a row. */
function SeveralLanguagesCard({ country, ctx }: { country: CountryCoverage; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const name = i18n.country(country.code, country.name);
  return (
    <s-section padding="none" accessibilityLabel={name}>
      <s-box padding="base base small-200">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
          <Flag country={country.code} size={28} />
          <s-stack direction="block" gap="small-500">
            <s-text type="strong">{name}</s-text>
            <s-text color="subdued">{i18n.t("overview.card.choose", { count: country.languages.length })}</s-text>
          </s-stack>
        </s-grid>
      </s-box>
      <ul style={PLAIN_LIST}>
        {country.languages.map((entry) => (
          <li key={entry.locale}>
            <s-divider />
            <LanguageRow entry={entry} ctx={ctx} />
          </li>
        ))}
      </ul>
    </s-section>
  );
}

/** Up to three flags side by side, for a card about several countries. */
function Flags({ codes }: { codes: readonly string[] }) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      {codes.slice(0, 3).map((code) => (
        <Flag key={code} country={code} size={28} />
      ))}
    </s-stack>
  );
}

/** Countries without any language of their own in the store: what customers see there, and where to add it. */
function MissingCard({ countries, ctx, free, max }: { countries: CountryCoverage[]; ctx: PlaceContext; free: number; max: number }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const wanted = new Set(countries.flatMap((c) => c.languages.map((l) => l.locale)));
  const detail =
    countries.length === 1
      ? t("overview.missing.one", { primary: ctx.primary, language: languageList(i18n, countries[0]!.languages.map((l) => i18n.language(l.locale))) })
      : t("overview.missing.many", { primary: ctx.primary });
  return (
    <s-section accessibilityLabel={t("overview.missing.badge")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline">
            <s-badge tone="warning" icon="alert-triangle">
              {t("overview.missing.badge")}
            </s-badge>
          </s-stack>
          <s-text color="subdued">{detail}</s-text>
        </s-stack>
        <s-grid gridTemplateColumns="@container (inline-size > 300px) 1fr 1fr, (inline-size > 560px) 1fr 1fr 1fr, 1fr" gap="base">
          {countries.map((country) => (
            <s-grid key={country.code} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
              <Flag country={country.code} size={28} />
              <s-stack direction="block" gap="small-500">
                <s-text type="strong">{i18n.country(country.code, country.name)}</s-text>
                <s-text color="subdued">{languageList(i18n, country.languages.map((l) => upperFirst(i18n.language(l.locale))))}</s-text>
              </s-stack>
            </s-grid>
          ))}
        </s-grid>
        {free > 0 ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button href={LANGUAGE_SETTINGS} target="_top" icon="plus">
              {t("overview.missing.action")}
            </s-button>
            {free < wanted.size ? <s-text color="subdued">{t("overview.countries.capacity", { max, count: free })}</s-text> : null}
          </s-stack>
        ) : (
          <s-text color="subdued">{t("languages.limit.body", { max })}</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

/** Countries whose one language the store has, but hidden or not offered there: a quiet row per language. */
function UnavailableRow({ countries, entry, ctx }: { countries: CountryCoverage[]; entry: CountryLanguage; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const language = ctx.languages.get(entry.locale);
  const inSentence = i18n.language(entry.locale, language?.name);
  const hidden = entry.reason === "unpublished";
  const figure = counted(language) ? t("overview.unavailable.figure", { percent: percentOf(i18n, language) }) : ctx.anyCounted ? t("language.hero.notCounted") : "";
  return (
    <s-section padding="none">
      <s-clickable href={languagePath(entry.locale)} padding="base" borderRadius="large-100">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="center">
          <Flags codes={countries.map((c) => c.code)} />
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{languageList(i18n, countries.map((c) => i18n.country(c.code, c.name)))}</s-text>
              {hidden ? <s-badge icon="hide">{t("language.hidden")}</s-badge> : <s-badge>{t("overview.unavailable.notInMarketBadge")}</s-badge>}
            </s-stack>
            <s-text color="subdued">
              {hidden ? t("overview.unavailable.hidden", { language: inSentence }) : t("overview.unavailable.notInMarket", { language: inSentence })} {figure}
            </s-text>
          </s-stack>
          <s-icon type="chevron-right" color="subdued" />
        </s-grid>
      </s-clickable>
    </s-section>
  );
}

/** The countries reading the original language: nothing to translate there. */
function OriginalCard({ countries, ctx }: { countries: CountryCoverage[]; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  return (
    <s-section>
      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="center">
        <Flags codes={countries.map((c) => c.code)} />
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{languageList(i18n, countries.map((c) => i18n.country(c.code, c.name)))}</s-text>
          <s-text color="subdued">{t("overview.original.detail", { primary: ctx.primary })}</s-text>
        </s-stack>
        <s-badge tone="success" icon="check-circle">
          {t("overview.card.original")}
        </s-badge>
      </s-grid>
    </s-section>
  );
}

type Grouped =
  | { kind: "original"; country: CountryCoverage }
  | { kind: "one"; country: CountryCoverage; entry: CountryLanguage }
  | { kind: "several"; country: CountryCoverage }
  | { kind: "missing"; country: CountryCoverage }
  | { kind: "unavailable"; country: CountryCoverage; entry: CountryLanguage };

function group(country: CountryCoverage): Grouped {
  if (country.languages.every((l) => l.available && l.primary)) return { kind: "original", country };
  if (country.languages.length > 1) return { kind: "several", country };
  const entry = country.languages[0]!;
  if (entry.available) return { kind: "one", country, entry };
  return entry.reason === "not-added" ? { kind: "missing", country } : { kind: "unavailable", country, entry };
}

export interface PlacesProps {
  i18n: I18n;
  languages: readonly PlaceLanguage[];
  running: ReadonlyMap<string, readonly string[]>;
  primary: string;
}

function context(props: PlacesProps): PlaceContext {
  return {
    i18n: props.i18n,
    languages: new Map(props.languages.map((l) => [l.locale, l])),
    running: props.running,
    primary: props.primary,
    anyCounted: props.languages.some((l) => l.measured),
  };
}

/** Every country the store sells to, the least translated first. */
export function CountryCards(props: PlacesProps & { countries: readonly CountryCoverage[]; freeLanguages: number; maxLanguages: number }) {
  const ctx = context(props);
  const { i18n } = ctx;
  const groups = props.countries.map(group);
  const of = <K extends Grouped["kind"]>(kind: K) => groups.filter((g): g is Extract<Grouped, { kind: K }> => g.kind === kind);
  const name = (c: CountryCoverage) => i18n.country(c.code, c.name);
  // Least translated first; countries not counted yet after them.
  const cards = [...of("one"), ...of("several")].sort(
    (a, b) => (a.country.percent ?? 101) - (b.country.percent ?? 101) || name(a.country).localeCompare(name(b.country), i18n.locale),
  );
  // One quiet row per language for the countries whose language is hidden or not offered.
  const unavailable = new Map<string, { entry: CountryLanguage; countries: CountryCoverage[] }>();
  for (const g of of("unavailable")) {
    const key = `${g.entry.locale}|${g.entry.reason}`;
    const row = unavailable.get(key) ?? { entry: g.entry, countries: [] };
    row.countries.push(g.country);
    unavailable.set(key, row);
  }
  const missing = of("missing").map((g) => g.country);
  const original = of("original").map((g) => g.country);
  return (
    <s-stack direction="block" gap="base">
      {missing.length ? <MissingCard countries={missing} ctx={ctx} free={props.freeLanguages} max={props.maxLanguages} /> : null}
      {cards.length ? (
        <s-grid gridTemplateColumns={CARD_GRID} gap="@container (inline-size > 640px) base, small-200" alignItems="start">
          {cards.map((card) => {
            if (card.kind === "several") return <SeveralLanguagesCard key={card.country.code} country={card.country} ctx={ctx} />;
            const language = ctx.languages.get(card.entry.locale);
            const inSentence = i18n.language(card.entry.locale, language?.name);
            return (
              <PlaceCard
                key={card.country.code}
                href={languagePath(card.entry.locale)}
                flag={<Flag country={card.country.code} size={28} />}
                title={name(card.country)}
                subtitle={upperFirst(inSentence)}
                language={language}
                caption={i18n.t("overview.card.into", { language: inSentence })}
                ctx={ctx}
              />
            );
          })}
        </s-grid>
      ) : null}
      {[...unavailable.values()].map((row) => (
        <UnavailableRow key={`${row.entry.locale}|${row.entry.reason}`} countries={row.countries} entry={row.entry} ctx={ctx} />
      ))}
      {original.length ? <OriginalCard countries={original} ctx={ctx} /> : null}
    </s-stack>
  );
}

/** Every language of the store: the ones customers can choose first, the least translated first. */
export function LanguageCards(props: PlacesProps & { countriesOf: ReadonlyMap<string, readonly string[]>; marketCountries: readonly string[] }) {
  const ctx = context(props);
  const { i18n } = ctx;
  const title = (l: PlaceLanguage) => titleOf(i18n, l.locale, l);
  const cards = [...props.languages].sort(
    (a, b) =>
      Number(b.published) - Number(a.published) ||
      Number(counted(b)) - Number(counted(a)) ||
      (counted(a) ? a.complete / a.total : 0) - (counted(b) ? b.complete / b.total : 0) ||
      title(a).localeCompare(title(b), i18n.locale),
  );
  return (
    <s-grid gridTemplateColumns={CARD_GRID} gap="@container (inline-size > 640px) base, small-200" alignItems="start">
      {cards.map((language) => {
        const countries = props.countriesOf.get(language.locale) ?? [];
        return (
          <PlaceCard
            key={language.locale}
            href={languagePath(language.locale)}
            flag={<Flag country={localeCountry(language.locale, props.marketCountries)} fallback={language.locale} size={28} />}
            title={title(language)}
            subtitle={countries.length ? languageList(i18n, [...countries]) : undefined}
            badge={language.published ? undefined : <s-badge icon="hide">{i18n.t("language.hidden")}</s-badge>}
            language={language}
            caption={i18n.t("language.hero.translated")}
            ctx={ctx}
          />
        );
      })}
    </s-grid>
  );
}
