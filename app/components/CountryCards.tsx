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
 * name, so a store selling to many countries stays short. Every card keeps
 * its edge there too (CARD), names are semibold (Strong), and a language's
 * state is one badge with its icon wherever it shows: Original, Hidden, Not
 * offered, Not set up.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import type { StateCounts } from "../lib/coverage-rules";
import type { CountryCoverage, CountryLanguage } from "../lib/country-coverage";
import { localeCountry } from "../lib/flags";
import { languagePath } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";
import { cardGrid } from "./CategoryCard";
import { percentLabel } from "./Coverage";
import { CARD } from "./ContentTiles";
import { Flag } from "./Flag";
import { StateIcon, TextStateBar, textCounts } from "./ItemStates";
import { PLAIN_LIST } from "./LanguageLayout";
import { Button } from "./Button";
import { Strong } from "./Type";

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

/** Shopify's language settings: the Overview's one label and icon for them (app._index.tsx, languageSettings). */
const LANGUAGE_SETTINGS = "shopify://admin/settings/languages";

/** Narrow (a phone): one compact row per card; wide: figure and bar below the name. */
const COMPACT = "@container (inline-size > 640px) none, auto";
const WIDE = "@container (inline-size > 640px) auto, none";

/**
 * Columns for the cards: up to four fill their rows as Content's and a language's cards do (cardGrid: one
 * the full width, two side by side, four as two by two), never two beside an empty third column. Five and
 * more keep three in a row on a wide page: its last row may end short, but two columns would make a store
 * selling to many countries half as long again.
 */
export function placeGrid(count: number): string {
  return count <= 4 ? cardGrid(count) : "@container (inline-size > 560px) 1fr 1fr, (inline-size > 860px) 1fr 1fr 1fr, 1fr";
}

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

/** Why customers can't choose a language there: it is hidden in the store, or that market doesn't offer it. */
function UnavailableBadge({ reason, i18n }: { reason: CountryLanguage["reason"]; i18n: I18n }) {
  return reason === "unpublished" ? (
    <s-badge icon="hide">{i18n.t("language.hidden")}</s-badge>
  ) : (
    <s-badge icon="disabled">{i18n.t("overview.unavailable.notInMarketBadge")}</s-badge>
  );
}

/** The big figure and what it means: "29 % translated into Danish", or why there is none. */
function Figure({ language, caption, i18n }: { language: PlaceLanguage | undefined; caption: string; i18n: I18n }) {
  const { t } = i18n;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="baseline">
      <span className="lv-figure">{percentOf(i18n, language)}</span>
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
    <s-clickable href={props.href} {...CARD} padding="base">
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto auto" gap="small-200" alignItems="center">
          {props.flag}
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <Strong>{props.title}</Strong>
              {props.badge}
            </s-stack>
            {props.subtitle ? <s-text color="subdued">{props.subtitle}</s-text> : null}
          </s-stack>
          <s-box display={COMPACT}>{props.ctx.anyCounted ? <span className="lv-figure-row lv-ov-compact-figure">{percentOf(i18n, language)}</span> : null}</s-box>
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
          <Strong>{name}</Strong>
          {entry.primary ? (
            <s-badge tone="success" icon="check-circle">
              {t("overview.card.original")}
            </s-badge>
          ) : (
            <s-badge icon="minus-circle">{t("overview.card.notAdded")}</s-badge>
          )}
        </s-grid>
      </s-box>
    );
  }
  const unavailable = !entry.available;
  return (
    <s-clickable href={languagePath(entry.locale)} padding="small-200 base" minBlockSize="44px">
      <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 64px auto auto, 1fr auto auto" gap="small-200" alignItems="center" minBlockSize="28px">
        <Strong>{name}</Strong>
        <s-box display={WIDE}>
          <div aria-hidden="true">{counted(language) && !unavailable ? <TextStateBar counts={language.counts} label={name} i18n={i18n} height={6} /> : null}</div>
        </s-box>
        {unavailable ? <UnavailableBadge reason={entry.reason} i18n={i18n} /> : ctx.anyCounted ? <span className="lv-figure-row">{percentOf(i18n, language)}</span> : <span />}
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
    <section aria-label={name}>
      <s-box {...CARD} overflow="hidden">
        <s-box padding="base base small-200">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
            <Flag country={country.code} size={28} />
            <s-stack direction="block" gap="small-500">
              <Strong>{name}</Strong>
              <s-text color="subdued">{i18n.t("overview.card.several", { count: country.languages.length })}</s-text>
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
      </s-box>
    </section>
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

/**
 * Countries without any language of their own in the store: what customers
 * see there, and where to add it, unless the next step above already offers
 * that (`offered`): then the card only names them.
 */
function MissingCard({ countries, ctx, free, max, offered }: { countries: CountryCoverage[]; ctx: PlaceContext; free: number; max: number; offered: boolean }) {
  const { i18n } = ctx;
  const { t } = i18n;
  const wanted = new Set(countries.flatMap((c) => c.languages.map((l) => l.locale)));
  const detail =
    countries.length === 1
      ? t("overview.missing.one", { primary: ctx.primary, language: languageList(i18n, countries[0]!.languages.map((l) => i18n.language(l.locale))) })
      : t("overview.missing.many", { primary: ctx.primary });
  return (
    <section aria-label={t("overview.missing.badge")}>
      <s-box {...CARD} padding="base">
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
                  <Strong>{i18n.country(country.code, country.name)}</Strong>
                  <s-text color="subdued">{languageList(i18n, country.languages.map((l) => upperFirst(i18n.language(l.locale))))}</s-text>
                </s-stack>
              </s-grid>
            ))}
          </s-grid>
          {offered ? null : free > 0 ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <Button href={LANGUAGE_SETTINGS} target="_top" icon="language">
                {t("overview.checklist.languageSettings")}
              </Button>
              {free < wanted.size ? <s-text color="subdued">{t("overview.countries.capacity", { max, count: free })}</s-text> : null}
            </s-stack>
          ) : (
            <s-text color="subdued">{t("languages.limit.body", { max })}</s-text>
          )}
        </s-stack>
      </s-box>
    </section>
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
    <s-clickable href={languagePath(entry.locale)} {...CARD} padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="center">
        <Flags codes={countries.map((c) => c.code)} />
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <Strong>{languageList(i18n, countries.map((c) => i18n.country(c.code, c.name)))}</Strong>
            <UnavailableBadge reason={entry.reason} i18n={i18n} />
          </s-stack>
          <s-text color="subdued">
            {hidden ? t("overview.unavailable.hidden", { language: inSentence }) : t("overview.unavailable.notInMarket", { language: inSentence })} {figure}
          </s-text>
        </s-stack>
        <s-icon type="chevron-right" color="subdued" />
      </s-grid>
    </s-clickable>
  );
}

/** The countries reading the original language: nothing to translate there. */
function OriginalCard({ countries, ctx }: { countries: CountryCoverage[]; ctx: PlaceContext }) {
  const { i18n } = ctx;
  const { t } = i18n;
  return (
    <s-box {...CARD} padding="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="base" alignItems="center">
        <Flags codes={countries.map((c) => c.code)} />
        <s-stack direction="block" gap="small-500">
          <Strong>{languageList(i18n, countries.map((c) => i18n.country(c.code, c.name)))}</Strong>
          <s-text color="subdued">{t("overview.original.detail", { primary: ctx.primary })}</s-text>
        </s-stack>
        <s-badge tone="success" icon="check-circle">
          {t("overview.card.original")}
        </s-badge>
      </s-grid>
    </s-box>
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

/**
 * Every country the store sells to, the least translated first.
 * `languageFixOffered`: the next step above already opens Shopify's language
 * settings to add the missing languages, so the countries without one don't
 * repeat that button.
 */
export function CountryCards(props: PlacesProps & { countries: readonly CountryCoverage[]; freeLanguages: number; maxLanguages: number; languageFixOffered?: boolean }) {
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
      {missing.length ? <MissingCard countries={missing} ctx={ctx} free={props.freeLanguages} max={props.maxLanguages} offered={props.languageFixOffered ?? false} /> : null}
      {cards.length ? (
        <s-grid gridTemplateColumns={placeGrid(cards.length)} gap="@container (inline-size > 640px) base, small-200" alignItems="start">
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
    <s-grid gridTemplateColumns={placeGrid(cards.length)} gap="@container (inline-size > 640px) base, small-200" alignItems="start">
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
