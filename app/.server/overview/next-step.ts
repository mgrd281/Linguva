/**
 * The one thing the Overview asks the merchant to do next (pure). The first
 * step that applies wins; a step that can't be done here is never offered
 * (no measuring without background jobs, no "add a language" when Shopify's
 * limit is reached). The order is a product decision and lives only here.
 */
import { LOW_COVERAGE_PERCENT, type CountryCoverage, type MissingReason } from "../../lib/country-coverage";
import { coveragePercent, type StateCounts } from "../../lib/coverage-rules";

export type NextStep =
  | { id: "add-language" }
  | { id: "measure" }
  | { id: "review"; count: number }
  /** The Own key plan without a usable key: nothing translates with AI before one is added. */
  | { id: "own-key" }
  | { id: "consent" }
  | { id: "first-translation"; href: string }
  | { id: "publish-language" }
  | { id: "translate"; locale: string; name: string | null; complete: number; total: number }
  | {
      id: "countries";
      reason: MissingReason;
      /** The languages behind the reason, most countries first. */
      locales: Array<{ locale: string; name: string | null; countries: number }>;
      /** Countries this fix reaches (without one of their languages). */
      countries: number;
      /** Languages not added to the store (all reasons), and free places under Shopify's limit. */
      notAdded: number;
      free: number;
    }
  /** Everything else is done, but the last measurement couldn't read some content (of this language first). */
  | { id: "unread"; locale: string }
  /** Everything else is done, but Linguva has no access to some content types: they were never checked. */
  | { id: "access"; types: number; href: string | null }
  | { id: "done" };

export interface NextStepInput {
  targets: ReadonlyArray<{ locale: string; name: string | null; published: boolean }>;
  consent: boolean;
  firstTranslation: { done: boolean; href: string };
  pendingDrafts: number;
  aiAvailable: boolean;
  jobsAvailable: boolean;
  /** Languages of the newest completed measurement (empty: never measured). */
  measuredLocales: readonly string[];
  /** Per target language; measured rows carry their counts; partial: the measurement skipped some of its content. */
  progress: ReadonlyArray<{
    locale: string;
    name: string | null;
    published: boolean;
    measured: boolean;
    partial?: boolean;
    complete: number;
    total: number;
    /** Texts per state (measured languages; read by `attention`). */
    counts?: StateCounts | null;
  }>;
  /** Content types of the published languages Linguva can't read (no access scope), and where to allow it. */
  unreadable?: { types: number; href: string | null } | null;
  /** Countries of the active markets, or null when unknown (no access, error). */
  countries: { rows: readonly CountryCoverage[]; missing: ReadonlyArray<{ locale: string; reason: MissingReason; countries: readonly CountryCoverage[] }> } | null;
  /** Languages the store can still add (Shopify allows MAX_ENABLED_LOCALES). */
  remainingLocales: number;
  /** On the Own key plan without a usable key (absent on every other plan). */
  ownKeyMissing?: boolean;
}

/** Reasons in the order they're asked for: cheapest fix first. */
const REASONS: readonly MissingReason[] = ["not-in-market", "unpublished", "not-added"];

function lowest(input: NextStepInput, below: number) {
  const candidates = input.progress
    .filter((p) => p.published && p.measured && p.total > 0)
    .map((p) => ({ ...p, percent: coveragePercent(p.complete, p.total)! }))
    .filter((p) => p.percent < below)
    .sort((a, b) => a.percent - b.percent || a.locale.localeCompare(b.locale));
  const first = candidates[0];
  return first ? ({ id: "translate", locale: first.locale, name: first.name, complete: first.complete, total: first.total } as const) : null;
}

function countriesStep(input: NextStepInput): NextStep | null {
  const countries = input.countries;
  if (!countries || !countries.missing.length) return null;
  const notAdded = countries.missing.filter((m) => m.reason === "not-added").length;
  for (const reason of REASONS) {
    // Adding needs a free place under Shopify's limit.
    if (reason === "not-added" && input.remainingLocales <= 0) continue;
    const entries = countries.missing.filter((m) => m.reason === reason);
    if (!entries.length) continue;
    const names = new Map(input.targets.map((t) => [t.locale, t.name]));
    return {
      id: "countries",
      reason,
      locales: entries.map((m) => ({ locale: m.locale, name: names.get(m.locale) ?? null, countries: m.countries.length })),
      // The countries of this reason only: the card names them ("in the market of these countries").
      countries: new Set(entries.flatMap((m) => m.countries.map((c) => c.code))).size,
      notAdded,
      free: input.remainingLocales,
    };
  }
  return null;
}

export function nextStep(input: NextStepInput): NextStep | null {
  if (!input.targets.length) return { id: "add-language" };
  const measured = new Set(input.measuredLocales);
  const unmeasured = input.targets.some((t) => t.published && !measured.has(t.locale));
  if (input.jobsAvailable && (measured.size === 0 || unmeasured)) return { id: "measure" };
  if (input.pendingDrafts > 0) return { id: "review", count: input.pendingDrafts };
  if (input.ownKeyMissing) return { id: "own-key" };
  if (input.aiAvailable && !input.consent) return { id: "consent" };
  if (!input.firstTranslation.done) return { id: "first-translation", href: input.firstTranslation.href };
  if (!input.targets.some((t) => t.published)) return { id: "publish-language" };
  const urgent = lowest(input, LOW_COVERAGE_PERCENT);
  if (urgent) return urgent;
  const countries = countriesStep(input);
  if (countries) return countries;
  const rest = lowest(input, 100);
  if (rest) return rest;
  // Skipped content may be untranslated: never "all caught up" over it.
  const unread = input.progress.find((p) => p.published && p.partial);
  if (unread) return { id: "unread", locale: unread.locale };
  // Nor over content Linguva has no access to: it was never read.
  if (input.unreadable && input.unreadable.types > 0) return { id: "access", types: input.unreadable.types, href: input.unreadable.href };
  // Nor over a published language that was never measured (no background jobs to measure it).
  if (unmeasured) return null;
  return measured.size > 0 ? { id: "done" } : null;
}

/** What else needs the merchant besides the next step: texts in one state across the languages customers can choose, or countries without their language. */
export type Attention =
  | {
      id: "outdated" | "failed";
      count: number;
      /** The languages with such texts, most first. */
      locales: Array<{ locale: string; name: string | null; count: number }>;
    }
  | Extract<NextStep, { id: "countries" }>;

/**
 * Under the next step, in this order: outdated texts (customers still see
 * the old translation), failed ones, and countries without their language;
 * each once, and never what the next step already asks for.
 */
export function attention(input: NextStepInput, next: NextStep | null): Attention[] {
  const items: Attention[] = [];
  for (const state of ["outdated", "failed"] as const) {
    const locales = input.progress
      .filter((p) => p.published && p.measured && p.counts && p.counts[state] > 0)
      .map((p) => ({ locale: p.locale, name: p.name, count: p.counts![state] }))
      .sort((a, b) => b.count - a.count || a.locale.localeCompare(b.locale));
    if (locales.length) items.push({ id: state, count: locales.reduce((n, l) => n + l.count, 0), locales });
  }
  const countries = next?.id === "countries" ? null : countriesStep(input);
  if (countries?.id === "countries") items.push(countries);
  return items;
}
