/**
 * `pnpm preflight`: checks a local setup before `shopify app dev` against a
 * development store. Reads .env (the shell wins), connects only to the
 * local database and Redis, never to Shopify. Prints names, never values.
 * Exit code 1 when a check fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { getConfig } from "../../app/.server/lib/config";
import { checkDatabasePosture } from "../../app/.server/lib/db-posture";
import {
  checkAppConfig,
  checkEncryptionKeys,
  checkNodeVersion,
  checkProviderCost,
  checkStoreTargets,
  checkTranslationEngines,
  type CheckResult,
} from "./preflight-checks";

const root = process.cwd();
const results: CheckResult[] = [checkNodeVersion(), ...checkAppConfig(root), ...checkStoreTargets(process.env)];

// The Shopify CLI provides these to `shopify app dev`; set them only to run the server without the CLI.
const cliVars = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL"].filter((k) => !process.env[k]);
if (cliVars.length) results.push({ level: "ok", name: "Shopify CLI variables", detail: `${cliVars.join(", ")} come from \`shopify app dev\`` });

let configOk = false;
try {
  const config = getConfig({ SHOPIFY_API_KEY: "preflight", ...process.env });
  configOk = true;
  results.push({ level: "ok", name: "Environment", detail: `valid (NODE_ENV=${config.NODE_ENV})` });
  if (config.NODE_ENV === "production") results.push({ level: "fail", name: "Environment", detail: "NODE_ENV=production: preflight is for development" });
  if (config.BILLING_REQUIRED === "true") results.push({ level: "warn", name: "Billing", detail: "BILLING_REQUIRED=true: shops without a plan are sent to Shopify's plan page" });
  const gids = (config.COMPLIMENTARY_SHOP_GIDS ?? "").split(",").filter(Boolean);
  if (gids.length) results.push({ level: "ok", name: "Complimentary access", detail: `${gids.length} shop GID(s) configured` });
} catch (error) {
  results.push({ level: "fail", name: "Environment", detail: error instanceof Error ? error.message : String(error) });
}
results.push(checkEncryptionKeys(process.env, `${root}/.env.example`), checkProviderCost(process.env));
// The app's privacy policy as the server serves it (its engine sections).
results.push(...checkTranslationEngines(process.env, { privacy: readFileSync(`${root}/site/privacy.html`, "utf8") }));

async function databaseChecks() {
  if (!process.env.DATABASE_URL) return;
  const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const [me] = await app.$queryRaw<Array<{ user: string }>>`SELECT current_user AS "user"`;
    const issues = await checkDatabasePosture(app);
    results.push(
      issues.length
        ? { level: "fail", name: "Database posture", detail: issues.map((i) => `${i.code} ${i.detail}`).join("; ") }
        : { level: "ok", name: "Database posture", detail: `runtime role ${me?.user}: RLS enforced, no bypass` },
    );
  } catch (error) {
    results.push({ level: "fail", name: "Database", detail: `can't connect or query with DATABASE_URL (${(error as Error).message.split("\n")[0]})` });
  } finally {
    await app.$disconnect();
  }
  if (!process.env.MIGRATION_DATABASE_URL) {
    results.push({ level: "fail", name: "Migrations", detail: "MIGRATION_DATABASE_URL (owner role) is not set" });
    return;
  }
  const owner = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL } } });
  try {
    const applied = await owner.$queryRaw<Array<{ name: string }>>`
      SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const expected = readdirSync(`${root}/prisma/migrations`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const missing = expected.filter((m) => !applied.some((a) => a.name === m));
    results.push(
      missing.length
        ? { level: "fail", name: "Migrations", detail: `${missing.length} not applied: run \`pnpm db:migrate\`` }
        : { level: "ok", name: "Migrations", detail: `${expected.length} applied` },
    );
  } catch (error) {
    results.push({ level: "fail", name: "Migrations", detail: `can't read the migration log (${(error as Error).message.split("\n")[0]}); run \`pnpm db:migrate\`` });
  } finally {
    await owner.$disconnect();
  }
}

async function redisCheck() {
  if (!process.env.REDIS_URL) {
    results.push({ level: "warn", name: "Redis", detail: "REDIS_URL not set: bulk translation and shared rate limits are off" });
    return;
  }
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  try {
    await redis.connect();
    await redis.ping();
    results.push({ level: "ok", name: "Redis", detail: "reachable (start the worker with `pnpm worker:dev`)" });
  } catch {
    results.push({ level: "fail", name: "Redis", detail: "not reachable at REDIS_URL" });
  } finally {
    redis.disconnect();
  }
}

async function main() {
  if (configOk || process.env.DATABASE_URL) await databaseChecks();
  await redisCheck();
  const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
  for (const r of results) console.log(`${icon[r.level]} ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => r.level === "fail").length;
  console.log(failed ? `\n${failed} check(s) failed. Fix them before \`pnpm dev\`.` : "\nReady for `pnpm dev` against your development store.");
  process.exitCode = failed ? 1 : 0;
}

void main();
