/**
 * Seeds the test database for the UI tests: migrations, a clean database,
 * the test shops, AI consent, a completed review-mode bulk job (drafts for
 * the Review page) and owner complimentary access. Shopify itself is
 * simulated in the server process (tests/ui/server/preload.ts).
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { grantComplimentaryAccess } from "../../app/.server/billing/complimentary";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { testEnv } from "../support/env";
import { UI_SHOPS } from "./fixtures/shops";

export default async function globalSetup() {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testEnv.MIGRATION_DATABASE_URL },
    stdio: "pipe",
  });
  const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
  const app = new PrismaClient({ datasources: { db: { url: testEnv.DATABASE_URL } } });
  try {
    const tables = await owner.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await owner.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);

    const ids: Record<string, string> = {};
    for (const [key, shop] of Object.entries(UI_SHOPS)) {
      if (key === "fresh") continue;
      const { shop: row } = await upsertInstalledShop({ shopDomain: shop.domain, shopifyShopGid: shop.gid, name: shop.name }, app);
      ids[key] = row.id;
    }
    for (const key of ["full", "owner", "emptyCatalog", "failing", "visual"]) {
      await setAiConsent({ shopId: ids[key]!, granted: true, actorId: null }, app);
    }

    // A finished review-mode job for German: drafts wait on the Review page.
    const store = UI_SHOPS.full.build();
    const deps: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 1_000_000,
      keyPrefix: "lv:ui-test",
    };
    const { job } = await createBulkJob(
      { shopId: ids.full!, resourceType: "PRODUCT", targetLocale: "fr", requestedBy: null, idempotencyKey: "ui-seed-fr" },
      app,
    );
    const page = await runDiscoveryPage({ ...deps, discoveryPageSize: 8 }, { shopId: ids.full!, jobId: job.id });
    for (const itemId of page.itemIds) await processItem(deps, { shopId: ids.full!, itemId }, 1);

    await grantComplimentaryAccess(owner, {
      shopifyShopGid: UI_SHOPS.owner.gid,
      reason: "UI test: operator's own store",
      operator: "ui-test",
      monthlyCharLimit: 2_000_000,
    });
  } finally {
    await owner.$disconnect();
    await app.$disconnect();
  }
}
