/**
 * Translation export and import as CSV, for agencies, translators and
 * spreadsheet workflows.
 *
 * Export: one content type and one language, read live from Shopify page by
 * page (at most MAX_EXPORT_RESOURCES items per file; the next part continues
 * from a cursor). Cells are formula-safe (csvCell).
 *
 * Import never publishes: every accepted row becomes a draft that waits on
 * Review, where approving it goes through the same checks as any other
 * write (source unchanged, translation unchanged since the draft, structure
 * kept). Rows are checked against the shop's own Shopify data first:
 * unknown items or fields, an original changed since the export, empty or
 * unchanged values and broken lists, links or rich text are reported per
 * row and skipped. The resource ids come from the file, but only resources
 * Shopify returns for this shop's session can match.
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { csvCell, parseCsv } from "../glossary/csv";
import { listTranslatableResources, type TranslatableResourceData } from "../shopify/translations-api";
import { translatableByIds } from "../shopify/attached-resources";
import { saveDrafts, type DraftInput } from "../review/drafts";
import { keepsSourceStructure, leavesItemUntranslated } from "./translate-fields";
import { translationDigest } from "./product-translation-service";
import { validateTranslation } from "./validate";
import { plainText } from "../../lib/seo";
import { contentGid, contentRef, isContentType, isImageCoverageType, kindOfGid, RESOURCE_KINDS, resourceTitle, type TranslatableKind } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;

export const EXPORT_COLUMNS = ["resource_id", "content_type", "field", "language", "source_digest", "original", "translation", "status"] as const;
export const MAX_EXPORT_RESOURCES = 2_000;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const EXPORT_PAGE = 50;

export type ExportType = TranslatableKind | "MEDIA_IMAGE" | "COLLECTION_IMAGE" | "ARTICLE_IMAGE";

export function isExportType(type: string): type is ExportType {
  return Object.hasOwn(RESOURCE_KINDS, type) || isContentType(type) || isImageCoverageType(type);
}

/** Rows of one page of resources (fields with an original). Pure. */
export function exportRows(resources: readonly TranslatableResourceData[], resourceType: string, locale: string, onlyGaps: boolean): string[][] {
  const rows: string[][] = [];
  for (const r of resources) {
    const translations = new Map(r.translations.map((t) => [t.key, t]));
    for (const field of r.content) {
      if (!field.value || !field.value.trim() || !field.digest) continue;
      const t = translations.get(field.key);
      const value = t?.value && t.value.trim() ? t.value : "";
      const status = !value ? "missing" : t!.outdated ? "outdated" : "complete";
      if (onlyGaps && status === "complete") continue;
      rows.push([r.resourceId, resourceType, field.key, locale, field.digest, field.value, value, status]);
    }
  }
  return rows;
}

/** One CSV file of an export (header included), and the cursor of the next part, if any. */
export async function exportTranslations(
  admin: Admin,
  input: { resourceType: ExportType; locale: string; onlyGaps: boolean; after?: string | null },
): Promise<{ csv: string; rows: number; nextCursor: string | null }> {
  const lines = [EXPORT_COLUMNS.join(",")];
  let cursor = input.after ?? null;
  let resources = 0;
  let rows = 0;
  for (;;) {
    const page = await listTranslatableResources(admin, { resourceType: input.resourceType, locale: input.locale, after: cursor, first: EXPORT_PAGE });
    for (const row of exportRows(page.resources, input.resourceType, input.locale, input.onlyGaps)) {
      lines.push(row.map(csvCell).join(","));
      rows++;
    }
    resources += page.resources.length;
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (!cursor || resources >= MAX_EXPORT_RESOURCES) break;
  }
  return { csv: `\uFEFF${lines.join("\r\n")}\r\n`, rows, nextCursor: cursor };
}

/** Undoes the export's formula protection ("'=…" back to "=…"). */
export function unprotectCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export type ImportProblem =
  | "INVALID_HEADER"
  | "INVALID_ROW"
  | "UNKNOWN_LANGUAGE"
  | "NOT_FOUND"
  | "UNKNOWN_FIELD"
  | "SOURCE_CHANGED"
  | "EMPTY"
  | "UNCHANGED"
  | "STRUCTURE_CHANGED"
  | "DUPLICATE";

export interface ImportResult {
  drafts: number;
  rows: number;
  skipped: Partial<Record<ImportProblem, number>>;
  /** The first problems, with their line in the file (header = line 1). */
  problems: Array<{ line: number; code: ImportProblem }>;
  tooMany?: boolean;
}

interface ParsedRow {
  line: number;
  gid: string;
  key: string;
  locale: string;
  digest: string;
  value: string;
}

export async function importTranslations(
  input: { admin: Admin; shopId: string; csv: string; targetLocales: readonly string[] },
  client: PrismaClient = defaultClient,
): Promise<ImportResult> {
  const result: ImportResult = { drafts: 0, rows: 0, skipped: {}, problems: [] };
  const problem = (line: number, code: ImportProblem) => {
    result.skipped[code] = (result.skipped[code] ?? 0) + 1;
    if (result.problems.length < 50) result.problems.push({ line, code });
  };

  let table: string[][];
  try {
    table = parseCsv(input.csv);
  } catch {
    problem(1, "INVALID_HEADER");
    return result;
  }
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: (typeof EXPORT_COLUMNS)[number]) => header.indexOf(name);
  const needed = ["resource_id", "field", "language", "source_digest", "translation"] as const;
  if (needed.some((n) => col(n) < 0)) {
    problem(1, "INVALID_HEADER");
    return result;
  }
  const body = table.slice(1);
  result.rows = body.length;
  if (body.length > MAX_IMPORT_ROWS) {
    result.tooMany = true;
    return result;
  }

  // Parse and group by language; each row's line number is kept for the report.
  const byLocale = new Map<string, ParsedRow[]>();
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const cell = (name: (typeof needed)[number]) => cells[col(name)] ?? "";
    const gid = cell("resource_id").trim();
    const key = cell("field").trim();
    const locale = cell("language").trim();
    const digest = cell("source_digest").trim();
    if (!contentGid(contentRef(gid)) || !/^[\w.:\-/]{1,300}$/.test(key) || !/^[0-9a-f]{64}$/.test(digest)) return problem(line, "INVALID_ROW");
    if (!input.targetLocales.includes(locale)) return problem(line, "UNKNOWN_LANGUAGE");
    const id = `${gid}|${key}|${locale}`;
    if (seen.has(id)) return problem(line, "DUPLICATE");
    seen.add(id);
    const rows = byLocale.get(locale) ?? [];
    rows.push({ line, gid, key, locale, digest, value: unprotectCell(cell("translation")) });
    byLocale.set(locale, rows);
  });

  for (const [locale, rows] of byLocale) {
    // Only resources Shopify returns for this shop's session can match.
    const resources = await translatableByIds(input.admin, [...new Set(rows.map((r) => r.gid))], locale);
    const drafts: DraftInput[] = [];
    for (const row of rows) {
      const resource = resources.get(row.gid);
      if (!resource) {
        problem(row.line, "NOT_FOUND");
        continue;
      }
      const field = resource.content.find((f) => f.key === row.key);
      if (!field || !field.value || !field.digest) {
        problem(row.line, "UNKNOWN_FIELD");
        continue;
      }
      if (field.digest !== row.digest) {
        problem(row.line, "SOURCE_CHANGED");
        continue;
      }
      if (!row.value.trim()) {
        problem(row.line, "EMPTY");
        continue;
      }
      const current = resource.translations.find((t) => t.key === row.key);
      if (current?.value === row.value && !current.outdated) {
        problem(row.line, "UNCHANGED");
        continue;
      }
      if (!keepsSourceStructure(field, row.value) || leavesItemUntranslated(field, row.value)) {
        problem(row.line, "STRUCTURE_CHANGED");
        continue;
      }
      const kind = kindOfGid(row.gid);
      drafts.push({
        jobId: null,
        resourceGid: row.gid,
        resourceTitle: kind ? resourceTitle(kind, resource.content) : null,
        locale,
        key: row.key,
        sourceDigest: field.digest,
        sourceValue: field.value,
        value: row.value,
        segmentPairs: [],
        // Same content checks as AI drafts (numbers, script, length): notes send it to "needs review".
        issues: validateTranslation({ source: plainText(field.value), target: plainText(row.value) }),
        provider: "csv",
        currentDigest: translationDigest(current?.value),
        valueType: field.type,
      });
    }
    for (let i = 0; i < drafts.length; i += 500) {
      result.drafts += await saveDrafts(input.shopId, drafts.slice(i, i + 500), client);
    }
  }
  result.problems.sort((a, b) => a.line - b.line);
  return result;
}
