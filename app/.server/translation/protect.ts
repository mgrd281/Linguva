/**
 * Finds spans of plain text that must never be translated: template syntax,
 * placeholders, URLs, e-mail addresses, merchant-protected terms and
 * merchant-defined patterns (for example SKUs).
 */

export interface ProtectOptions {
  /** Terms copied verbatim (glossary DO_NOT_TRANSLATE rules, brand names). */
  protectedTerms?: ReadonlyArray<{ term: string; caseSensitive?: boolean }>;
  /**
   * Terms replaced by a fixed translation (glossary PREFERRED rules). The
   * provider only sees an opaque code, so it can't alter the wording.
   */
  replacements?: ReadonlyArray<{ term: string; caseSensitive?: boolean; value: string }>;
  /** Extra patterns, for example SKU formats. Must not be sticky/global. */
  patterns?: ReadonlyArray<RegExp>;
}

export interface ProtectedSpan {
  start: number;
  end: number;
  value: string;
  /** What the span renders as in the translation (defaults to `value`). */
  replacement?: string;
}

const BUILT_IN: ReadonlyArray<RegExp> = [
  /\{\{[\s\S]*?\}\}/, // Liquid output
  /\{%[\s\S]*?%\}/, // Liquid tags
  /\{[A-Za-z_][A-Za-z0-9_.-]*\}/, // {name} placeholders
  /%\{[A-Za-z_][A-Za-z0-9_]*\}/, // %{name}
  /%(?:\d+\$)?[sdif]/, // printf-style
  /\[\[[^\]\r\n]+\]\]/, // [[token]]
  /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/i, // URLs
  /\bwww\.[^\s<>"']+[^\s<>"'.,;:!?)\]]/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // e-mail
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string, caseSensitive: boolean): RegExp {
  // Unicode-aware word boundaries so "Pro" doesn't match inside "Product".
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
    caseSensitive ? "u" : "iu",
  );
}

function allMatches(text: string, pattern: RegExp): ProtectedSpan[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  const spans: ProtectedSpan[] = [];
  for (const match of text.matchAll(global)) {
    if (match[0].length === 0) continue;
    spans.push({
      start: match.index!,
      end: match.index! + match[0].length,
      value: match[0],
    });
  }
  return spans;
}

/** Returns non-overlapping protected spans, earliest and longest first. */
export function findProtectedSpans(
  text: string,
  options: ProtectOptions = {},
): ProtectedSpan[] {
  const patterns = [
    ...BUILT_IN,
    ...(options.patterns ?? []),
    ...(options.protectedTerms ?? [])
      .filter((t) => t.term.trim().length > 0)
      .map((t) => termPattern(t.term, t.caseSensitive ?? true)),
  ];
  const replacementSpans = (options.replacements ?? [])
    .filter((r) => r.term.trim().length > 0)
    .flatMap((r) =>
      allMatches(text, termPattern(r.term, r.caseSensitive ?? false)).map((span) => ({
        ...span,
        replacement: r.value,
      })),
    );
  // Longest match wins at the same position, so "KARINEX Pro" beats "Pro".
  const candidates = [...patterns.flatMap((p) => allMatches(text, p)), ...replacementSpans]
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const result: ProtectedSpan[] = [];
  let cursor = 0;
  for (const span of candidates) {
    if (span.start < cursor) continue;
    result.push(span);
    cursor = span.end;
  }
  return result;
}
