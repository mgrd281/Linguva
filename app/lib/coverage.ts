/** Translation coverage of one resource for one locale. */
export function summarizeCoverage(
  content: ReadonlyArray<{ key: string; value: string | null }>,
  translations: ReadonlyArray<{ key: string; value: string | null; outdated: boolean }>,
) {
  const sourceKeys = new Set(content.filter((c) => c.value && c.value.trim()).map((c) => c.key));
  const translated = translations.filter((t) => sourceKeys.has(t.key) && t.value && t.value.trim());
  return {
    total: sourceKeys.size,
    translated: translated.filter((t) => !t.outdated).length,
    outdated: translated.filter((t) => t.outdated).length,
  };
}
