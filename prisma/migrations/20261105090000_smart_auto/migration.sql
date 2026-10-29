-- Smart Auto-Translate (Business plan; docs/SMART_AUTO_TRANSLATE.md):
-- the schedule and scope per shop, the runs (activity) and the resources
-- left alone, plus the columns runs, budgets and estimates need. Ids, codes,
-- times, counts and Shopify GIDs only, no merchant content. Row-level
-- security, grants and CHECK constraints are reviewed in
-- docs/SECURITY_MODEL.md §5p.

-- CreateEnum
CREATE TYPE "SmartRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SmartRunStatus" AS ENUM ('QUEUED', 'WAITING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- AlterTable
ALTER TABLE "CoverageItem" ADD COLUMN     "pendingChars" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CoverageReport" ADD COLUMN     "smartRunId" UUID;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "smartNextRunAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TranslationJob" ADD COLUMN     "fieldGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "replaceOutdatedMachine" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smartRunId" UUID;

-- AlterTable
ALTER TABLE "UsageLedger" ADD COLUMN     "origin" TEXT;

-- CreateTable
CREATE TABLE "SmartAutoConfig" (
    "shopId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'daily',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "times" INTEGER[] DEFAULT ARRAY[180]::INTEGER[],
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "locales" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resourceTypes" TEXT[] DEFAULT ARRAY['PRODUCT', 'COLLECTION', 'PAGE', 'ARTICLE', 'BLOG']::TEXT[],
    "fieldGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeAttached" BOOLEAN NOT NULL DEFAULT false,
    "publishMode" "BulkPublishMode" NOT NULL DEFAULT 'DRAFT',
    "publishConfirmedAt" TIMESTAMPTZ(3),
    "publishConfirmedBy" TEXT,
    "replaceOutdatedMachine" BOOLEAN NOT NULL DEFAULT true,
    "dailyBudget" INTEGER,
    "monthlyBudget" INTEGER,
    "pausedAt" TIMESTAMPTZ(3),
    "pauseReason" TEXT,
    "pausedUntil" TIMESTAMPTZ(3),
    "nextRunAt" TIMESTAMPTZ(3),
    "lastRunAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "primaryLocale" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SmartAutoConfig_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "SmartAutoRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "trigger" "SmartRunTrigger" NOT NULL,
    "occurrenceAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT,
    "status" "SmartRunStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "requestedBy" TEXT,
    "locales" TEXT[],
    "resourceTypes" TEXT[],
    "fieldGroups" TEXT[],
    "includeAttached" BOOLEAN NOT NULL DEFAULT false,
    "publishMode" "BulkPublishMode" NOT NULL DEFAULT 'DRAFT',
    "replaceOutdatedMachine" BOOLEAN NOT NULL DEFAULT true,
    "coverageReportId" UUID,
    "resourcesChecked" INTEGER NOT NULL DEFAULT 0,
    "resourcesChanged" INTEGER NOT NULL DEFAULT 0,
    "fieldsDetected" INTEGER NOT NULL DEFAULT 0,
    "charsEstimated" INTEGER NOT NULL DEFAULT 0,
    "itemsQueued" INTEGER NOT NULL DEFAULT 0,
    "excludedSkipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "scanFinishedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SmartAutoRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartAutoExclusion" (
    "shopId" UUID NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartAutoExclusion_pkey" PRIMARY KEY ("shopId","resourceGid")
);

-- CreateIndex
CREATE INDEX "SmartAutoRun_shopId_createdAt_idx" ON "SmartAutoRun"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "SmartAutoRun_shopId_status_idx" ON "SmartAutoRun"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SmartAutoRun_shopId_occurrenceAt_key" ON "SmartAutoRun"("shopId", "occurrenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmartAutoRun_shopId_idempotencyKey_key" ON "SmartAutoRun"("shopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Shop_smartNextRunAt_idx" ON "Shop"("smartNextRunAt");

-- CreateIndex
CREATE INDEX "TranslationJob_smartRunId_idx" ON "TranslationJob"("smartRunId");

-- AddForeignKey
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_smartRunId_fkey" FOREIGN KEY ("smartRunId") REFERENCES "SmartAutoRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartAutoRun" ADD CONSTRAINT "SmartAutoRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartAutoExclusion" ADD CONSTRAINT "SmartAutoExclusion_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Values the app writes are checked here too (forged form values never get stored).
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_mode_check"
  CHECK ("mode" IN ('realtime', 'daily', 'weekly', 'custom', 'manual'));
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_timeZone_check"
  CHECK (length("timeZone") <= 64 AND "timeZone" ~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+)+)$');
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_times_check"
  CHECK (cardinality("times") <= 6 AND 0 <= ALL ("times") AND 1439 >= ALL ("times"));
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_weekdays_check"
  CHECK (cardinality("weekdays") <= 7 AND 1 <= ALL ("weekdays") AND 7 >= ALL ("weekdays"));
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_locales_check"
  CHECK (cardinality("locales") <= 20
         AND array_to_string("locales", ',') ~ '^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*(,[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)*)?$');
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_resourceTypes_check"
  CHECK (cardinality("resourceTypes") <= 40 AND array_to_string("resourceTypes", ',') ~ '^([A-Z_]{1,40}(,[A-Z_]{1,40})*)?$');
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_fieldGroups_check"
  CHECK (cardinality("fieldGroups") <= 20 AND array_to_string("fieldGroups", ',') ~ '^([a-z_]{1,40}(,[a-z_]{1,40})*)?$');
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_budgets_check"
  CHECK (("dailyBudget" IS NULL OR "dailyBudget" BETWEEN 1 AND 100000000)
         AND ("monthlyBudget" IS NULL OR "monthlyBudget" BETWEEN 1 AND 100000000));
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_pauseReason_check"
  CHECK ("pauseReason" IS NULL OR "pauseReason" ~ '^[A-Z_]{1,40}$');
ALTER TABLE "SmartAutoConfig" ADD CONSTRAINT "SmartAutoConfig_primaryLocale_check"
  CHECK ("primaryLocale" IS NULL OR "primaryLocale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
ALTER TABLE "SmartAutoRun" ADD CONSTRAINT "SmartAutoRun_errorCode_check"
  CHECK ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z_]{1,40}$');
ALTER TABLE "SmartAutoRun" ADD CONSTRAINT "SmartAutoRun_idempotencyKey_check"
  CHECK ("idempotencyKey" IS NULL OR "idempotencyKey" ~ '^[A-Za-z0-9_-]{8,64}$');
ALTER TABLE "SmartAutoExclusion" ADD CONSTRAINT "SmartAutoExclusion_resourceGid_check"
  CHECK ("resourceGid" ~ '^gid://shopify/[A-Za-z]+/[0-9]+$' AND "resourceType" ~ '^[A-Z_]{1,40}$');
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_origin_check"
  CHECK ("origin" IS NULL OR "origin" = 'smart');

-- Row-level security (fail closed), as for every tenant table.
ALTER TABLE "SmartAutoConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmartAutoConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SmartAutoConfig"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "SmartAutoRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmartAutoRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SmartAutoRun"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "SmartAutoExclusion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmartAutoExclusion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SmartAutoExclusion"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- The configuration is never deleted by the app (shop/redact cascades).
    GRANT SELECT, INSERT, UPDATE ON "SmartAutoConfig" TO linguva_app;
    -- Runs older than 90 days are deleted per shop.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SmartAutoRun" TO linguva_app;
    -- The merchant removes exclusions.
    GRANT SELECT, INSERT, DELETE ON "SmartAutoExclusion" TO linguva_app;
  END IF;
END
$$;
