/**
 * What a Coverage row's "Translate" does, for its question first (as on the
 * language pages, OWNER_DECISIONS 6.9): the types its job reads (the
 * owner's own texts; a row of image descriptions or extra details starts
 * its owner's job with them, so their types count too) and how many of
 * their texts are open in a language. URL handles and the texts the
 * percentage leaves out never count, as on the language pages. Pure; tested
 * in tests/unit/coverage-bulk.test.ts.
 */
import { countsInHeadline, type FieldGroup } from "./coverage-rules";
import type { CountInput } from "./coverage-view";
import { ATTACHED, categoryOf, hasAttached } from "./language-categories";

/** The job a row starts (dashboard.ts bulkTargetOf): its owner type, with image descriptions and extra details or without. */
export interface BulkTarget {
  resourceType: string;
  includeAttached: boolean;
}

/** Texts to translate by state: missing, outdated and failed (a failed one is tried again). */
export interface OpenTexts {
  missing: number;
  outdated: number;
  failed: number;
}

/** The coverage types a row's job reads: the owner's, then its image descriptions' and extra details' when it includes them. */
export function bulkTypes(target: BulkTarget): string[] {
  if (!target.includeAttached) return [target.resourceType];
  const area = categoryOf(target.resourceType);
  if (!area || area === "theme" || area === "notifications" || !hasAttached(area)) return [target.resourceType];
  return [target.resourceType, ...ATTACHED[area].images, ...ATTACHED[area].customFields];
}

/** Open texts of these types in a language (`groups`: only these field groups, as a job for the texts for Google). */
export function openTexts(rows: readonly CountInput[], locale: string, types: readonly string[], groups?: readonly FieldGroup[] | null): OpenTexts {
  const open: OpenTexts = { missing: 0, outdated: 0, failed: 0 };
  for (const row of rows) {
    if (row.locale !== locale || !types.includes(row.resourceType) || !countsInHeadline(row.resourceType, row.fieldGroup)) continue;
    if (groups && !(groups as readonly string[]).includes(row.fieldGroup)) continue;
    if (row.state === "missing" || row.state === "outdated" || row.state === "failed") open[row.state] += row.count;
  }
  return open;
}

export function openTotal(open: OpenTexts): number {
  return open.missing + open.outdated + open.failed;
}
