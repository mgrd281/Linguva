import type { TranslationProvider } from "../providers/types";
import {
  segmentHtml,
  segmentPlainText,
  type SegmentedDocument,
} from "./html-segmenter";
import type { ProtectOptions } from "./protect";
import { markupToPlainText, SegmentStructureError } from "./segment-markup";
import {
  hasBlockingIssue,
  validateTranslation,
  type GlossaryRule,
  type ValidationIssue,
} from "./validate";

export interface SourceField {
  key: string;
  value: string | null;
  type: string;
}

export type FieldOutcome =
  | { key: string; status: "translated"; value: string; issues: ValidationIssue[] }
  | { key: string; status: "rejected"; reason: string; issues: ValidationIssue[] }
  | { key: string; status: "skipped"; reason: "EMPTY" | "NOT_TRANSLATABLE" | "MANUAL_ONLY" };

// LocalizableContentType values handled by the engine.
const HTML_TYPES = new Set(["HTML", "INLINE_RICH_TEXT"]);
const PLAIN_TYPES = new Set(["SINGLE_LINE_TEXT_FIELD", "MULTI_LINE_TEXT_FIELD", "STRING"]);
// URL handles change storefront URLs and redirects; only merchants set them.
const MANUAL_ONLY_KEYS = new Set(["handle"]);

export function isMachineTranslatable(field: SourceField): boolean {
  return (
    !MANUAL_ONLY_KEYS.has(field.key) &&
    (HTML_TYPES.has(field.type) || PLAIN_TYPES.has(field.type))
  );
}

function segment(field: SourceField, protect: ProtectOptions): SegmentedDocument {
  return HTML_TYPES.has(field.type)
    ? segmentHtml(field.value ?? "", protect)
    : segmentPlainText(field.value ?? "", protect);
}

/** Characters that a translation of these fields would send to a provider. */
export function estimateCharacters(fields: readonly SourceField[], protect: ProtectOptions = {}) {
  return fields
    .filter((f) => f.value && isMachineTranslatable(f))
    .flatMap((f) => segment(f, protect).segments)
    .reduce((sum, s) => sum + s.source.length, 0);
}

export interface TranslateFieldsInput {
  provider: TranslationProvider;
  fields: readonly SourceField[];
  sourceLocale: string;
  targetLocale: string;
  protect?: ProtectOptions;
  glossary?: readonly GlossaryRule[];
  context?: string;
  signal?: AbortSignal;
}

/**
 * Translates resource fields in one provider round-trip and validates each
 * result. A field is only "translated" if its structure is intact and no
 * blocking issue was found; otherwise it is "rejected" and must not be
 * published.
 */
export async function translateFields(input: TranslateFieldsInput) {
  const protect = input.protect ?? {};
  const outcomes: FieldOutcome[] = [];
  const work: Array<{ field: SourceField; doc: SegmentedDocument }> = [];

  for (const field of input.fields) {
    if (!field.value || !field.value.trim()) {
      outcomes.push({ key: field.key, status: "skipped", reason: "EMPTY" });
    } else if (MANUAL_ONLY_KEYS.has(field.key)) {
      outcomes.push({ key: field.key, status: "skipped", reason: "MANUAL_ONLY" });
    } else if (!isMachineTranslatable(field)) {
      outcomes.push({ key: field.key, status: "skipped", reason: "NOT_TRANSLATABLE" });
    } else {
      const doc = segment(field, protect);
      if (doc.segments.length === 0) {
        outcomes.push({ key: field.key, status: "skipped", reason: "NOT_TRANSLATABLE" });
      } else {
        work.push({ field, doc });
      }
    }
  }

  const sources = work.flatMap((w) => w.doc.segments.map((s) => s.source));
  if (sources.length === 0) return { outcomes, billedCharacters: 0, provider: input.provider.id };

  const result = await input.provider.translate(
    {
      segments: sources,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      context: input.context,
    },
    input.signal,
  );

  let cursor = 0;
  for (const { field, doc } of work) {
    const targets = new Map<string, string>();
    const issues: ValidationIssue[] = [];
    let structureError: string | null = null;

    for (const seg of doc.segments) {
      const target = result.translations[cursor++] ?? "";
      targets.set(seg.id, target);
      try {
        issues.push(
          ...validateTranslation({
            source: seg.text,
            target: markupToPlainText(target),
            glossary: input.glossary,
          }),
        );
      } catch (error) {
        if (!(error instanceof SegmentStructureError)) throw error;
        structureError = error.code;
      }
    }

    if (!structureError) {
      try {
        const value = doc.render(targets);
        if (!hasBlockingIssue(issues)) {
          outcomes.push({ key: field.key, status: "translated", value, issues });
          continue;
        }
      } catch (error) {
        if (!(error instanceof SegmentStructureError)) throw error;
        structureError = error.code;
      }
    }
    outcomes.push({
      key: field.key,
      status: "rejected",
      reason: structureError ?? "VALIDATION_FAILED",
      issues,
    });
  }

  const order = new Map(input.fields.map((f, i) => [f.key, i]));
  outcomes.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  return { outcomes, billedCharacters: result.billedCharacters, provider: result.provider };
}
