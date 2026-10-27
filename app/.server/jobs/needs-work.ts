import type { TranslatableResourceData } from "../shopify/translations-api";
import {
  isProtectedTranslation,
  revisionKey,
  type LatestRevisions,
} from "../translation/revisions";
import { isMachineTranslatable } from "../translation/translate-fields";

export interface WorkOptions {
  /** Latest Linguva revision per field (from latestRevisions). */
  latest?: LatestRevisions;
  /** The merchant explicitly allowed replacing protected translations. */
  overwriteProtected?: boolean;
  /** Fields that already have a pending draft, mapped to its source digest. */
  pendingDrafts?: ReadonlyMap<string, string>;
}

/**
 * Decides which fields a bulk job translates: machine-translatable, with a
 * non-empty source, and either no translation yet or an outdated one.
 *
 * - Current translations are never touched.
 * - Outdated translations a person wrote or approved, or that Linguva didn't
 *   write, are protected unless the merchant explicitly allowed overwriting.
 * - Fields with a pending draft for the same source are left for review.
 */
export function planResourceWork(resource: TranslatableResourceData, options: WorkOptions = {}) {
  const translations = new Map(resource.translations.map((t) => [t.key, t]));
  const fields: TranslatableResourceData["content"] = [];
  const protectedKeys: string[] = [];

  for (const field of resource.content) {
    if (!field.value || !field.value.trim() || !field.digest) continue;
    if (!isMachineTranslatable(field)) continue;
    const existing = translations.get(field.key);
    const hasValue = Boolean(existing?.value && existing.value.trim());
    if (hasValue && !existing!.outdated) continue;
    if (options.pendingDrafts?.get(`${resource.resourceId}|${field.key}`) === field.digest) continue;
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

/** Fields to translate with default (safe) options. */
export function fieldsNeedingTranslation(resource: TranslatableResourceData, options: WorkOptions = {}) {
  return planResourceWork(resource, options).fields;
}
