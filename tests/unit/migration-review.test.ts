/**
 * Every security-relevant database change is reviewed on its own: each
 * migration after the reviewed baseline names its review section in
 * docs/SECURITY_MODEL.md, and statements that can weaken tenant isolation
 * or privileges may only appear in migrations that were reviewed for them.
 * The applied result is checked again at runtime (db-posture) and by
 * tests/security/postgres-privileges.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "prisma", "migrations");
const MIGRATIONS = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, sql: readFileSync(join(DIR, d.name, "migration.sql"), "utf8") }))
  .sort((a, b) => a.name.localeCompare(b.name));
const SECURITY_MODEL = readFileSync(join(__dirname, "..", "..", "docs", "SECURITY_MODEL.md"), "utf8");

// Reviewed before per-migration review sections existed (QUALITY_AUDIT round 1, SECURITY_MODEL §2, §5c, §5d).
const BASELINE = "20261029120000_translation_style";

// Statements that can weaken isolation or privileges, and the migrations reviewed for them.
const SENSITIVE: Array<{ pattern: RegExp; allowed: string[] }> = [
  {
    pattern: /SECURITY\s+DEFINER/i,
    allowed: ["20261027180000_memory_fuzzy_function", "20261028090000_security_hardening", "20261030110000_draft_search_function"],
  },
  { pattern: /NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i, allowed: ["20261027180000_memory_fuzzy_function", "20261030110000_draft_search_function"] },
  { pattern: /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i, allowed: [] },
  { pattern: /\bBYPASSRLS\b/i, allowed: [] },
  { pattern: /\bTO\s+PUBLIC\b/i, allowed: [] },
  { pattern: /\bDROP\s+POLICY\b/i, allowed: [] },
  { pattern: /\bALTER\s+(ROLE|USER)\b/i, allowed: [] },
];

const code = (sql: string) => sql.replace(/--.*$/gm, "");

describe("database changes", () => {
  it("each migration after the baseline names its review in SECURITY_MODEL.md, and the section exists", () => {
    const newer = MIGRATIONS.filter((m) => m.name > BASELINE);
    expect(newer.length).toBeGreaterThan(0);
    for (const m of newer) {
      const ref = /docs\/SECURITY_MODEL\.md §(\w+)/.exec(m.sql);
      expect(ref, `${m.name} names no review section`).not.toBeNull();
      const timestamp = m.name.split("_")[0]!;
      const section = new RegExp(`^## ${ref![1]}\\. .*${timestamp}`, "m");
      expect(SECURITY_MODEL, `${m.name}: §${ref![1]} missing or not about this migration`).toMatch(section);
    }
  });

  it("statements that can weaken isolation appear only where they were reviewed", () => {
    for (const { pattern, allowed } of SENSITIVE) {
      const found = MIGRATIONS.filter((m) => pattern.test(code(m.sql))).map((m) => m.name);
      expect(found, String(pattern)).toEqual(allowed);
    }
  });

  it("a new tenant table gets row-level security, FORCE and its tenant policy in the same migration", () => {
    for (const m of MIGRATIONS.filter((x) => x.name > BASELINE)) {
      const sql = code(m.sql);
      for (const [, table, body] of sql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
        if (!/"shopId"/.test(body!)) continue;
        expect(sql, `${m.name}: ${table}`).toMatch(new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
        expect(sql, `${m.name}: ${table}`).toMatch(new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
        expect(sql, `${m.name}: ${table}`).toMatch(new RegExp(`CREATE POLICY \\w+ ON "${table}"`));
      }
    }
  });
});
