/**
 * What Review ("Übersetzungen prüfen") shows in the browser after the
 * merchant acts on a page that doesn't reload itself: each text's outcome,
 * the counts on the tabs and chips reduced by the texts that left
 * "waiting", and the page's own addresses. Pure; the page component is
 * app/components/ReviewPage.tsx.
 */
import type { AreaKey } from "./review-areas";

/** What happened to a text the merchant approved or rejected (DraftOutcome of review/drafts.ts, plus rejected). */
export type ClientOutcome =
  | { id: string; status: "published" }
  | { id: string; status: "rejected" }
  | { id: string; status: "stale"; reason: "SOURCE_CHANGED" | "TRANSLATION_CHANGED" | "RESOURCE_GONE" }
  | { id: string; status: "failed"; reason: string; detail?: string }
  | { id: string; status: "changed" };

/** What the page's action returns. */
export type ReviewActionResult =
  | { kind: "approved"; published: number; stale: number; failed: number; changed: number; outcomes: ClientOutcome[] }
  | { kind: "rejected"; count: number; changed: number; outcomes: ClientOutcome[] }
  | { kind: "error" };

/** The text no longer waits: published, rejected, or retired as outdated. */
export function leftWaiting(outcome: ClientOutcome | undefined): boolean {
  return outcome?.status === "published" || outcome?.status === "rejected" || outcome?.status === "stale";
}

/** The row keeps saying why it wasn't published (outdated, kept, gone, failed, changed). */
export function isProblem(outcome: ClientOutcome | undefined): boolean {
  return outcome?.status === "stale" || outcome?.status === "failed" || outcome?.status === "changed";
}

/** A card is done once each of its texts is approved or rejected: it shows its header and one line. */
export function cardDone(outcomes: ReadonlyArray<ClientOutcome | undefined>): boolean {
  return outcomes.length > 0 && outcomes.every((o) => o?.status === "published" || o?.status === "rejected");
}

export interface ReviewQuery {
  locale: string | null;
  area: AreaKey | null;
  flagged: boolean;
  search: string | null;
  jobId: string | null;
  group: string | null;
}

/** Review's address for a filter (every change starts on the first page; `after` only for the next page). */
export function reviewHref(query: ReviewQuery, changes: Partial<ReviewQuery> & { after?: string | null } = {}): string {
  const q = { ...query, ...changes };
  const params = new URLSearchParams();
  if (q.locale) params.set("lang", q.locale);
  if (q.area) params.set("area", q.area);
  if (q.flagged) params.set("flagged", "1");
  if (q.search) params.set("q", q.search);
  if (q.jobId) params.set("job", q.jobId);
  if (q.group) params.set("group", q.group);
  if (changes.after) params.set("after", changes.after);
  const search = params.toString();
  return search ? `/app/review?${search}` : "/app/review";
}

export interface FacetDraft {
  locale: string;
  area: AreaKey;
  /** It had quality notes when the page loaded. */
  storedFlag: boolean;
  /** It has notes now (an edit can fix or add one); false once it left "waiting". */
  currentFlag: boolean;
  left: boolean;
}

export interface Facets {
  total: number;
  languages: Array<{ locale: string; count: number }>;
  areas: Array<{ area: AreaKey; count: number }>;
  flagged: number;
}

/**
 * The page's counts as the merchant decides: every text that left
 * "waiting" is taken off its language, its area (within the chosen
 * language) and "With notes"; a note fixed or added by an edit moves the
 * "With notes" count too.
 */
export function currentFacets(facets: Facets, drafts: readonly FacetDraft[], chosen: { locale: string | null; area: AreaKey | null }): Facets {
  const byLanguage = new Map<string, number>();
  const byArea = new Map<AreaKey, number>();
  let left = 0;
  let flagged = 0;
  for (const d of drafts) {
    const inLanguage = !chosen.locale || chosen.locale === d.locale;
    const inArea = inLanguage && (!chosen.area || chosen.area === d.area);
    if (d.left) {
      left++;
      byLanguage.set(d.locale, (byLanguage.get(d.locale) ?? 0) + 1);
      if (inLanguage) byArea.set(d.area, (byArea.get(d.area) ?? 0) + 1);
    }
    if (inArea) flagged += Number(d.currentFlag) - Number(d.storedFlag);
  }
  return {
    total: Math.max(0, facets.total - left),
    languages: facets.languages.map((l) => ({ locale: l.locale, count: Math.max(0, l.count - (byLanguage.get(l.locale) ?? 0)) })),
    areas: facets.areas.map((a) => ({ area: a.area, count: Math.max(0, a.count - (byArea.get(a.area) ?? 0)) })),
    flagged: Math.max(0, facets.flagged + flagged),
  };
}
