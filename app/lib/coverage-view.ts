/**
 * Aggregations of coverage counts for the dashboard and the Overview (pure,
 * shared by server and UI). Input rows: fields per language, content type,
 * field group and state (CoverageCount).
 */
import {
  addCounts,
  countsInHeadline,
  coveragePercent,
  emptyCounts,
  HEADLINE_EXCLUDED_TYPES,
  totalOf,
  type FieldState,
  type StateCounts,
} from "./coverage-rules";

export interface CountInput {
  locale: string;
  resourceType: string;
  fieldGroup: string;
  state: FieldState;
  count: number;
}

export interface Tally {
  counts: StateCounts;
  total: number;
  complete: number;
  percent: number | null;
}

function tally(counts: StateCounts): Tally {
  const total = totalOf(counts);
  return { counts, total, complete: counts.complete, percent: coveragePercent(counts.complete, total) };
}

function group<K extends string>(rows: readonly CountInput[], keyOf: (r: CountInput) => K | null): Map<K, Tally> {
  const acc = new Map<K, StateCounts>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const c = acc.get(key) ?? emptyCounts();
    c[r.state] += r.count;
    acc.set(key, c);
  }
  return new Map([...acc].map(([k, c]) => [k, tally(c)]));
}

/** The headline figure per language: counted types and field groups only (coverage-rules.ts). */
export function headlineByLocale(rows: readonly CountInput[]): Map<string, Tally> {
  return group(rows, (r) => (countsInHeadline(r.resourceType, r.fieldGroup) ? r.locale : null));
}

/** Per language and content type (all fields of the type, also those left out of the headline). */
export function byType(rows: readonly CountInput[], locale: string): Map<string, Tally> {
  return group(rows, (r) => (r.locale === locale ? r.resourceType : null));
}

/** Per language and field group across content types that count in the headline. */
export function byFieldGroup(rows: readonly CountInput[], locale: string): Map<string, Tally> {
  return group(rows, (r) => (r.locale === locale && !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, r.resourceType) ? r.fieldGroup : null));
}

/** Store-wide figure over the given (published) languages. */
export function storeWide(rows: readonly CountInput[], locales: readonly string[]): Tally {
  const set = new Set(locales);
  const sum = emptyCounts();
  for (const [locale, t] of headlineByLocale(rows)) if (set.has(locale)) addCounts(sum, t.counts);
  return tally(sum);
}

export { tally };

/**
 * The first type the last scan didn't finish reading, among the given
 * languages: skipped after errors (FAILED), or left half read by a scan that
 * stopped (SCANNING while none is under way). Types the figures don't count
 * aside. While a scan runs, one that needs another scan comes before one it
 * reads again by itself (ahead); then the selected language, then the
 * languages' and types' order.
 */
export function unreadSegment<S extends { locale: string; resourceType: string; status: string; ahead?: boolean }>(
  segments: readonly S[],
  options: { locales: readonly string[]; types: readonly string[]; selected: string | null; scanning: boolean },
): S | null {
  const rank = (s: S) => [
    options.scanning && s.ahead ? 1 : 0,
    s.locale === options.selected ? 0 : 1,
    options.locales.indexOf(s.locale),
    options.types.indexOf(s.resourceType),
  ];
  const unread = segments.filter(
    (s) =>
      options.locales.includes(s.locale) &&
      !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, s.resourceType) &&
      (s.status === "FAILED" || (s.status === "SCANNING" && !options.scanning)),
  );
  return (
    unread.sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || x[3]! - y[3]!;
    })[0] ?? null
  );
}

/**
 * What the Coverage page says about such a type: scan again. While a scan is
 * under way (its button disabled): it reads the type again if the type is
 * still ahead of it (ahead), else scan again once it's done (it skipped the
 * type itself, or doesn't cover the language).
 */
export function unreadMessage(segment: { ahead?: boolean }, scanning: boolean) {
  if (!scanning) return "coverage.next.unread" as const;
  return segment.ahead ? ("coverage.next.unreadScanning" as const) : ("coverage.next.unreadAfterScan" as const);
}
