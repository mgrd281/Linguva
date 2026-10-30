/**
 * Seeds the test database for the UI tests: migrations, a clean database,
 * the test shops, AI consent, a completed review-mode bulk job (drafts for
 * the Review page), coverage scans and owner complimentary access. Shopify itself is
 * simulated in the server process (tests/ui/server/preload.ts).
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { grantComplimentaryAccess } from "../../app/.server/billing/complimentary";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { upsertTerms } from "../../app/.server/glossary/glossary";
import { saveDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { saveSmartSettings, setSmartEnabled } from "../../app/.server/smart/config";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { testEnv } from "../support/env";
import { setWorkerRunning } from "./helpers";
import { DEMO_GLOSSARY, demoDrafts } from "./fixtures/demo-store";
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
    for (const key of ["full", "owner", "emptyCatalog", "failing", "visual", "customFields", "demo", "catalog", "autoLimits", "downgraded", "business", "businessEdit", "businessPause", "smartDowngraded"]) {
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

    // The demo store (App Store screenshots): French drafts, glossary, automatic translation on.
    await saveDrafts(ids.demo!, demoDrafts(), app);
    await upsertTerms(ids.demo!, DEMO_GLOSSARY, {}, app);
    await setAutoTranslate({ shopId: ids.demo!, enabled: true, locales: ["de", "fr"], allowedLocales: ["de", "fr", "es"], actorId: null }, app);

    // Automatic translation on for a language outside the plan, paused at today's allowance.
    await setAutoTranslate({ shopId: ids.autoLimits!, enabled: true, locales: ["de", "es"], allowedLocales: ["de", "es"], actorId: null }, app);
    await owner.$transaction([
      owner.$executeRaw`SELECT set_config('app.shop_id', ${ids.autoLimits!}, true)`,
      owner.$executeRaw`UPDATE "ShopSettings" SET "autoPausedUntil" = now() + interval '6 hours', "autoPauseReason" = 'DAILY_LIMIT' WHERE "shopId" = ${ids.autoLimits!}::uuid`,
    ]);
    // Turned on under a paid plan, before the store moved to Free.
    await setAutoTranslate({ shopId: ids.downgraded!, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: null }, app);

    // The smart schedule of the Business store: daily at 23:00 Berlin time, with two past checks.
    {
      const shopId = ids.business!;
      await saveSmartSettings(
        {
          shopId,
          actorId: null,
          version: 0,
          primaryLocale: "en",
          value: {
            mode: "daily",
            timeZone: "Europe/Berlin",
            times: [23 * 60],
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            locales: ["fr", "de"],
            resourceTypes: ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"],
            fieldGroups: [],
            includeAttached: false,
            publishMode: "DRAFT",
            replaceOutdatedMachine: true,
            dailyBudget: 50_000,
            monthlyBudget: 1_000_000,
          },
        },
        app,
      );
      await setSmartEnabled({ shopId, actorId: null, enabled: true }, app);
      const day = 86_400_000;
      const lastNight = new Date(Math.floor(Date.now() / day) * day - 3_600_000);
      await withTenant(
        shopId,
        async (tx) => {
          const scope = { locales: ["fr", "de"], resourceTypes: ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"], fieldGroups: [] };
          await tx.smartAutoRun.create({
            data: { shopId, trigger: "SCHEDULED", occurrenceAt: new Date(lastNight.getTime() - day), status: "SKIPPED", errorCode: "PAUSED", ...scope, createdAt: new Date(lastNight.getTime() - day), finishedAt: new Date(lastNight.getTime() - day) },
          });
          const completed = await tx.smartAutoRun.create({
            data: {
              shopId,
              trigger: "SCHEDULED",
              occurrenceAt: lastNight,
              status: "COMPLETED",
              ...scope,
              resourcesChecked: 64,
              resourcesChanged: 3,
              fieldsDetected: 12,
              charsEstimated: 1840,
              createdAt: lastNight,
              startedAt: lastNight,
              scanFinishedAt: new Date(lastNight.getTime() + 4 * 60_000),
              finishedAt: new Date(lastNight.getTime() + 6 * 60_000),
            },
          });
          // What it translated: its job, with the characters sent and those reused.
          await tx.translationJob.create({
            data: {
              shopId,
              resourceType: "PRODUCT",
              targetLocale: "fr",
              requestedBy: "system:smart",
              idempotencyKey: `smart:${completed.id}:PRODUCT:fr`,
              smartRunId: completed.id,
              status: "COMPLETED",
              discoveryDone: true,
              totalItems: 3,
              succeededItems: 3,
              charsBilled: 1200,
              charsSaved: 640,
              startedAt: lastNight,
              finishedAt: new Date(lastNight.getTime() + 6 * 60_000),
            },
          });
          await tx.smartAutoConfig.update({ where: { shopId }, data: { lastSuccessAt: new Date(lastNight.getTime() + 6 * 60_000) } });
        },
        app,
      );
    }

    // The smart schedule of the store whose pause and Check now are tested: on, daily into German.
    await saveSmartSettings(
      {
        shopId: ids.businessPause!,
        actorId: null,
        version: 0,
        primaryLocale: "en",
        value: {
          mode: "daily",
          timeZone: "Europe/Berlin",
          times: [3 * 60],
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          locales: ["de"],
          resourceTypes: ["PRODUCT"],
          fieldGroups: [],
          includeAttached: false,
          publishMode: "DRAFT",
          replaceOutdatedMachine: true,
          dailyBudget: null,
          monthlyBudget: null,
        },
      },
      app,
    );
    await setSmartEnabled({ shopId: ids.businessPause!, actorId: null, enabled: true }, app);

    // The same schedule, turned on before the store moved from Business to Pro.
    await saveSmartSettings(
      {
        shopId: ids.smartDowngraded!,
        actorId: null,
        version: 0,
        primaryLocale: "en",
        value: {
          mode: "realtime",
          timeZone: "Europe/Berlin",
          times: [3 * 60],
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          locales: ["de"],
          resourceTypes: ["PRODUCT"],
          fieldGroups: [],
          includeAttached: false,
          publishMode: "DRAFT",
          replaceOutdatedMachine: true,
          dailyBudget: null,
          monthlyBudget: null,
        },
      },
      app,
    );
    await setSmartEnabled({ shopId: ids.smartDowngraded!, actorId: null, enabled: true }, app);

    // A German job with custom fields: a list of links waits on Review.
    const fieldsStore = UI_SHOPS.customFields.build();
    const fieldsDeps = { ...deps, adminFor: async () => fieldsStore.asAdmin() };
    const { job: fieldsJob } = await createBulkJob(
      { shopId: ids.customFields!, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "ui-seed-fields-de", includeAttached: true },
      app,
    );
    const fieldsPage = await runDiscoveryPage(fieldsDeps, { shopId: ids.customFields!, jobId: fieldsJob.id });
    for (const itemId of fieldsPage.itemIds) await processItem(fieldsDeps, { shopId: ids.customFields!, itemId }, 1);

    // A finished coverage scan (after the drafts above, so they show as drafts).
    for (const key of ["full", "demo", "remeasure", "catalog", "visual"] as const) {
      const shopStore = UI_SHOPS[key].build();
      const coverageDeps: CoverageDeps = { prisma: app, adminFor: async () => shopStore.asAdmin(), keyPrefix: "lv:ui-test" };
      const locales = UI_SHOPS[key].locales.filter((l) => !l.primary).map((l) => l.locale);
      const { report } = await createCoverageReport({ shopId: ids[key]!, locales, requestedBy: null, idempotencyKey: `ui-coverage-${key}` }, app);
      let next: CoveragePagePayload | null = { shopId: ids[key]!, reportId: report.id, segmentIndex: 0, cursor: null };
      while (next) next = await runCoveragePage(coverageDeps, next);
    }

    // After its completed measurement, a newer one that has made no progress for an hour.
    {
      const locales = UI_SHOPS.remeasure.locales.filter((l) => !l.primary).map((l) => l.locale);
      await createCoverageReport({ shopId: ids.remeasure!, locales, requestedBy: null, idempotencyKey: "ui-coverage-remeasure-stuck" }, app);
      await owner.$transaction([
        owner.$executeRaw`SELECT set_config('app.shop_id', ${ids.remeasure!}, true)`,
        // Only its last progress: it stays the newest report.
        owner.$executeRaw`UPDATE "CoverageReport" SET "updatedAt" = now() - interval '1 hour' WHERE "shopId" = ${ids.remeasure!}::uuid AND "status" = 'QUEUED'`,
      ]);
    }

    // A measurement queued an hour ago that never started (no worker): the Overview offers it again.
    {
      const locales = UI_SHOPS.stalled.locales.filter((l) => !l.primary).map((l) => l.locale);
      await createCoverageReport({ shopId: ids.stalled!, locales, requestedBy: null, idempotencyKey: "ui-coverage-stalled" }, app);
      await owner.$transaction([
        owner.$executeRaw`SELECT set_config('app.shop_id', ${ids.stalled!}, true)`,
        owner.$executeRaw`UPDATE "CoverageReport" SET "createdAt" = now() - interval '1 hour', "updatedAt" = now() - interval '1 hour' WHERE "shopId" = ${ids.stalled!}::uuid`,
      ]);
    }

    // No worker runs in these tests: a heartbeat left from an earlier run would say otherwise.
    await setWorkerRunning(false);

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
