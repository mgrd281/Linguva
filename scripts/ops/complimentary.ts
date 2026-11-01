/**
 * Operator tool for owner complimentary access (docs/BILLING_DESIGN.md §4).
 * Runs with the owner database role (MIGRATION_DATABASE_URL); the app's
 * runtime role can't grant access. Build: pnpm build:ops.
 *
 *   pnpm ops:complimentary grant  --shop-gid gid://shopify/Shop/123 --reason "Own store" --operator owner [--monthly-chars 2000000] [--expires 2027-12-31]
 *   pnpm ops:complimentary revoke --shop-gid gid://shopify/Shop/123 --reason "Store sold" --operator owner
 *   pnpm ops:complimentary report [--period 2026-10]
 *
 * A grant only takes effect while the GID is also in COMPLIMENTARY_SHOP_GIDS
 * of the app and worker configuration.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  ComplimentaryAccessError,
  complimentaryUsageReport,
  grantComplimentaryAccess,
  revokeComplimentaryAccess,
} from "../../app/.server/billing/complimentary";
import { costRatesFromEnv } from "../../app/.server/lib/config";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "shop-gid": { type: "string" },
    reason: { type: "string" },
    operator: { type: "string" },
    "monthly-chars": { type: "string" },
    expires: { type: "string" },
    period: { type: "string" },
  },
});

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL (owner role) is not set");
  process.exit(1);
}
const owner = new PrismaClient({ datasources: { db: { url } } });
const allowlist = (process.env.COMPLIMENTARY_SHOP_GIDS ?? "").split(",").map((g) => g.trim()).filter(Boolean);

async function main() {
  const command = positionals[0];
  if (command === "grant") {
    const expires = values.expires ? new Date(`${values.expires}T23:59:59Z`) : null;
    if (expires && Number.isNaN(expires.getTime())) throw new ComplimentaryAccessError("--expires must be YYYY-MM-DD");
    const access = await grantComplimentaryAccess(owner, {
      shopifyShopGid: values["shop-gid"] ?? "",
      reason: values.reason ?? "",
      operator: values.operator ?? "",
      monthlyCharLimit: values["monthly-chars"] ? Number(values["monthly-chars"]) : undefined,
      expiresAt: expires,
    });
    console.log(`Granted: ${access.shopifyShopGid}, ${access.monthlyCharLimit.toLocaleString()} AI characters per month.`);
    if (!allowlist.includes(access.shopifyShopGid)) {
      console.log("Not active yet: add this GID to COMPLIMENTARY_SHOP_GIDS of the app and the worker, then restart them.");
    }
  } else if (command === "revoke") {
    await revokeComplimentaryAccess(owner, {
      shopifyShopGid: values["shop-gid"] ?? "",
      reason: values.reason ?? "",
      operator: values.operator ?? "",
    });
    console.log("Revoked. Also remove the GID from COMPLIMENTARY_SHOP_GIDS.");
  } else if (command === "report") {
    // The rates as the app reads them (validated, with the same defaults), from the three rate
    // variables only: the report runs with MIGRATION_DATABASE_URL and no other app variable.
    const rates = costRatesFromEnv();
    const usd = rates.deepl;
    const rows = await complimentaryUsageReport(owner, { allowlist, usdPerMillionChars: usd, period: values.period, ratesByProvider: rates });
    console.table(
      rows.map((r) => ({
        shop: r.shopDomain,
        gid: r.shopifyShopGid,
        active: r.active,
        period: r.period,
        "AI chars": r.chars,
        "limit/month": r.monthlyCharLimit,
        "est. cost USD": r.estimatedCostUsd,
      })),
    );
    console.log(`Estimate at ${rates.deepl} USD per million characters for DeepL (AI_COST_USD_PER_MILLION_CHARS).`);
    console.log(`Estimate at ${rates.azure} USD per million characters for Microsoft Azure (AI_COST_USD_PER_MILLION_CHARS_AZURE).`);
    console.log(`Estimate at ${rates.google} USD per million characters for Google Cloud (AI_COST_USD_PER_MILLION_CHARS_GOOGLE).`);
  } else {
    console.error("Usage: grant | revoke | report (see the header of scripts/ops/complimentary.ts)");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof ComplimentaryAccessError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => owner.$disconnect());
