/**
 * Smoke checks of a deployed Linguva, from your machine, no secrets needed
 * (docs/RAILWAY_STAGING.md §6). Build: pnpm build:ops.
 *
 *   pnpm ops:smoke --url https://linguva-staging.up.railway.app --refused-shop karinex.myshopify.com
 *   pnpm ops:smoke --url https://web-production-73603.up.railway.app --expect-worker
 *
 * Exit code 1 when a check fails.
 */
import { parseArgs } from "node:util";
import { runSmokeChecks } from "./smoke-checks";

const { values } = parseArgs({
  options: { url: { type: "string" }, "refused-shop": { type: "string" }, "expect-worker": { type: "boolean" } },
});
if (!values.url) {
  console.error("--url is required (the deployment's https:// base address)");
  process.exit(1);
}

const results = await runSmokeChecks({ baseUrl: values.url, refusedShop: values["refused-shop"], expectWorker: values["expect-worker"] });
for (const r of results) console.info(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.info(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
