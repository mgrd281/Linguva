import type { TranslatableResourceData } from "../shopify/translations-api";
import type { TranslationEdit } from "./product-translation-service";

type FormLike = Pick<FormData, "get">;

/**
 * Turns the editor form into edits. Only fields the merchant actually
 * changed are saved. An unchanged outdated translation is NOT re-saved
 * (that would mark it current for the new source without anyone checking
 * it) unless the merchant explicitly confirmed it with `confirm:<key>`.
 */
export function collectEditorEdits(resource: TranslatableResourceData, form: FormLike): TranslationEdit[] {
  const existing = new Map(resource.translations.map((t) => [t.key, t]));
  const edits: TranslationEdit[] = [];
  for (const field of resource.content) {
    const value = form.get(`value:${field.key}`);
    const digest = form.get(`digest:${field.key}`);
    if (typeof value !== "string" || typeof digest !== "string") continue;
    const current = existing.get(field.key);
    const currentValue = current?.value ?? "";
    if (!value.trim() && !currentValue) continue;
    if (value === currentValue) {
      const confirmed = form.get(`confirm:${field.key}`) === "on";
      if (!current?.outdated || !confirmed) continue;
    }
    // The translation the merchant saw: if someone saved another one since, the save is refused.
    const shown = form.get(`current:${field.key}`);
    edits.push({
      key: field.key,
      value,
      digest,
      ...(typeof shown === "string" && /^([0-9a-f]{64}|none)$/.test(shown) ? { expectedCurrent: shown } : {}),
      origin: form.get(`origin:${field.key}`) === "AI" ? "AI" : "MANUAL",
      provider: String(form.get("provider") ?? "") || null,
      // Publishing from the editor means the merchant reviewed it.
      approved: true,
    });
  }
  return edits;
}
