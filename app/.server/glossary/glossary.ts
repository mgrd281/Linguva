import type { GlossaryRule as Rule, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import type { ProtectOptions } from "../translation/protect";
import type { GlossaryRule } from "../translation/validate";
import { parseCsv, toCsv } from "./csv";

export const MAX_TERMS_PER_SHOP = 5_000;
export const DEFAULT_GLOSSARY = "Default";

const locale = z
  .string()
  .trim()
  .regex(/^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*)?$/, "must be a locale code such as de or pt-BR, or empty");
// The market's number (as shown on the Markets page) or its full Shopify id.
const market = z
  .string()
  .trim()
  .transform((v) => (/^\d{1,20}$/.test(v) ? `gid://shopify/Market/${v}` : v))
  .pipe(z.string().regex(/^(gid:\/\/shopify\/Market\/\d+)?$/, "must be a market number from the Markets page, or empty"));

export const termInputSchema = z
  .object({
    rule: z.enum(["DO_NOT_TRANSLATE", "PREFERRED", "FORBIDDEN"]),
    term: z.string().trim().min(1).max(200),
    translation: z.string().trim().max(200).optional().nullable(),
    targetLocale: locale.default(""),
    market: market.default(""),
    caseSensitive: z.boolean().default(false),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.rule === "PREFERRED") {
      if (!value.translation) {
        ctx.addIssue({ code: "custom", path: ["translation"], message: "is required for preferred terms" });
      }
      if (!value.targetLocale) {
        ctx.addIssue({ code: "custom", path: ["targetLocale"], message: "is required for preferred terms" });
      }
    }
  });

export type TermInput = z.input<typeof termInputSchema>;
type ParsedTerm = z.output<typeof termInputSchema>;

export class GlossaryLimitError extends Error {
  constructor() {
    super(`A shop can have at most ${MAX_TERMS_PER_SHOP} glossary terms`);
    this.name = "GlossaryLimitError";
  }
}

async function defaultGlossaryId(shopId: string, client: PrismaClient): Promise<string> {
  return withTenant(
    shopId,
    async (tx) => {
      const glossary = await tx.glossary.upsert({
        where: { shopId_name: { shopId, name: DEFAULT_GLOSSARY } },
        create: { shopId, name: DEFAULT_GLOSSARY },
        update: {},
      });
      return glossary.id;
    },
    client,
  );
}

export async function listTerms(
  shopId: string,
  filter: { targetLocale?: string } = {},
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.glossaryTerm.findMany({
        where: {
          shopId,
          ...(filter.targetLocale !== undefined ? { targetLocale: { in: ["", filter.targetLocale] } } : {}),
        },
        orderBy: [{ rule: "asc" }, { term: "asc" }],
        take: MAX_TERMS_PER_SHOP,
      }),
    client,
  );
}

function termData(shopId: string, glossaryId: string, t: ParsedTerm) {
  return {
    shopId,
    glossaryId,
    rule: t.rule as Rule,
    term: t.term,
    translation: t.rule === "PREFERRED" ? (t.translation ?? null) : null,
    targetLocale: t.targetLocale,
    market: t.market,
    caseSensitive: t.caseSensitive,
    notes: t.notes ?? null,
  };
}

/** Adds or updates terms (matched by rule, term, locale and market). */
export async function upsertTerms(
  shopId: string,
  inputs: readonly TermInput[],
  options: { replaceAll?: boolean } = {},
  client: PrismaClient = defaultClient,
) {
  const terms = inputs.map((i) => termInputSchema.parse(i));
  const glossaryId = await defaultGlossaryId(shopId, client);
  return withTenant(
    shopId,
    async (tx) => {
      if (options.replaceAll) await tx.glossaryTerm.deleteMany({ where: { shopId } });
      for (const t of terms) {
        const data = termData(shopId, glossaryId, t);
        await tx.glossaryTerm.upsert({
          where: {
            glossaryId_rule_term_targetLocale_market: {
              glossaryId,
              rule: data.rule,
              term: data.term,
              targetLocale: data.targetLocale,
              market: data.market,
            },
          },
          create: data,
          update: { translation: data.translation, caseSensitive: data.caseSensitive, notes: data.notes },
        });
      }
      const count = await tx.glossaryTerm.count({ where: { shopId } });
      // Rolls the whole transaction back, so nothing is half-imported.
      if (count > MAX_TERMS_PER_SHOP) throw new GlossaryLimitError();
      return terms.length;
    },
    client,
  );
}

export async function deleteTerm(shopId: string, termId: string, client: PrismaClient = defaultClient) {
  if (!/^[0-9a-f-]{36}$/i.test(termId)) return false;
  const result = await withTenant(
    shopId,
    (tx) => tx.glossaryTerm.deleteMany({ where: { id: termId, shopId } }),
    client,
  );
  return result.count === 1;
}

export interface ResolvedGlossary {
  protect: Pick<ProtectOptions, "protectedTerms" | "replacements">;
  rules: GlossaryRule[];
}

/** Picks the terms that apply to a target locale and market. */
export function resolveTerms(
  terms: ReadonlyArray<{
    rule: string;
    term: string;
    translation: string | null;
    targetLocale: string;
    market: string;
    caseSensitive: boolean;
  }>,
  targetLocale: string,
  marketId = "",
): ResolvedGlossary {
  const applies = (t: (typeof terms)[number]) =>
    (t.targetLocale === "" || t.targetLocale === targetLocale) && (t.market === "" || t.market === marketId);
  // Locale- or market-specific terms win over general ones with the same source.
  const specificity = (t: (typeof terms)[number]) => (t.targetLocale ? 2 : 0) + (t.market ? 1 : 0);
  const chosen = new Map<string, (typeof terms)[number]>();
  for (const t of terms.filter(applies).sort((a, b) => specificity(b) - specificity(a))) {
    const key = `${t.rule === "FORBIDDEN" ? "F" : "S"}:${t.caseSensitive ? t.term : t.term.toLowerCase()}`;
    if (!chosen.has(key)) chosen.set(key, t);
  }
  const list = [...chosen.values()];
  return {
    protect: {
      protectedTerms: list
        .filter((t) => t.rule === "DO_NOT_TRANSLATE")
        .map((t) => ({ term: t.term, caseSensitive: t.caseSensitive })),
      replacements: list
        .filter((t) => t.rule === "PREFERRED" && t.translation)
        .map((t) => ({ term: t.term, caseSensitive: t.caseSensitive, value: t.translation! })),
    },
    rules: list
      .filter((t) => t.rule === "FORBIDDEN")
      .map((t) => ({ term: t.term, caseSensitive: t.caseSensitive, forbidden: [t.term] })),
  };
}

export async function resolveGlossary(
  shopId: string,
  targetLocale: string,
  marketId = "",
  client: PrismaClient = defaultClient,
): Promise<ResolvedGlossary> {
  const terms = await withTenant(
    shopId,
    (tx) =>
      tx.glossaryTerm.findMany({
        where: {
          shopId,
          glossary: { enabled: true },
          targetLocale: { in: ["", targetLocale] },
          market: { in: ["", marketId] },
        },
      }),
    client,
  );
  return resolveTerms(terms, targetLocale, marketId);
}

export const CSV_HEADER = ["rule", "term", "translation", "target_locale", "market", "case_sensitive", "notes"];

export interface CsvImportResult {
  terms: TermInput[];
  errors: Array<{ line: number; message: string }>;
}

/** Parses a glossary CSV. Every row is validated; errors name the line. */
export function parseGlossaryCsv(text: string): CsvImportResult {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    return { terms: [], errors: [{ line: 0, message: (error as Error).message }] };
  }
  if (rows.length === 0) return { terms: [], errors: [{ line: 0, message: "The file is empty" }] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const index = (name: string) => header.indexOf(name);
  if (index("rule") < 0 || index("term") < 0) {
    return { terms: [], errors: [{ line: 1, message: "Header must include at least: rule, term" }] };
  }
  if (rows.length - 1 > MAX_TERMS_PER_SHOP) {
    return { terms: [], errors: [{ line: 0, message: `At most ${MAX_TERMS_PER_SHOP} rows` }] };
  }
  const cell = (row: string[], name: string) => (index(name) >= 0 ? (row[index(name)] ?? "").trim() : "");
  const terms: TermInput[] = [];
  const errors: CsvImportResult["errors"] = [];
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const candidate = {
      rule: cell(row, "rule").toUpperCase(),
      term: cell(row, "term").replace(/^'(?=[=+\-@])/, ""),
      translation: cell(row, "translation").replace(/^'(?=[=+\-@])/, "") || null,
      targetLocale: cell(row, "target_locale"),
      market: cell(row, "market"),
      caseSensitive: /^(true|yes|1)$/i.test(cell(row, "case_sensitive")),
      notes: cell(row, "notes") || null,
    };
    const parsed = termInputSchema.safeParse(candidate);
    if (parsed.success) terms.push(candidate as TermInput);
    else {
      errors.push({
        line,
        message: parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`).join("; "),
      });
    }
  });
  return { terms, errors };
}

export function glossaryToCsv(
  terms: ReadonlyArray<{
    rule: string;
    term: string;
    translation: string | null;
    targetLocale: string;
    market: string;
    caseSensitive: boolean;
    notes: string | null;
  }>,
): string {
  return toCsv([
    CSV_HEADER,
    ...terms.map((t) => [
      t.rule,
      t.term,
      t.translation ?? "",
      t.targetLocale,
      t.market,
      t.caseSensitive ? "true" : "false",
      t.notes ?? "",
    ]),
  ]);
}
