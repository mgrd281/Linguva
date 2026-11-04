import { isWebAddress } from "./editor-view";

/**
 * Translation coverage of one resource for one locale. A web address is optional and left out, as the
 * editor's count and the area lists leave it out (COVERAGE_RULES: URL handles), so a list row and the
 * editor it opens say the same.
 */
export function summarizeCoverage(
  content: ReadonlyArray<{ key: string; value: string | null }>,
  translations: ReadonlyArray<{ key: string; value: string | null; outdated: boolean }>,
) {
  const sourceKeys = new Set(content.filter((c) => c.value && c.value.trim() && !isWebAddress(c.key)).map((c) => c.key));
  const translated = translations.filter((t) => sourceKeys.has(t.key) && t.value && t.value.trim());
  return {
    total: sourceKeys.size,
    translated: translated.filter((t) => !t.outdated).length,
    outdated: translated.filter((t) => t.outdated).length,
  };
}
