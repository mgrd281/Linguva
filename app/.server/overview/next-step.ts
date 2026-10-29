/**
 * The one thing the Overview asks the merchant to do next (pure). The first
 * step that applies wins; a step that can't be done here is never offered
 * (no measuring without background jobs, no "add a language" when Shopify's
 * limit is reached). The order is a product decision and lives only here.
 */
import { LOW_COVERAGE_PERCENT, type CountryCoverage, type MissingReason } from "../../lib/country-coverage";
import { coveragePercent } from "../../lib/coverage-rules";

export type NextStep =
  | { id: "add-language" }
  | { id: "measure" }
  | { id: "review"; count: number }
  | { id: "consent" }
  | { id: "first-translation"; href: string }
  | { id: "publish-language" }
  | { id: "translate"; locale: string; name: string | null; complete: number; total: number }
  | {
      id: "countries";
      reason: MissingReason;
      /** The languages behind the reason, most countries first. */
      locales: Array<{ locale: string; name: string | null; countries: number }>;
      /** Countries without one of their languages. */
      countries: number;
      /** Languages not added to the store (all reasons), and free places under Shopify's limit. */
      notAdded: number;
      free: number;
    }
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
  /** Per target language; measured rows carry their counts. */
  progress: ReadonlyArray<{ locale: string; name: string | null; published: boolean; measured: boolean; complete: number; total: number }>;
  /** Countries of the active markets, or null when unknown (no access, error). */
  countries: { rows: readonly CountryCoverage[]; missing: ReadonlyArray<{ locale: string; reason: MissingReason; countries: readonly CountryCoverage[] }> } | null;
  /** Languages the store can still add (Shopify allows MAX_ENABLED_LOCALES). */
  remainingLocales: number;
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
  const affected = countries.rows.filter((c) => c.status === "missing" || c.status === "partial").length;
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
      countries: affected,
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
  if (input.aiAvailable && !input.consent) return { id: "consent" };
  if (!input.firstTranslation.done) return { id: "first-translation", href: input.firstTranslation.href };
  if (!input.targets.some((t) => t.published)) return { id: "publish-language" };
  const urgent = lowest(input, LOW_COVERAGE_PERCENT);
  if (urgent) return urgent;
  const countries = countriesStep(input);
  if (countries) return countries;
  const rest = lowest(input, 100);
  if (rest) return rest;
  return measured.size > 0 ? { id: "done" } : null;
}
