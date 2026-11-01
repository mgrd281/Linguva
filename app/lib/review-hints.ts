/**
 * Review's quality hints, calm and specific: "Hinweis: Zahl geändert
 * (12 → 6)" with the numbers marked in both texts, and a text the merchant
 * edits checked again in the browser for what the browser can check
 * exactly like the server (numbers, Google lengths), so a fixed hint goes
 * away. The badge holds only Linguva's words and numbers; a word of the
 * merchant (a glossary term, a forbidden word, the form of address found)
 * is returned apart, to follow the badge as text. Pure; tested in
 * tests/unit/review-hints.test.ts.
 */
import type { MessageKey } from "../i18n/i18n";
import { digitRuns, normalizeDigits } from "./digits";
import { checkSeoField, plainText } from "./seo";

export interface ReviewIssue {
  code: string;
  severity: "warning" | "error";
  detail: string | null;
}

export interface Hint {
  code: string;
  /** The badge's text after "Hinweis:"; null: the check's general name (issueName). */
  key: MessageKey | null;
  vars: Record<string, string | number>;
  /** The merchant's own word the hint is about, shown quoted after the badge. */
  word: string | null;
}

/** Codes the browser checks again while the merchant edits a text. */
export const LIVE_CODES: ReadonlySet<string> = new Set(["NUMBERS_CHANGED", "SEO_TOO_LONG", "SEO_TOO_SHORT", "SEO_SAME_AS_SOURCE"]);

/** The stored issues of a draft, as a list of known shape (anything else is dropped). */
export function readIssues(value: unknown): ReviewIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ReviewIssue[] => {
    if (!item || typeof item !== "object") return [];
    const { code, severity, detail } = item as { code?: unknown; severity?: unknown; detail?: unknown };
    if (typeof code !== "string" || !code) return [];
    return [{ code, severity: severity === "error" ? "error" : "warning", detail: typeof detail === "string" && detail ? detail : null }];
  });
}

/** "source [12, 24] target [24, 6]" (validate.ts) → both lists; null without a readable detail. */
export function parseNumbersDetail(detail: string | null): { source: string[]; target: string[] } | null {
  const match = detail ? /^source \[([^\]]*)\] target \[([^\]]*)\]$/.exec(detail.trim()) : null;
  if (!match) return null;
  const list = (text: string) =>
    text
      .split(",")
      .map((n) => n.trim())
      .filter((n) => /^\d+$/.test(n));
  return { source: list(match[1]!), target: list(match[2]!) };
}

/** What changed between two lists of numbers, counting repeats (a multiset difference). */
export function numberChange(source: readonly string[], target: readonly string[]): { removed: string[]; added: string[] } {
  const left = new Map<string, number>();
  for (const n of target) left.set(n, (left.get(n) ?? 0) + 1);
  const removed: string[] = [];
  for (const n of source) {
    const count = left.get(n) ?? 0;
    if (count > 0) left.set(n, count - 1);
    else removed.push(n);
  }
  const used = new Map<string, number>();
  for (const n of source) used.set(n, (used.get(n) ?? 0) + 1);
  const added: string[] = [];
  for (const n of target) {
    const count = used.get(n) ?? 0;
    if (count > 0) used.set(n, count - 1);
    else added.push(n);
  }
  // In reading order of the numbers themselves (12 before 30).
  const byValue = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return { removed: removed.sort(byValue), added: added.sort(byValue) };
}

const SIMPLE: Readonly<Record<string, MessageKey>> = {
  FORBIDDEN_TERM: "review.hint.FORBIDDEN_TERM",
  PREFERRED_TERM_MISSING: "review.hint.PREFERRED_TERM_MISSING",
  UNTRANSLATED: "review.hint.UNTRANSLATED",
  WRONG_SCRIPT: "review.hint.WRONG_SCRIPT",
  FORMALITY_MISMATCH: "review.hint.FORMALITY_MISMATCH",
  FORMALITY_NOT_APPLIED: "review.hint.FORMALITY_NOT_APPLIED",
  SPACING_CHANGED: "review.hint.SPACING_CHANGED",
  SEO_SAME_AS_SOURCE: "review.hint.SEO_SAME_AS_SOURCE",
  EMPTY_TRANSLATION: "review.hint.EMPTY_TRANSLATION",
};

/** "64/60" → [64, 60]. */
function fraction(detail: string | null): [number, number] | null {
  const match = detail ? /^(\d+)\/(\d+)$/.exec(detail.trim()) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The merchant's word of a hint: the forbidden word, the preferred glossary word, the form of address found. */
function wordOf(issue: ReviewIssue): string | null {
  const detail = issue.detail?.trim();
  if (!detail) return null;
  if (issue.code === "FORBIDDEN_TERM" || issue.code === "FORMALITY_MISMATCH") return detail;
  if (issue.code === "PREFERRED_TERM_MISSING") {
    const arrow = detail.lastIndexOf("→");
    return arrow >= 0 ? detail.slice(arrow + 1).trim() || null : null;
  }
  return null;
}

/** One issue as the badge says it ("Zahl geändert (12 → 6)"), plus the merchant's word to show after the badge. */
export function hintText(issue: ReviewIssue): Hint {
  const base = { code: issue.code, vars: {}, word: wordOf(issue) };
  switch (issue.code) {
    case "NUMBERS_CHANGED": {
      const numbers = parseNumbersDetail(issue.detail);
      const change = numbers ? numberChange(numbers.source, numbers.target) : null;
      if (!change || (!change.removed.length && !change.added.length)) return { ...base, key: "review.hint.NUMBERS_PLAIN" };
      if (!change.added.length) return { ...base, key: "review.hint.NUMBERS_REMOVED", vars: { count: change.removed.length, numbers: change.removed.join(", ") } };
      if (!change.removed.length) return { ...base, key: "review.hint.NUMBERS_ADDED", vars: { count: change.added.length, numbers: change.added.join(", ") } };
      return {
        ...base,
        key: "review.hint.NUMBERS_CHANGED",
        vars: { count: Math.max(change.removed.length, change.added.length), from: change.removed.join(", "), to: change.added.join(", ") },
      };
    }
    case "LENGTH_RATIO": {
      const ratio = Number(issue.detail);
      if (!issue.detail || !Number.isFinite(ratio) || ratio === 1) return { ...base, key: null };
      return { ...base, key: ratio < 1 ? "review.hint.LENGTH_SHORT" : "review.hint.LENGTH_LONG" };
    }
    case "SEO_TOO_LONG": {
      const values = fraction(issue.detail);
      return values ? { ...base, key: "review.hint.SEO_TOO_LONG", vars: { width: values[0], max: values[1] } } : { ...base, key: null };
    }
    case "SEO_TOO_SHORT": {
      const values = fraction(issue.detail);
      return values ? { ...base, key: "review.hint.SEO_TOO_SHORT", vars: { width: values[0], min: values[1] } } : { ...base, key: null };
    }
    default:
      return { ...base, key: SIMPLE[issue.code] ?? null };
  }
}

/** The numbers to mark: those missing from the translation in the original, those new in it in the translation. */
export function numberMarks(issues: readonly ReviewIssue[]): { source: string[]; target: string[] } {
  const issue = issues.find((i) => i.code === "NUMBERS_CHANGED");
  const numbers = issue ? parseNumbersDetail(issue.detail) : null;
  if (!numbers) return { source: [], target: [] };
  const change = numberChange(numbers.source, numbers.target);
  return { source: change.removed, target: change.added };
}

const DIGITS = /[0-9٠-٩۰-۹]+/g;
const asNumber = (run: string) => normalizeDigits(run).replace(/^0+(?=\d)/, "");

/** Marks each listed number once per time it is listed (the first occurrences), as validate.ts reads numbers. */
function marker(numbers: readonly string[]) {
  const left = new Map<string, number>();
  for (const n of numbers) left.set(n, (left.get(n) ?? 0) + 1);
  return (run: string) => {
    const n = asNumber(run);
    const count = left.get(n) ?? 0;
    if (count <= 0) return false;
    left.set(n, count - 1);
    return true;
  };
}

/** Plain text in parts, the listed numbers marked: shown as text with <mark> around them. */
export function highlightNumbers(text: string, numbers: readonly string[]): Array<{ text: string; mark: boolean }> {
  if (!numbers.length) return [{ text, mark: false }];
  const mark = marker(numbers);
  const parts: Array<{ text: string; mark: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(DIGITS)) {
    if (!mark(match[0])) continue;
    if (match.index! > last) parts.push({ text: text.slice(last, match.index), mark: false });
    parts.push({ text: match[0], mark: true });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts.length ? parts : [{ text, mark: false }];
}

// Tags and character references stay as they are: numbers are marked in text only.
const MARKUP = /(<[^>]*>|&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/;

/** Sanitised HTML with the listed numbers in <mark>, changing text only (never tags, attributes or entities). */
export function markNumbersInHtml(html: string, numbers: readonly string[]): string {
  if (!numbers.length) return html;
  const mark = marker(numbers);
  return html
    .split(MARKUP)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(DIGITS, (run) => (mark(run) ? `<mark>${run}</mark>` : run))))
    .join("");
}

/**
 * A draft's issues for the text as the merchant edited it: numbers and
 * Google lengths checked again (as the server does: validate.ts on plain
 * text, seo.ts), every other check as stored. An empty text gets no number
 * hint: it can't be approved at all.
 */
export function liveIssues(input: { key: string; source: string; value: string; stored: readonly ReviewIssue[] }): ReviewIssue[] {
  const kept = input.stored.filter((issue) => !LIVE_CODES.has(issue.code));
  const live: ReviewIssue[] = [];
  if (input.value.trim()) {
    const source = digitRuns(plainText(input.source));
    const target = digitRuns(plainText(input.value));
    if (source.join(",") !== target.join(",")) {
      const severity = input.stored.find((issue) => issue.code === "NUMBERS_CHANGED")?.severity ?? "warning";
      live.push({ code: "NUMBERS_CHANGED", severity, detail: `source [${source.join(", ")}] target [${target.join(", ")}]` });
    }
  }
  for (const issue of checkSeoField(input.key, input.source, input.value)) live.push({ code: issue.code, severity: "warning", detail: issue.detail ?? null });
  return [...live, ...kept];
}
