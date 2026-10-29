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
 * Languages whose figures are whole: read by the newest completed
 * measurement, with a scan state for every type the headline counts. A
 * language published since, one whose rows went with the language (removed,
 * or now the primary language), or a type the scan didn't have then has
 * none: its figures count nowhere until the next full scan.
 */
export function measuredLocales(
  lastCompleted: { locales: readonly string[] } | null,
  segments: ReadonlyArray<{ locale: string; resourceType: string }>,
  types: readonly string[],
): Set<string> {
  const counted = types.filter((t) => !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, t));
  const read = new Set(segments.map((s) => `${s.resourceType}|${s.locale}`));
  return new Set((lastCompleted?.locales ?? []).filter((locale) => counted.every((t) => read.has(`${t}|${locale}`))));
}

/**
 * Types the figures count that Linguva can't read (no access scope), among
 * the given languages, in the types' order. Nothing of them is checked, so
 * no figure may be called complete while one exists.
 */
export function unreadableTypes(
  segments: ReadonlyArray<{ locale: string; resourceType: string; status: string }>,
  options: { locales: readonly string[]; types: readonly string[] },
): string[] {
  const denied = new Set(segments.filter((s) => s.status === "DENIED" && options.locales.includes(s.locale)).map((s) => s.resourceType));
  return options.types.filter((t) => denied.has(t) && !Object.hasOwn(HEADLINE_EXCLUDED_TYPES, t));
}

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

/**
 * What the Coverage page says about a published language that isn't fully
 * read: scan, or, while a scan is under way, whether that scan reads it.
 */
export function unmeasuredMessage(locale: string, scan: { scanning: boolean; locales: readonly string[] }) {
  if (!scan.scanning) return "coverage.next.unmeasured" as const;
  return scan.locales.includes(locale) ? ("coverage.next.unmeasuredScanning" as const) : ("coverage.next.unmeasuredAfterScan" as const);
}

type SegmentRow = { locale: string; resourceType: string; status: string; ahead?: boolean };

export type CoverageNextStep<S extends SegmentRow> =
  | { kind: "review"; locale: string; count: number }
  | { kind: "failed" | "missing"; locale: string; type: string; count: number }
  | { kind: "unread"; segment: S; message: ReturnType<typeof unreadMessage> }
  | { kind: "unmeasured"; locale: string; message: ReturnType<typeof unmeasuredMessage> }
  | { kind: "denied"; types: string[] }
  | { kind: "scanning" };

/**
 * The Coverage page's next step: drafts to review, then failed fields, then
 * the biggest gap that counts. Without one, never "all done" over what isn't
 * known: content the last scan didn't finish reading, a published language
 * not fully read, types Linguva can't read, or a scan under way that may
 * still change the figures. Null: everything counted is translated and live.
 */
export function coverageNextStep<S extends SegmentRow>(input: {
  counts: readonly CountInput[];
  segments: readonly S[];
  /** The languages shown (the market filter applied), in the page's order. */
  targets: ReadonlyArray<{ locale: string; published: boolean }>;
  /** Fully measured languages (measuredLocales). */
  measured: ReadonlySet<string>;
  types: readonly string[];
  selected: string | null;
  /** A scan is under way (not stalled), reading these languages. */
  scan: { scanning: boolean; locales: readonly string[] };
}): CoverageNextStep<S> | null {
  const shown = input.targets.map((l) => l.locale);
  const sum = (locale: string, states: FieldState[]) =>
    input.counts.filter((c) => c.locale === locale && states.includes(c.state)).reduce((n, c) => n + c.count, 0);
  const drafts = shown.map((l) => ({ l, n: sum(l, ["review", "draft"]) })).sort((a, b) => b.n - a.n)[0];
  if (drafts && drafts.n > 0) return { kind: "review", locale: drafts.l, count: drafts.n };
  let best: { locale: string; type: string; n: number; state: "failed" | "missing" } | null = null;
  for (const state of ["failed", "missing"] as const) {
    const matches = (x: CountInput) => x.fieldGroup !== "url" && (state === "failed" ? x.state === "failed" : x.state === "missing" || x.state === "outdated");
    for (const c of input.counts) {
      if (!shown.includes(c.locale) || Object.hasOwn(HEADLINE_EXCLUDED_TYPES, c.resourceType) || !matches(c)) continue;
      const n = input.counts.filter((x) => x.locale === c.locale && x.resourceType === c.resourceType && matches(x)).reduce((s, x) => s + x.count, 0);
      if (!best || n > best.n) best = { locale: c.locale, type: c.resourceType, n, state };
    }
    if (best) break;
  }
  if (best) return { kind: best.state, locale: best.locale, type: best.type, count: best.n };
  // Content the last scan didn't finish reading may be untranslated.
  const unread = unreadSegment(input.segments, { locales: shown, types: input.types, selected: input.selected, scanning: input.scan.scanning });
  if (unread) return { kind: "unread", segment: unread, message: unreadMessage(unread, input.scan.scanning) };
  // So may a published language that isn't fully read (published since the scan, or being read for the first time).
  const unmeasured = input.targets
    .filter((l) => l.published && !input.measured.has(l.locale))
    .sort((a, b) => Number(b.locale === input.selected) - Number(a.locale === input.selected))[0];
  if (unmeasured) return { kind: "unmeasured", locale: unmeasured.locale, message: unmeasuredMessage(unmeasured.locale, input.scan) };
  // And content Linguva has no access to: it was never checked.
  const denied = unreadableTypes(input.segments, { locales: shown, types: input.types });
  if (denied.length) return { kind: "denied", types: denied };
  if (input.scan.scanning) return { kind: "scanning" };
  return null;
}
