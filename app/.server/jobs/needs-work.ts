import type { TranslatableResourceData } from "../shopify/translations-api";
import {
  isProtectedTranslation,
  revisionKey,
  type LatestRevisions,
} from "../translation/revisions";
import { isMachineTranslatable } from "../translation/translate-fields";
import { SEO_KEYS } from "../../lib/seo";

/** In `pendingDrafts`: a person's draft waits for review, whatever the source it was written for. */
export const ANY_SOURCE = "*";

export interface WorkOptions {
  /** Latest Linguva revision per field (from latestRevisions). */
  latest?: LatestRevisions;
  /** The merchant explicitly allowed replacing protected translations. */
  overwriteProtected?: boolean;
  /**
   * Fields with a draft that holds them, mapped to its source digest (or
   * ANY_SOURCE): waiting for review, rejected, or refused by the checks.
   */
  pendingDrafts?: ReadonlyMap<string, string>;
  /** Restricts the job to these keys (for example only search engine fields). */
  onlyKeys?: readonly string[];
}

/** Keys a job's field scope is limited to, or undefined for all fields. */
export function scopeKeys(scope: "ALL" | "SEO"): readonly string[] | undefined {
  return scope === "SEO" ? SEO_KEYS : undefined;
}

/**
 * Decides which fields a bulk job translates: machine-translatable, with a
 * non-empty source, and either no translation yet or an outdated one.
 *
 * - Current translations are never touched.
 * - Outdated translations a person wrote or approved, or that Linguva didn't
 *   write, are protected unless the merchant explicitly allowed overwriting.
 * - A translation the merchant removed on purpose stays removed (protected)
 *   until the original changes.
 * - Fields with a pending draft for the same source are left for review, as
 *   are those whose draft was rejected or failed the checks for that source,
 *   and those with a person's draft waiting for review.
 */
export function planResourceWork(resource: TranslatableResourceData, options: WorkOptions = {}) {
  const translations = new Map(resource.translations.map((t) => [t.key, t]));
  const fields: TranslatableResourceData["content"] = [];
  const protectedKeys: string[] = [];

  for (const field of resource.content) {
    if (!field.value || !field.value.trim() || !field.digest) continue;
    if (options.onlyKeys && !options.onlyKeys.includes(field.key)) continue;
    if (!isMachineTranslatable(field)) continue;
    const existing = translations.get(field.key);
    const hasValue = Boolean(existing?.value && existing.value.trim());
    if (hasValue && !existing!.outdated) continue;
    const held = options.pendingDrafts?.get(`${resource.resourceId}|${field.key}`);
    if (held === field.digest || held === ANY_SOURCE) continue;
    if (!hasValue && !options.overwriteProtected && removedOnPurpose(options.latest?.get(revisionKey(resource.resourceId, field.key)), field.digest)) {
      protectedKeys.push(field.key);
      continue;
    }
    if (
      hasValue &&
      !options.overwriteProtected &&
      isProtectedTranslation(existing!.value, options.latest?.get(revisionKey(resource.resourceId, field.key)))
    ) {
      protectedKeys.push(field.key);
      continue;
    }
    fields.push(field);
  }
  return { fields, protectedKeys };
}

/** The merchant removed this field's translation of the same original (history.ts records it). */
function removedOnPurpose(latest: { value: string; sourceDigest: string; origin: string } | undefined, digest: string): boolean {
  return Boolean(latest && latest.value === "" && latest.origin === "MANUAL" && latest.sourceDigest === digest);
}

/** Fields to translate with default (safe) options. */
export function fieldsNeedingTranslation(resource: TranslatableResourceData, options: WorkOptions = {}) {
  return planResourceWork(resource, options).fields;
}
