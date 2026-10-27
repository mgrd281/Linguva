import type { TranslatableResourceData } from "../shopify/translations-api";
import { isMachineTranslatable } from "../translation/translate-fields";

/**
 * Fields a bulk job should translate: machine-translatable, non-empty source,
 * and either no translation yet or an outdated one. Current translations
 * (including manual edits) are never overwritten.
 */
export function fieldsNeedingTranslation(resource: TranslatableResourceData) {
  const translations = new Map(resource.translations.map((t) => [t.key, t]));
  return resource.content.filter((field) => {
    if (!field.value || !field.value.trim() || !field.digest) return false;
    if (!isMachineTranslatable(field)) return false;
    const existing = translations.get(field.key);
    return !existing || !existing.value || !existing.value.trim() || existing.outdated;
  });
}
