/**
 * The one way to pick a language on a page that shows one language at a time (Content, an area's list,
 * Review, Coverage): Content's chips (ui.css .lv-lang), each with its flag and name, a hidden language
 * saying so in words under its name, the current one not a link but in the app's chosen look (the blue
 * ring and tint, aria-current="page"); every other chip is a link to the same page in its language.
 *
 * More than MAX_CHIPS languages (switcherKind): one select that opens the chosen language as soon as it
 * is picked, as Coverage's does. Its "Show" button is only there without JavaScript (inside <noscript>,
 * so a page with scripts never shows it): the select then sends its GET form.
 *
 * The page orders its languages and words them (`pickerLanguages` gives Content's order and names); the
 * picker only draws them.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Form, Link, useNavigate } from "react-router";
import type { I18n } from "../i18n/i18n";
import { chipName, chipOrder, switcherKind } from "../lib/content-language";
import { Button } from "./Button";
import { Flag } from "./Flag";
import { Strong } from "./Type";

/** One language (or "All") as the picker shows it. */
export interface PickerLanguage {
  /** The select's value and the chip's key: the locale, or the value of an "All" entry. */
  value: string;
  /** The flag's language (its code is the flag's fallback); null for an entry without a flag ("All"). */
  locale: string | null;
  /** The flag's country (localeCountry; null: the language's code in a neutral box). */
  country: string | null;
  /** The name on the chip, as chipName gives it ("Dänisch"). */
  name: string;
  /** Not visible in the store yet: "hidden" under the name. */
  hidden: boolean;
  /** A figure after the name (Review's waiting texts), or none. */
  figure?: string | null;
  /** The chip's name for screen readers, the visible words in their order ("Arabisch (versteckt)"); also the select's option. */
  label: string;
  /** The select's option when it says more than the chip (Review's "Arabisch (versteckt) – 3 warten"). */
  option?: string;
  /** The page in this language. */
  href: string;
}

/** The no-JavaScript form of the select: where "Show" sends it (GET; the current page without), and the filters it keeps. */
export interface PickerFallback {
  action?: string;
  /** The select's field (default "lang"). */
  name?: string;
  /** Hidden inputs for the filters the page keeps when its language changes. */
  keep?: ReactNode;
}

/** A name that stays on one line (cut with "…" where it can't). */
const ONE_LINE = { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const FIGURE_CURRENT = { lineHeight: "20px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/**
 * The store's languages for the picker in Content's order (visible ones first, each group by its name in the
 * interface language) and words (a hidden one is "Arabisch (versteckt)" for screen readers).
 */
export function pickerLanguages<T extends { locale: string; name: string; published: boolean }>(
  i18n: I18n,
  languages: readonly T[],
  {
    href,
    country,
    figure,
  }: {
    href: (language: T) => string;
    country: (language: T) => string | null;
    figure?: (language: T) => string | null;
  },
): PickerLanguage[] {
  return chipOrder(i18n, languages).map((l) => {
    const name = chipName(i18n, l);
    return {
      value: l.locale,
      locale: l.locale,
      country: country(l),
      name,
      hidden: !l.published,
      figure: figure ? figure(l) : null,
      label: l.published ? name : i18n.t("resources.hiddenLanguage", { language: name }),
      href: href(l),
    };
  });
}

/** A chip's flag, name (semibold on the current one), "hidden" under it, and its figure. */
function ChipBody({ language, current, i18n }: { language: PickerLanguage; current: boolean; i18n: I18n }) {
  const figure = language.figure ?? null;
  const columns = [language.locale ? "auto" : null, "minmax(0, 1fr)", figure !== null ? "auto" : null].filter(Boolean).join(" ");
  return (
    <s-grid gridTemplateColumns={columns} gap="small-200" alignItems="center">
      {language.locale ? <Flag country={language.country} fallback={language.locale} size={20} /> : null}
      <s-stack direction="block">
        <span style={ONE_LINE}>{current ? <Strong>{language.name}</Strong> : <s-text>{language.name}</s-text>}</span>
        {language.hidden ? (
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-400" alignItems="center">
            <s-icon type="hide" size="small" color="subdued" />
            <span style={ONE_LINE}>
              <s-text color="subdued">{i18n.t("content.language.hidden")}</s-text>
            </span>
          </s-grid>
        ) : null}
      </s-stack>
      {figure === null ? null : current ? (
        <span className="lv-strong" style={FIGURE_CURRENT}>
          {figure}
        </span>
      ) : (
        <s-text color="subdued" fontVariantNumeric="tabular-nums">
          {figure}
        </s-text>
      )}
    </s-grid>
  );
}

/** A swiped row starts at its current chip, so the language shown is in view (no page scroll). */
function revealCurrent(row: HTMLElement | null) {
  const chosen = row?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!row || !chosen) return;
  const from = row.getBoundingClientRect();
  const box = chosen.getBoundingClientRect();
  if (!box.width || !from.width) return;
  if (box.left < from.left || box.right > from.right) row.scrollLeft += box.left - from.left - 16;
}

/**
 * The chips (up to MAX_CHIPS) or the select (more). `label` names the select and, with `lead`, stands before
 * the chips ("Language", "Translate into"); `navLabel` names the whole picker for screen readers. `swipe`:
 * one row that scrolls sideways and starts at the current chip (a phone's), instead of rows that wrap.
 * `kind` overrides the count's choice (a page that counts an "All" entry apart). `fallback`: the select's
 * form without JavaScript; null where no GET form can open a language (its code is in the address's path).
 */
export function LanguagePicker({
  languages,
  current,
  i18n,
  label,
  navLabel,
  lead = false,
  swipe = false,
  kind,
  fallback = {},
}: {
  languages: readonly PickerLanguage[];
  /** The value of the language shown. */
  current: string;
  i18n: I18n;
  label: string;
  navLabel: string;
  lead?: boolean;
  swipe?: boolean;
  kind?: "chips" | "select";
  fallback?: PickerFallback | null;
}) {
  const navigate = useNavigate();
  const row = useRef<HTMLUListElement>(null);
  // A pick sends one navigation (the select reports it as input and as change).
  const sent = useRef<string | null>(null);
  useEffect(() => {
    sent.current = null;
    if (swipe) revealCurrent(row.current);
  }, [swipe, current]);
  const shows = kind ?? switcherKind(languages.length);

  if (shows === "select") {
    const pick = (value: string) => {
      const to = languages.find((l) => l.value === value);
      if (!to || value === current || value === sent.current) return;
      sent.current = value;
      void navigate(to.href);
    };
    // The select as wide as a chip row's label and two chips (at most 360 px, the full width of a phone); "Show" beside it.
    const select = (
      <s-grid gridTemplateColumns="minmax(0, 360px) auto" gap="small-200" alignItems="end">
        <s-select
          name={fallback?.name ?? "lang"}
          label={label}
          value={current}
          onInput={(e) => pick(e.currentTarget.value)}
          onChange={(e) => pick(e.currentTarget.value)}
        >
          {languages.map((l) => (
            <s-option key={l.value} value={l.value}>
              {l.option ?? l.label}
            </s-option>
          ))}
        </s-select>
        {fallback ? (
          <noscript>
            <Button type="submit">{i18n.t("content.language.show")}</Button>
          </noscript>
        ) : null}
      </s-grid>
    );
    return (
      <nav aria-label={navLabel}>
        {fallback ? (
          <Form method="get" action={fallback.action}>
            {fallback.keep}
            {select}
          </Form>
        ) : (
          select
        )}
      </nav>
    );
  }

  const chips = (
    <ul ref={row} className={swipe ? "lv-langs lv-langs--swipe" : "lv-langs"}>
      {languages.map((l) => (
        <li key={l.value} className="lv-langs__item">
          {l.value === current ? (
            <span className="lv-lang" aria-current="page">
              <ChipBody language={l} current i18n={i18n} />
            </span>
          ) : (
            // The link's own text is its name for screen readers; the words inside are hidden from them (nothing read twice).
            <Link className="lv-lang" to={l.href}>
              <span className="lv-sr">{l.label}</span>
              <span aria-hidden="true">
                <ChipBody language={l} current={false} i18n={i18n} />
              </span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <nav aria-label={navLabel}>
      {lead ? (
        <s-grid gridTemplateColumns="@container (inline-size > 640px) auto 1fr, 1fr" gap="small-200 base" alignItems="center">
          <Strong>{label}</Strong>
          {chips}
        </s-grid>
      ) : (
        chips
      )}
    </nav>
  );
}
