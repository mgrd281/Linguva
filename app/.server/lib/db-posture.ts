/**
 * Checks the database security posture the app relies on: the runtime role
 * can't bypass or change row-level security, every tenant table is under
 * RLS, and the only SECURITY DEFINER function is the reviewed one, owned by
 * an ordinary role with a fixed search path. Run as the runtime role.
 */
import type { PrismaClient } from "@prisma/client";

/** Tenant tables that intentionally don't force RLS on their owner (see SECURITY_MODEL §5c). */
export const NOT_FORCED_TABLES = ["TranslationMemory"] as const;
/** Tables without RLS by design: global records, or no tenant data. */
export const GLOBAL_TABLES = ["Shop", "Session", "WebhookEvent", "PrivacyRequest", "AuditLog", "PlatformUsageDay", "_prisma_migrations"] as const;
/** The reviewed SECURITY DEFINER functions and their required search_path. */
export const DEFINER_FUNCTIONS: Record<string, string> = {
  linguva_memory_fuzzy: "search_path=pg_catalog, pg_temp",
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

  const tables = await client.$queryRaw<Array<{ relname: string; rls: boolean; force: boolean; tenant: boolean; policies: number }>>`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'shopId' AND NOT a.attisdropped) AS tenant,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  for (const t of tables) {
    if ((GLOBAL_TABLES as readonly string[]).includes(t.relname)) continue;
    if (!t.tenant) {
      add("UNCLASSIFIED_TABLE", t.relname);
      continue;
    }
    if (!t.rls) add("TENANT_TABLE_WITHOUT_RLS", t.relname);
    if (!t.force && !(NOT_FORCED_TABLES as readonly string[]).includes(t.relname)) add("TENANT_TABLE_NOT_FORCED", t.relname);
    if (t.policies !== 1) add("UNEXPECTED_POLICY_COUNT", `${t.relname}: ${t.policies}`);
  }

  const policies = await client.$queryRaw<Array<{ table: string; qual: string | null; check: string | null; permissive: boolean; cmd: string }>>`
    SELECT c.relname AS "table", pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS "check", p.polpermissive AS permissive, p.polcmd::text AS cmd
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid`;
  const expected = "(\"shopId\" = (NULLIF(current_setting('app.shop_id'::text, true), ''::text))::uuid)";
  for (const p of policies) {
    if (p.qual !== expected || p.check !== expected || p.cmd !== "*") add("UNEXPECTED_POLICY", p.table);
  }

  const definers = await client.$queryRaw<Array<{ name: string; config: string[] | null; owner_super: boolean; owner_bypass: boolean; public_exec: boolean }>>`
    SELECT p.proname AS name, p.proconfig AS config, r.rolsuper AS owner_super, r.rolbypassrls AS owner_bypass,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;
  for (const d of definers) {
    const required = DEFINER_FUNCTIONS[d.name];
    if (!required) {
      add("UNREVIEWED_SECURITY_DEFINER", d.name);
      continue;
    }
    if (!d.config?.includes(required)) add("DEFINER_SEARCH_PATH", d.name);
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
 */
export function verifyDatabasePostureOnce(client: PrismaClient, options: { production: boolean; log: (msg: string, issues: PostureIssue[]) => void }) {
  verified ??= checkDatabasePosture(client).then((issues) => {
    if (!issues.length) return;
    options.log("database security posture check failed", issues);
    if (options.production) throw new Error(`Database security posture check failed: ${issues.map((i) => i.code).join(", ")}`);
  });
  return verified;
}
