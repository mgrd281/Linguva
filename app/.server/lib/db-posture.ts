/**
 * Checks the database security posture the app relies on: the runtime role
 * can't bypass or change row-level security, every tenant table (partitioned
 * ones too) is under RLS and goes with its shop, no view reads tables with
 * its owner's rights, and the only SECURITY DEFINER functions are the
 * reviewed ones, owned by an ordinary role with a fixed search path. Run as
 * the runtime role.
 */
import type { PrismaClient } from "@prisma/client";

/** Tenant tables that intentionally don't force RLS on their owner (see SECURITY_MODEL §5c, §5l). */
export const NOT_FORCED_TABLES = ["TranslationMemory", "TranslationDraft"] as const;
/** Tables without RLS by design: global records, or no tenant data. */
export const GLOBAL_TABLES = ["Shop", "Session", "WebhookEvent", "PrivacyRequest", "AuditLog", "PlatformUsageDay", "_prisma_migrations"] as const;
/** Tables the runtime role may only read: entitlements granted by the operator. */
export const READ_ONLY_TABLES = ["ComplimentaryAccess"] as const;
/**
 * The reviewed SECURITY DEFINER functions: required search_path, and the
 * SHA-256 of the reviewed definition (body, settings, security, volatility,
 * arguments; see DEFINITION_HASH_SQL). Changing a definer function changes
 * its hash, so the posture check and CI fail until the new version has had
 * a security review and this value is updated with it
 * (docs/SECURITY_REVIEW_MEMORY_FUZZY.md, "Changing the function").
 */
export const DEFINER_FUNCTIONS: Record<string, { searchPath: string; sha256: string }> = {
  linguva_memory_fuzzy: {
    searchPath: "search_path=pg_catalog, pg_temp",
    // Reviewed 2026-10-28, migration 20261028090000_security_hardening.
    sha256: "55e38bfad0045f64601731c59b9885020e4eb4f9a496a5d3dd3c5b017941f364",
  },
  linguva_draft_search: {
    searchPath: "search_path=pg_catalog, pg_temp",
    // Reviewed 2026-10-28, migration 20261030110000_draft_search_function
    // (SECURITY_REVIEW_MEMORY_FUZZY.md, "Second function").
    sha256: "0d1a3754ba38150ebcaf9ef5e84bde2e2d1f087763df92cf5e0a989fd9411d89",
  },
};

export interface PostureIssue {
  code: string;
  detail: string;
}

export async function checkDatabasePosture(client: PrismaClient): Promise<PostureIssue[]> {
  const issues: PostureIssue[] = [];
  const add = (code: string, detail: string) => issues.push({ code, detail });

  const [me] = await client.$queryRaw<Array<{ name: string; superuser: boolean; bypassrls: boolean; createrole: boolean }>>`
    SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypassrls, rolcreaterole AS createrole
    FROM pg_roles WHERE rolname = current_user`;
  if (!me) return [{ code: "NO_ROLE", detail: "current_user not found" }];
  if (me.superuser) add("RUNTIME_SUPERUSER", me.name);
  if (me.bypassrls) add("RUNTIME_BYPASSRLS", me.name);
  if (me.createrole) add("RUNTIME_CREATEROLE", me.name);

  const owned = await client.$queryRaw<Array<{ relname: string }>>`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND pg_has_role(current_user, c.relowner, 'USAGE')`;
  for (const t of owned) add("RUNTIME_OWNS_TABLE", t.relname);

  const [schema] = await client.$queryRaw<Array<{ create: boolean }>>`
    SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "create"`;
  if (schema?.create) add("RUNTIME_CAN_CREATE_IN_PUBLIC", me.name);

  // Plain and partitioned tables ('p': a partition's own settings apply when it is queried directly).
  const tables = await client.$queryRaw<
    Array<{ relname: string; rls: boolean; force: boolean; tenant: boolean; policies: number; cascade: boolean; truncate: boolean; references: boolean; trigger: boolean }>
  >`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'shopId' AND NOT a.attisdropped) AS tenant,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'shopId' AND NOT a.attisdropped
                   WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.conkey = ARRAY[a.attnum] AND k.confrelid = s.oid AND k.confdeltype = 'c') AS "cascade",
           has_table_privilege(current_user, c.oid, 'TRUNCATE') AS "truncate",
           has_any_column_privilege(current_user, c.oid, 'REFERENCES') AS "references",
           has_table_privilege(current_user, c.oid, 'TRIGGER') AS "trigger"
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class s ON s.relnamespace = n.oid AND s.relname = 'Shop' AND s.relkind = 'r'
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
  for (const t of tables) {
    // On any table: TRUNCATE ignores row-level security; REFERENCES and TRIGGER attach constraints or code to it.
    const extra = [t.truncate && "TRUNCATE", t.references && "REFERENCES", t.trigger && "TRIGGER"].filter(Boolean);
    if (extra.length) add("RUNTIME_TABLE_PRIVILEGE", `${t.relname}: ${extra.join(", ")}`);
    if ((GLOBAL_TABLES as readonly string[]).includes(t.relname)) continue;
    if (!t.tenant) {
      add("UNCLASSIFIED_TABLE", t.relname);
      continue;
    }
    if (!t.rls) add("TENANT_TABLE_WITHOUT_RLS", t.relname);
    if (!t.force && !(NOT_FORCED_TABLES as readonly string[]).includes(t.relname)) add("TENANT_TABLE_NOT_FORCED", t.relname);
    if (t.policies !== 1) add("UNEXPECTED_POLICY_COUNT", `${t.relname}: ${t.policies}`);
    // shop/redact deletes the Shop row; a tenant row without this cascade would outlive it.
    if (!t.cascade) add("TENANT_TABLE_WITHOUT_SHOP_CASCADE", t.relname);
  }

  // A view runs with its owner's rights unless it is security_invoker, and the owner isn't forced on
  // NOT_FORCED_TABLES; a materialized view holds what its owner read. Views of extensions aren't the app's.
  const views = await client.$queryRaw<Array<{ relname: string; materialized: boolean; invoker: boolean }>>`
    SELECT c.relname, c.relkind = 'm' AS materialized,
           COALESCE((SELECT o.option_value::boolean FROM pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker'), false) AS invoker
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND has_any_column_privilege(current_user, c.oid, 'SELECT')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')`;
  for (const v of views) {
    if (v.materialized) add("RUNTIME_READS_MATERIALIZED_VIEW", v.relname);
    else if (!v.invoker) add("VIEW_NOT_SECURITY_INVOKER", v.relname);
  }

  for (const table of READ_ONLY_TABLES) {
    const [grant] = await client.$queryRaw<Array<{ write: boolean }>>`
      SELECT has_table_privilege(current_user, ${`public."${table}"`}, 'INSERT, UPDATE, DELETE, TRUNCATE') AS "write"`;
    if (grant?.write) add("RUNTIME_CAN_WRITE_GRANTS", table);
  }

  const policies = await client.$queryRaw<Array<{ table: string; qual: string | null; check: string | null; permissive: boolean; cmd: string }>>`
    SELECT c.relname AS "table", pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS "check", p.polpermissive AS permissive, p.polcmd::text AS cmd
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid`;
  const expected = "(\"shopId\" = (NULLIF(current_setting('app.shop_id'::text, true), ''::text))::uuid)";
  for (const p of policies) {
    if (p.qual !== expected || p.check !== expected || p.cmd !== "*") add("UNEXPECTED_POLICY", p.table);
  }

  const definers = await client.$queryRaw<
    Array<{ name: string; config: string[] | null; owner_super: boolean; owner_bypass: boolean; public_exec: boolean; sha256: string }>
  >`
    SELECT p.proname AS name, p.proconfig AS config, r.rolsuper AS owner_super, r.rolbypassrls AS owner_bypass,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
           encode(sha256(convert_to(p.prosrc || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosecdef::text
             || '|' || p.provolatile::text || '|' || pg_get_function_identity_arguments(p.oid), 'UTF8')), 'hex') AS sha256
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;
  for (const d of definers) {
    const required = DEFINER_FUNCTIONS[d.name];
    if (!required) {
      add("UNREVIEWED_SECURITY_DEFINER", d.name);
      continue;
    }
    if (!d.config?.includes(required.searchPath)) add("DEFINER_SEARCH_PATH", d.name);
    if (d.sha256 !== required.sha256) add("DEFINER_CHANGED_WITHOUT_REVIEW", d.name);
    if (d.owner_super || d.owner_bypass) add("DEFINER_OWNER_PRIVILEGED", d.name);
    if (d.public_exec) add("DEFINER_PUBLIC_EXECUTE", d.name);
  }
  for (const name of Object.keys(DEFINER_FUNCTIONS)) {
    if (!definers.some((d) => d.name === name)) add("DEFINER_MISSING", name);
  }
  return issues;
}

let verified: Promise<void> | undefined;

/**
 * Verifies the posture once per process. In production a failed check
 * stops the process from serving (fail closed); elsewhere it only warns.
 * A check that couldn't run (the database didn't answer) is tried again on
 * the next call instead of failing every later request.
 */
export function verifyDatabasePostureOnce(client: PrismaClient, options: { production: boolean; log: (msg: string, issues: PostureIssue[]) => void }) {
  verified ??= checkDatabasePosture(client).then(
    (issues) => {
      if (!issues.length) return;
      options.log("database security posture check failed", issues);
      if (options.production) throw new Error(`Database security posture check failed: ${issues.map((i) => i.code).join(", ")}`);
    },
    (error: unknown) => {
      verified = undefined;
      throw error;
    },
  );
  return verified;
}
