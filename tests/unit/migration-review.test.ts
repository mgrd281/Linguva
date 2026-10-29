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

// The privileges of a GRANT: everything before its ON (a GRANT without ON grants a role).
const PRIVILEGES = String.raw`\bGRANT\s(?:(?!\bON\b)[^;])*`;

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
  { pattern: /\b(ALTER|CREATE)\s+(ROLE|USER)\b/i, allowed: [] },
  // A changed policy replaces the tenant check (a new one is checked below).
  { pattern: /\bALTER\s+POLICY\b/i, allowed: [] },
  // Grants beyond reading and writing rows: ALL includes TRUNCATE, which ignores row-level
  // security; REFERENCES and TRIGGER attach constraints or code to a table; roles, whole
  // schemas and the grant option hand out more than one reviewed table.
  { pattern: /\bGRANT\s+ALL\b/i, allowed: [] },
  { pattern: new RegExp(`${PRIVILEGES}\\b(TRUNCATE|REFERENCES|TRIGGER)\\b`, "i"), allowed: [] },
  { pattern: new RegExp(`${PRIVILEGES}\\bTO\\b`, "i"), allowed: [] },
  { pattern: /\bGRANT\s[^;]*\bON\s+ALL\s+(TABLES|SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES)\s+IN\s+SCHEMA\b/i, allowed: [] },
  { pattern: /\bWITH\s+(GRANT|ADMIN)\s+OPTION\b/i, allowed: [] },
  { pattern: /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i, allowed: [] },
  // A view runs with its owner's rights, and the owner isn't forced on every table.
  { pattern: /\bCREATE\s+(OR\s+REPLACE\s+)?((TEMP|TEMPORARY|RECURSIVE|MATERIALIZED)\s+)*VIEW\b/i, allowed: [] },
  // Partitions and child tables have their own row-level security, used when they are queried
  // directly. (A table's PARTITION BY follows its column list; a window function's follows "(".)
  { pattern: /(\)\s*PARTITION\s+BY|\bPARTITION\s+OF|\bATTACH\s+PARTITION|\bINHERITS)\b/i, allowed: [] },
  // Outside public the posture check doesn't look; an owner that isn't the migration role escapes it.
  { pattern: /\bCREATE\s+SCHEMA\b/i, allowed: [] },
  { pattern: /\bOWNER\s+TO\b/i, allowed: [] },
];

const code = (sql: string) => sql.replace(/--.*$/gm, "");

/** Tables a migration creates (IF NOT EXISTS and public-qualified names included), with their column lists. */
const createdTables = (sql: string) =>
  [...sql.matchAll(/\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi)].map(
    ([, name, columns]) => ({ name: name!, columns: columns! }),
  );

/** Policies a migration creates: the table and the statement with whitespace collapsed. */
const policies = (sql: string) =>
  [...sql.matchAll(/\bCREATE\s+POLICY\s[^;]*?\bON\s+(?:"?public"?\.)?"?(\w+)"?[^;]*;/gi)].map(([text, table]) => ({
    table: table!,
    text: text.replace(/\s+/g, " "),
  }));

const TENANT = `"shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid`;
const tenantPolicy = (table: string) => `CREATE POLICY tenant_isolation ON "${table}" USING (${TENANT}) WITH CHECK (${TENANT});`;

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

  it("a policy is created only with its table: one on an existing table would be ORed with tenant_isolation", () => {
    // 20261027090700 added the first policies to the tables of the initial migration (SECURITY_MODEL §2).
    const found = MIGRATIONS.filter((m) => {
      const sql = code(m.sql);
      const created = new Set(createdTables(sql).map((t) => t.name));
      return policies(sql).some((p) => !created.has(p.table));
    }).map((m) => m.name);
    expect(found).toEqual(["20261027090700_rls_and_grants"]);
  });

  it("a new tenant table gets row-level security, FORCE and exactly the tenant policy in the same migration", () => {
    for (const m of MIGRATIONS.filter((x) => x.name > BASELINE)) {
      const sql = code(m.sql);
      for (const { name, columns } of createdTables(sql)) {
        if (!/"shopId"/.test(columns)) continue;
        expect(sql, `${m.name}: ${name}`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"${name}"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"));
        expect(sql, `${m.name}: ${name}`).toMatch(new RegExp(`ALTER\\s+TABLE\\s+"${name}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"));
        const own = policies(sql).filter((p) => p.table === name).map((p) => p.text);
        expect(own, `${m.name}: ${name}`).toEqual([tenantPolicy(name)]);
      }
    }
  });

  it("recognises the statements it guards against (the checks aren't vacuous)", () => {
    const flagged = (sql: string) => SENSITIVE.filter(({ pattern }) => pattern.test(code(sql))).map(({ pattern }) => String(pattern));
    for (const sql of [
      `GRANT ALL ON "SmartAutoConfig" TO linguva_app;`,
      `GRANT ALL PRIVILEGES ON TABLE "X" TO linguva_app;`,
      `GRANT SELECT, TRUNCATE ON "X" TO linguva_app;`,
      `GRANT REFERENCES ("id") ON "Shop" TO linguva_app;`,
      `GRANT TRIGGER ON "X" TO linguva_app;`,
      `GRANT linguva_owner TO linguva_app;`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO linguva_app;`,
      `GRANT SELECT ON "X" TO linguva_app WITH GRANT OPTION;`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO linguva_app;`,
      `ALTER POLICY tenant_isolation ON "ShopLocale" USING (true);`,
      `CREATE VIEW "SmartPendingDrafts" AS SELECT "shopId", "value" FROM "TranslationDraft";`,
      `CREATE OR REPLACE VIEW "V" AS SELECT 1;`,
      `CREATE MATERIALIZED VIEW "M" AS SELECT 1;`,
      `CREATE TABLE "Run" ("shopId" UUID NOT NULL, "at" DATE NOT NULL) PARTITION BY RANGE ("at");`,
      `CREATE TABLE "Run2026" PARTITION OF "Run" FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');`,
      `CREATE SCHEMA smart;`,
      `ALTER TABLE "X" OWNER TO linguva_app;`,
      `CREATE ROLE helper LOGIN;`,
    ]) {
      expect(flagged(sql), sql).not.toEqual([]);
    }
    // Plain grants as every migration writes them, and revocations, pass.
    for (const sql of [
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "CoverageItem", "CoverageCount" TO linguva_app;`,
      `GRANT USAGE ON SCHEMA public TO linguva_app;`,
      `GRANT EXECUTE ON FUNCTION public.linguva_draft_search(text, integer) TO linguva_app;`,
      `REVOKE ALL ON FUNCTION public.linguva_draft_search(text, integer) FROM PUBLIC;`,
      `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
      `SELECT row_number() OVER (PARTITION BY "shopId" ORDER BY "createdAt") FROM "TranslationJob";`,
    ]) {
      expect(flagged(sql), sql).toEqual([]);
    }

    // A tenant table the old pattern didn't see, and a second policy on an existing table.
    const sql = code(`CREATE TABLE IF NOT EXISTS "SmartAutoRun" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL
);
CREATE POLICY smart_read_all ON "ShopSettings" FOR SELECT USING (true);`);
    expect(createdTables(sql).map((t) => t.name)).toEqual(["SmartAutoRun"]);
    expect(policies(sql).map((p) => p.table)).toEqual(["ShopSettings"]);
    expect(policies(code(tenantPolicy("X")))[0]!.text).toBe(tenantPolicy("X"));
  });
});
