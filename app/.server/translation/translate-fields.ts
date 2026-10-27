import type { TranslationProvider } from "../providers/types";
import type { SegmentPair } from "../memory/alignment";
import {
  segmentHtml,
  segmentPlainText,
  type SegmentedDocument,
} from "./html-segmenter";
import type { ProtectOptions } from "./protect";
import { markupToPlainText, SegmentStructureError } from "./segment-markup";
import { checkSeoField } from "../../lib/seo";
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
  | {
      key: string;
      status: "translated";
      value: string;
      issues: ValidationIssue[];
      /** Source/target segment pairs, for translation memory. */
      segmentPairs?: SegmentPair[];
      /** Segments of this field that came from translation memory. */
      fromMemory?: number;
    }
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

export function segmentField(field: SourceField, protect: ProtectOptions = {}): SegmentedDocument {
  return HTML_TYPES.has(field.type)
    ? segmentHtml(field.value ?? "", protect)
    : segmentPlainText(field.value ?? "", protect);
}

/** Characters that a translation of these fields would send to a provider. */
export function estimateCharacters(fields: readonly SourceField[], protect: ProtectOptions = {}) {
  return fields
    .filter((f) => f.value && isMachineTranslatable(f))
    .flatMap((f) => segmentField(f, protect).segments)
    .reduce((sum, s) => sum + s.source.length, 0);
}

/** Looks up exact translation-memory matches for segment sources. */
export interface MemoryLookup {
  lookup(sources: readonly string[]): Promise<Map<string, { target: string; id: string }>>;
}

export interface PreparedTranslation {
  outcomes: FieldOutcome[];
  work: Array<{ field: SourceField; doc: SegmentedDocument }>;
  fieldOrder: Map<string, number>;
  /** Targets already known from memory, by source segment. */
  fromMemory: Map<string, string>;
  /** Sources that render as-is (only protected spans and replacements). */
  fixed: Set<string>;
  memoryEntryIds: string[];
  /** Unique source segments that still need a provider. */
  pending: string[];
  /** Characters the provider would be sent. */
  providerChars: number;
  /** Characters saved by memory hits and de-duplication. */
  charsSaved: number;
}

/**
 * Segments the fields and resolves what translation memory already knows.
 * Identical segments are sent to the provider only once.
 */
export async function prepareTranslation(input: {
  fields: readonly SourceField[];
  protect?: ProtectOptions;
  memory?: MemoryLookup;
}): Promise<PreparedTranslation> {
  const protect = input.protect ?? {};
  const outcomes: FieldOutcome[] = [];
  const work: PreparedTranslation["work"] = [];

  for (const field of input.fields) {
    if (!field.value || !field.value.trim()) {
      outcomes.push({ key: field.key, status: "skipped", reason: "EMPTY" });
    } else if (MANUAL_ONLY_KEYS.has(field.key)) {
      outcomes.push({ key: field.key, status: "skipped", reason: "MANUAL_ONLY" });
    } else if (!isMachineTranslatable(field)) {
      outcomes.push({ key: field.key, status: "skipped", reason: "NOT_TRANSLATABLE" });
    } else {
      const doc = segmentField(field, protect);
      if (doc.segments.length === 0) {
        outcomes.push({ key: field.key, status: "skipped", reason: "NOT_TRANSLATABLE" });
      } else {
        work.push({ field, doc });
      }
    }
  }

  // Segments made only of protected spans and glossary replacements render
  // from their own source.
  const fixed = new Set(work.flatMap((w) => w.doc.segments.filter((s) => s.fixed).map((s) => s.source)));
  const all = work.flatMap((w) => w.doc.segments.filter((s) => !s.fixed).map((s) => s.source));
  const unique = [...new Set(all)];
  const hits = input.memory && unique.length ? await input.memory.lookup(unique) : new Map();
  const fromMemory = new Map<string, string>();
  for (const [source, hit] of hits) fromMemory.set(source, hit.target);
  const pending = unique.filter((s) => !fromMemory.has(s));
  const totalChars = all.reduce((sum, s) => sum + s.length, 0);
  const providerChars = pending.reduce((sum, s) => sum + s.length, 0);

  return {
    outcomes,
    work,
    fieldOrder: new Map(input.fields.map((f, i) => [f.key, i])),
    fromMemory,
    fixed,
    memoryEntryIds: [...hits.values()].map((h) => h.id),
    pending,
    providerChars,
    charsSaved: totalChars - providerChars,
  };
}

export interface CompleteTranslationInput {
  provider: TranslationProvider;
  sourceLocale: string;
  targetLocale: string;
  glossary?: readonly GlossaryRule[];
  context?: string;
  signal?: AbortSignal;
}

/**
 * Translates what memory didn't cover in one provider round-trip and
 * validates every field. A field is only "translated" if its structure is
 * intact and no blocking issue was found; otherwise it is "rejected" and
 * must not be published.
 */
export async function completeTranslation(prepared: PreparedTranslation, input: CompleteTranslationInput) {
  const outcomes = [...prepared.outcomes];
  const targets = new Map(prepared.fromMemory);
  for (const source of prepared.fixed) targets.set(source, source);
  let billedCharacters = 0;
  let provider = input.provider.id;

  if (prepared.pending.length) {
    const result = await input.provider.translate(
      {
        segments: prepared.pending,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        context: input.context,
      },
      input.signal,
    );
    prepared.pending.forEach((source, i) => targets.set(source, result.translations[i] ?? ""));
    billedCharacters = result.billedCharacters;
    provider = result.provider;
  }

  for (const { field, doc } of prepared.work) {
    const segmentTargets = new Map<string, string>();
    const pairs: SegmentPair[] = [];
    const issues: ValidationIssue[] = [];
    let structureError: string | null = null;
    let memorySegments = 0;

    for (const seg of doc.segments) {
      const target = targets.get(seg.source) ?? "";
      if (prepared.fromMemory.has(seg.source)) memorySegments++;
      segmentTargets.set(seg.id, target);
      // Glossary-only segments aren't worth remembering.
      if (!seg.fixed) pairs.push({ source: seg.source, target });
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
        const value = doc.render(segmentTargets);
        // Search engine titles and descriptions: length and "untranslated" warnings.
        issues.push(...checkSeoField(field.key, field.value ?? "", value));
        if (!hasBlockingIssue(issues)) {
          outcomes.push({
            key: field.key,
            status: "translated",
            value,
            issues,
            segmentPairs: pairs,
            fromMemory: memorySegments,
          });
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

  outcomes.sort((a, b) => prepared.fieldOrder.get(a.key)! - prepared.fieldOrder.get(b.key)!);
  return {
    outcomes,
    billedCharacters,
    provider,
    memoryHits: prepared.fromMemory.size,
    charsSaved: prepared.charsSaved,
    memoryEntryIds: prepared.memoryEntryIds,
  };
}

export interface TranslateFieldsInput extends CompleteTranslationInput {
  fields: readonly SourceField[];
  protect?: ProtectOptions;
  memory?: MemoryLookup;
}

/** prepareTranslation + completeTranslation in one call. */
export async function translateFields(input: TranslateFieldsInput) {
  const prepared = await prepareTranslation(input);
  return completeTranslation(prepared, input);
}
