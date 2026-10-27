/**
 * Search engine listing rules shared by the server (validation of AI output,
 * coverage audit) and the editor (live counters, preview).
 *
 * Lengths are measured in "width units": one per grapheme, two for wide
 * scripts (CJK, fullwidth forms), because search engines truncate snippets
 * by pixel width. The limits are common guidance, not hard rules, so every
 * finding is a warning.
 */

export const SEO_TITLE_KEY = "meta_title";
export const SEO_DESCRIPTION_KEY = "meta_description";
export const SEO_KEYS: readonly string[] = [SEO_TITLE_KEY, SEO_DESCRIPTION_KEY];

export const SEO_LIMITS = {
  [SEO_TITLE_KEY]: { min: 15, max: 60 },
  [SEO_DESCRIPTION_KEY]: { min: 50, max: 155 },
} as const;

export type SeoIssueCode = "SEO_TOO_LONG" | "SEO_TOO_SHORT" | "SEO_SAME_AS_SOURCE";

export interface SeoIssue {
  code: SeoIssueCode;
  severity: "warning";
  detail?: string;
}

export const isSeoKey = (key: string) => SEO_KEYS.includes(key);

// Han, Hiragana, Katakana, Hangul, fullwidth forms.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Display width of text as search engines roughly measure it. */
export function seoWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text.trim().replace(/\s+/g, " "))) width += WIDE.test(g) ? 2 : 1;
  return width;
}

/** Warnings for a search engine title or description in the target language. */
export function checkSeoField(key: string, source: string, target: string): SeoIssue[] {
  if (!isSeoKey(key)) return [];
  const limits = SEO_LIMITS[key as keyof typeof SEO_LIMITS];
  const text = target.trim();
  if (!text) return [];
  const issues: SeoIssue[] = [];
  const width = seoWidth(text);
  if (width > limits.max) issues.push({ code: "SEO_TOO_LONG", severity: "warning", detail: `${width}/${limits.max}` });
  if (width < limits.min) issues.push({ code: "SEO_TOO_SHORT", severity: "warning", detail: `${width}/${limits.min}` });
  if (source.trim().length >= 20 && text === source.trim()) {
    issues.push({ code: "SEO_SAME_AS_SOURCE", severity: "warning" });
  }
  return issues;
}

/** Cuts text at the limit for a preview, as a search result would. */
export function truncateForPreview(text: string, max: number): string {
  let width = 0;
  let out = "";
  for (const g of graphemes(text.trim().replace(/\s+/g, " "))) {
    width += WIDE.test(g) ? 2 : 1;
    if (width > max) return `${out.trimEnd()}…`;
    out += g;
  }
  return out;
}

/** Plain text of HTML, for the description fallback in previews. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
