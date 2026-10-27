/**
 * Content checks applied to every machine translation after its inline
 * structure has been validated. Errors block publishing; warnings send the
 * translation to review.
 */

export type IssueCode =
  | "EMPTY_TRANSLATION"
  | "NUMBERS_CHANGED"
  | "FORBIDDEN_TERM"
  | "PREFERRED_TERM_MISSING"
  | "LENGTH_RATIO"
  | "UNTRANSLATED";

export interface ValidationIssue {
  code: IssueCode;
  severity: "error" | "warning";
  detail?: string;
}

export interface GlossaryRule {
  term: string;
  caseSensitive?: boolean;
  /** Required target wording when the term appears in the source. */
  preferred?: string;
  /** Wordings that must never appear in the target. */
  forbidden?: readonly string[];
}

export interface ValidationInput {
  /** Plain text of the source segment (inline codes removed). */
  source: string;
  /** Plain text of the translated segment (inline codes removed). */
  target: string;
  glossary?: readonly GlossaryRule[];
}

// Eastern Arabic (U+0660–0669) and Persian (U+06F0–06F9) digits count as the
// same numbers as ASCII digits.
function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Digit runs, sorted. "1.5 kg" and "1,5 kg" both yield ["1", "5"], so
 * locale-specific decimal separators are accepted.
 */
function digitRuns(text: string): string[] {
  return (normalizeDigits(text).match(/\d+/g) ?? [])
    .map((run) => run.replace(/^0+(?=\d)/, ""))
    .sort();
}

function containsTerm(text: string, term: string, caseSensitive: boolean): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    caseSensitive ? "u" : "iu",
  ).test(text);
}

export function validateTranslation(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const source = input.source.trim();
  const target = input.target.trim();

  if (source.length > 0 && target.length === 0) {
    return [{ code: "EMPTY_TRANSLATION", severity: "error" }];
  }

  const sourceNumbers = digitRuns(source);
  const targetNumbers = digitRuns(target);
  if (sourceNumbers.join(",") !== targetNumbers.join(",")) {
    issues.push({
      code: "NUMBERS_CHANGED",
      severity: "error",
      detail: `source [${sourceNumbers.join(", ")}] target [${targetNumbers.join(", ")}]`,
    });
  }

  for (const rule of input.glossary ?? []) {
    const caseSensitive = rule.caseSensitive ?? false;
    for (const forbidden of rule.forbidden ?? []) {
      if (containsTerm(target, forbidden, caseSensitive)) {
        issues.push({ code: "FORBIDDEN_TERM", severity: "error", detail: forbidden });
      }
    }
    if (
      rule.preferred &&
      containsTerm(source, rule.term, caseSensitive) &&
      !containsTerm(target, rule.preferred, caseSensitive)
    ) {
      issues.push({
        code: "PREFERRED_TERM_MISSING",
        severity: "warning",
        detail: `${rule.term} → ${rule.preferred}`,
      });
    }
  }

  // Length checks are only meaningful for longer text.
  if (source.length >= 40) {
    const ratio = target.length / source.length;
    if (ratio < 0.3 || ratio > 3.5) {
      issues.push({ code: "LENGTH_RATIO", severity: "warning", detail: ratio.toFixed(2) });
    }
    if (target === source) {
      issues.push({ code: "UNTRANSLATED", severity: "warning" });
    }
  }

  return issues;
}

export function hasBlockingIssue(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
