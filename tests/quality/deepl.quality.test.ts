/**
 * Measures DeepL on the fictional demo catalog (tests/ui/fixtures/demo-store.ts):
 * every product's title, description, SEO title and meta description into
 * German, French and Spanish, through the same pipeline as bulk jobs
 * (segmentation, protected brand terms, preferred terms, structure and
 * content checks). Records billed characters, time, rejected fields and
 * quality notes, and writes docs/quality/DEEPL_MEASUREMENT.md with the
 * translations for a human to judge.
 *
 * Safety: runs only when DEEPL_API_KEY is set locally; the key is never
 * printed or written (errors carry the HTTP status only); a character budget
 * (DEEPL_QUALITY_MAX_CHARS, default 50,000) is checked before any call; no
 * store is contacted and no store data is used.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeepLProvider } from "../../app/.server/providers/deepl";
import { prepareTranslation, completeTranslation, type SourceField } from "../../app/.server/translation/translate-fields";
import { DEMO_GLOSSARY, DEMO_PRODUCTS } from "../ui/fixtures/demo-store";

const KEY = process.env.DEEPL_API_KEY;
const LOCALES = ["de", "fr", "es"];
const MAX_CHARS = Number(process.env.DEEPL_QUALITY_MAX_CHARS ?? 50_000);
/** Assumption to verify on deepl.com: DeepL API Pro usage price per million characters (USD). */
const PRO_USD_PER_MILLION = 25;

const digest = (v: string) => createHash("sha256").update(v).digest("hex");
function fieldsOf(p: (typeof DEMO_PRODUCTS)[number]): SourceField[] {
  const f = (key: string, value: string, type: string) => ({ key, value, type, digest: digest(value), locale: "en" });
  return [
    f("title", p.title, "SINGLE_LINE_TEXT_FIELD"),
    f("body_html", p.body, "HTML"),
    f("meta_title", p.metaTitle, "SINGLE_LINE_TEXT_FIELD"),
    f("meta_description", p.metaDescription, "MULTI_LINE_TEXT_FIELD"),
  ];
}

function protectFor(locale: string) {
  return {
    protectedTerms: DEMO_GLOSSARY.filter((g) => g.rule === "DO_NOT_TRANSLATE").map((g) => ({ term: g.term })),
    replacements: DEMO_GLOSSARY.filter((g) => g.rule === "PREFERRED" && (g.targetLocale === "" || g.targetLocale === locale)).map((g) => ({ term: g.term, value: g.translation! })),
  };
}

describe.skipIf(!KEY)("DeepL on the demo catalog (local measurement)", () => {
  it("translates, checks and records cost", async () => {
    const provider = new DeepLProvider({ apiKey: KEY! });
    // Budget check before any call.
    let planned = 0;
    for (const locale of LOCALES) {
      for (const p of DEMO_PRODUCTS) planned += (await prepareTranslation({ fields: fieldsOf(p), protect: protectFor(locale) })).providerChars;
    }
    expect(planned, "planned characters exceed DEEPL_QUALITY_MAX_CHARS").toBeLessThanOrEqual(MAX_CHARS);

    const lines: string[] = [];
    const summary: Array<{ locale: string; billed: number; fields: number; rejected: number; notes: number; ms: number }> = [];
    for (const locale of LOCALES) {
      const start = performance.now();
      let billed = 0;
      let fields = 0;
      let rejected = 0;
      let notes = 0;
      lines.push("", `## ${locale}`, "", "| Product | Field | Translation | Notes |", "|---|---|---|---|");
      for (const p of DEMO_PRODUCTS) {
        const prepared = await prepareTranslation({ fields: fieldsOf(p), protect: protectFor(locale) });
        const result = await completeTranslation(prepared, {
          engines: ["deepl"],
          provider,
          sourceLocale: "en",
          targetLocale: locale,
          context: `Product: ${p.title}`,
          formality: locale === "de" ? "less" : undefined,
          glossary: DEMO_GLOSSARY.filter((g) => g.rule === "FORBIDDEN" && g.targetLocale === locale).map((g) => ({ term: g.term, forbidden: [g.term] })),
        });
        billed += result.billedCharacters;
        for (const o of result.outcomes) {
          if (o.status === "skipped") continue;
          fields++;
          if (o.status === "rejected") rejected++;
          const issues = o.issues.map((i) => i.code);
          if (issues.length) notes++;
          const value = o.status === "translated" ? o.value : `REJECTED (${o.reason})`;
          lines.push(`| ${p.title} | ${o.key} | ${value.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${issues.join(", ") || "—"} |`);
        }
      }
      summary.push({ locale, billed, fields, rejected, notes, ms: Math.round(performance.now() - start) });
    }

    const products = DEMO_PRODUCTS.length;
    const report = [
      "# DeepL measurement on the demo catalog",
      "",
      `Run ${new Date().toISOString()} with \`pnpm test:deepl\` (fictional demo products, ${products} products × 4 fields; no store data). Cost assumption: DeepL API Pro $${PRO_USD_PER_MILLION} per million characters (verify on deepl.com).`,
      "",
      "| Language | Fields | Rejected | With quality notes | Billed characters | Characters per product | Estimated cost per 1,000 products | Time |",
      "|---|---|---|---|---|---|---|---|",
      ...summary.map((s) => `| ${s.locale} | ${s.fields} | ${s.rejected} | ${s.notes} | ${s.billed} | ${Math.round(s.billed / products)} | $${((s.billed / products) * 1000 * PRO_USD_PER_MILLION / 1e6).toFixed(2)} | ${s.ms} ms |`),
      "",
      "Quality is judged by a person from the translations below (fluency, terminology, tone); the automatic checks only catch structural and factual problems.",
      ...lines,
    ].join("\n");
    mkdirSync(join(__dirname, "..", "..", "docs", "quality"), { recursive: true });
    writeFileSync(join(__dirname, "..", "..", "docs", "quality", "DEEPL_MEASUREMENT.md"), `${report}\n`);
    for (const s of summary) expect(s.rejected, `${s.locale}: rejected fields`).toBeLessThanOrEqual(Math.ceil(s.fields * 0.1));
  });
});
