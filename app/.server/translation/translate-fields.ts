import { isWrongScript } from "../../lib/scripts";
import { isEngineRouter } from "../providers/engine-router";
import type { TranslationProvider } from "../providers/types";
import type { SegmentPair } from "../memory/alignment";
import {
  segmentHtml,
  segmentPlainText,
  type SegmentedDocument,
} from "./html-segmenter";
import type { ProtectOptions } from "./protect";
import { markupToPlainText, SegmentStructureError } from "./segment-markup";
import { markupToRichText, richTextToMarkup, richTextToPreviewHtml, RichTextError, sameRichTextStructure } from "./rich-text";
import {
  sameStructuredShape,
  segmentStructuredText,
  STRUCTURED_TEXT_TYPES,
  structuredHasBlankItem,
  structuredReadableText,
  StructuredTextError,
} from "./structured-text";
import { formalityMismatch } from "./formality-check";
import { checkSeoField, plainText } from "../../lib/seo";
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
// Shopify rich text (JSON), translated through its markup (rich-text.ts).
const RICH_TEXT_TYPE = "RICH_TEXT_FIELD";
const PLAIN_TYPES = new Set(["SINGLE_LINE_TEXT_FIELD", "MULTI_LINE_TEXT_FIELD", "STRING"]);
// URL handles change storefront URLs and redirects; only merchants set them.
const MANUAL_ONLY_KEYS = new Set(["handle"]);

export function isMachineTranslatable(field: SourceField): boolean {
  return (
    !MANUAL_ONLY_KEYS.has(field.key) &&
    (HTML_TYPES.has(field.type) || PLAIN_TYPES.has(field.type) || field.type === RICH_TEXT_TYPE || STRUCTURED_TEXT_TYPES.has(field.type))
  );
}

/** True when a list or link (of the original's shape) leaves an item of the original untranslated. */
export function leavesItemUntranslated(field: SourceField, value: string): boolean {
  return STRUCTURED_TEXT_TYPES.has(field.type) && structuredHasBlankItem(field.type, value, field.value ?? "");
}

/**
 * False when a value for rich text, a list or a link lost the source's
 * structure, number of items or link addresses (other types: always true).
 * Checked before anything is written to Shopify, whatever a form posted.
 */
export function keepsSourceStructure(field: SourceField, value: string): boolean {
  if (field.type === RICH_TEXT_TYPE) return sameRichTextStructure(value, field.value ?? "");
  if (STRUCTURED_TEXT_TYPES.has(field.type)) return sameStructuredShape(field.type, value, field.value ?? "");
  return true;
}

export function segmentField(field: SourceField, protect: ProtectOptions = {}): SegmentedDocument {
  if (field.type === RICH_TEXT_TYPE) return segmentRichText(field.value ?? "", protect);
  // Lists of texts and links: only the texts, the JSON around them stays.
  if (STRUCTURED_TEXT_TYPES.has(field.type)) return segmentStructuredText(field.type, field.value ?? "", protect);
  return HTML_TYPES.has(field.type)
    ? segmentHtml(field.value ?? "", protect)
    : segmentPlainText(field.value ?? "", protect);
}

/**
 * Rich text: its markup is segmented like HTML; rendering turns the
 * translation back into JSON and rejects any change of structure or links.
 * Throws RichTextError for documents with unknown parts (not translated).
 */
function segmentRichText(json: string, protect: ProtectOptions): SegmentedDocument {
  const doc = segmentHtml(richTextToMarkup(json), protect);
  return {
    segments: doc.segments,
    render(translations) {
      try {
        return markupToRichText(doc.render(translations), json);
      } catch (error) {
        if (error instanceof RichTextError) throw new SegmentStructureError("MISSING_CODE", error.message);
        throw error;
      }
    },
  };
}

/** The readable text of a field value, for checks (rich text JSON → its words). */
function readableText(type: string, value: string): string {
  if (STRUCTURED_TEXT_TYPES.has(type)) return structuredReadableText(type, value);
  if (type !== RICH_TEXT_TYPE) return plainText(value);
  try {
    return plainText(richTextToPreviewHtml(value));
  } catch {
    return "";
  }
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
  /**
   * Per pending source: true when every field it comes from is an HTML
   * field, so a line break in it is whitespace (HTML-transport engines only).
   */
  softBreaks: boolean[];
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
      let doc: SegmentedDocument;
      try {
        doc = segmentField(field, protect);
      } catch (error) {
        // Rich text with parts Linguva doesn't know, or a list or link of
        // an unexpected shape: left to Shopify's editor.
        if (!(error instanceof RichTextError) && !(error instanceof StructuredTextError)) throw error;
        outcomes.push({ key: field.key, status: "skipped", reason: "NOT_TRANSLATABLE" });
        continue;
      }
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
  const inPlainField = new Set(work.filter((w) => !HTML_TYPES.has(w.field.type)).flatMap((w) => w.doc.segments.map((s) => s.source)));
  const softBreaks = pending.map((s) => !inPlainField.has(s));
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
    softBreaks,
    providerChars,
    charsSaved: totalChars - providerChars,
  };
}

export interface CompleteTranslationInput {
  provider: TranslationProvider;
  /**
   * The engines the shop's AI consent covers (consentedEngines). Required, so
   * no call site forgets it: a router translates with none of them when it is
   * empty. A single-engine provider ignores it (consent was checked before).
   */
  engines: readonly string[];
  sourceLocale: string;
  targetLocale: string;
  glossary?: readonly GlossaryRule[];
  context?: string;
  formality?: "more" | "less";
  /** Routers only (routerSignal): the stop and deadline, checked between engines. */
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
  let lostByEngine: Readonly<Record<string, number>> | undefined;
  /** What the engine reported per source: a refused or flagged segment, a dropped form of address. */
  const notes = new Map<string, "ENGINE_MARKUP" | "SPACING_CHANGED">();
  let formalityDropped = false;

  if (prepared.pending.length) {
    const router = isEngineRouter(input.provider);
    // Only engines on the HTML transport read these: a bare DeepL request object stays exactly as before.
    const engineFields = router || input.provider.capabilities !== undefined;
    const result = await input.provider.translate(
      {
        segments: prepared.pending,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        context: input.context,
        ...(input.formality ? { formality: input.formality } : {}),
        ...(router ? { engines: input.engines } : {}),
        ...(engineFields && prepared.softBreaks.some(Boolean) ? { softBreaks: prepared.softBreaks } : {}),
      },
      input.signal,
    );
    prepared.pending.forEach((source, i) => targets.set(source, result.translations[i] ?? ""));
    billedCharacters = result.billedCharacters;
    provider = result.provider;
    lostByEngine = result.lostByEngine;
    for (const note of result.notes ?? []) {
      const source = prepared.pending[note.index];
      // A refusal wins over a warning for the same source.
      if (source !== undefined && notes.get(source) !== "ENGINE_MARKUP") notes.set(source, note.code);
    }
    formalityDropped = Boolean(input.formality) && (result.dropped ?? []).includes("formality");
  }
  const pendingSet = new Set(prepared.pending);

  for (const { field, doc } of prepared.work) {
    const segmentTargets = new Map<string, string>();
    const pairs: SegmentPair[] = [];
    const issues: ValidationIssue[] = [];
    let structureError: string | null = null;
    let memorySegments = 0;
    const fromEngine = doc.segments.some((seg) => pendingSet.has(seg.source));
    const segmentNotes = new Set(doc.segments.map((seg) => notes.get(seg.source)).filter(Boolean));
    // The engine couldn't map its output back to the field's codes: refused before the checks
    // read it, so it doesn't show as broken tags (and it is tried again with another engine).
    if (segmentNotes.has("ENGINE_MARKUP")) {
      outcomes.push({ key: field.key, status: "rejected", reason: "ENGINE_MARKUP", issues: [] });
      continue;
    }
    // Kept, but waits in Review: a warning keeps it out of automatic publishing.
    if (segmentNotes.has("SPACING_CHANGED")) issues.push({ code: "SPACING_CHANGED", severity: "warning" });
    if (formalityDropped && fromEngine) issues.push({ code: "FORMALITY_NOT_APPLIED", severity: "warning", detail: provider });

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
        // A result mostly outside the target language's script is likely wrong.
        // (Mostly product names or codes can also trigger it: a warning, the merchant decides.)
        if (isWrongScript(input.targetLocale, readableText(field.type, value))) {
          issues.push({ code: "WRONG_SCRIPT", severity: "warning" });
        }
        // The merchant's chosen form of address ("Sie" or "du"); memory reuse can bring the other one.
        const mismatch = input.formality ? formalityMismatch(input.targetLocale, input.formality, readableText(field.type, value)) : null;
        if (mismatch) issues.push({ code: "FORMALITY_MISMATCH", severity: "warning", detail: mismatch });
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
    ...(lostByEngine ? { lostByEngine } : {}),
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
