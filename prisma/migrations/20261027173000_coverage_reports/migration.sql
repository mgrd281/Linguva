-- CreateEnum
CREATE TYPE "CoverageReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "CoverageReport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "status" "CoverageReportStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedBy" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "segments" TEXT[],
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "pagesScanned" INTEGER NOT NULL DEFAULT 0,
    "resourcesScanned" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoverageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageStat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "withSource" INTEGER NOT NULL DEFAULT 0,
    "translated" INTEGER NOT NULL DEFAULT 0,
    "outdated" INTEGER NOT NULL DEFAULT 0,
    "seoIssues" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoverageStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageGap" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "missing" INTEGER NOT NULL,
    "outdated" INTEGER NOT NULL,

    CONSTRAINT "CoverageGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageTitleHash" (
    "shopId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoverageTitleHash_pkey" PRIMARY KEY ("reportId","locale","hash")
);

-- CreateIndex
CREATE INDEX "CoverageReport_shopId_createdAt_idx" ON "CoverageReport"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageReport_shopId_idempotencyKey_key" ON "CoverageReport"("shopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CoverageStat_shopId_idx" ON "CoverageStat"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageStat_reportId_locale_resourceType_key_key" ON "CoverageStat"("reportId", "locale", "resourceType", "key");

-- CreateIndex
CREATE INDEX "CoverageGap_reportId_locale_missing_idx" ON "CoverageGap"("reportId", "locale", "missing");

-- CreateIndex
CREATE INDEX "CoverageGap_shopId_idx" ON "CoverageGap"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageGap_reportId_locale_resourceGid_key" ON "CoverageGap"("reportId", "locale", "resourceGid");

-- CreateIndex
CREATE INDEX "CoverageTitleHash_shopId_idx" ON "CoverageTitleHash"("shopId");

-- AddForeignKey
ALTER TABLE "CoverageReport" ADD CONSTRAINT "CoverageReport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageStat" ADD CONSTRAINT "CoverageStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageStat" ADD CONSTRAINT "CoverageStat_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CoverageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageGap" ADD CONSTRAINT "CoverageGap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageGap" ADD CONSTRAINT "CoverageGap_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CoverageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageTitleHash" ADD CONSTRAINT "CoverageTitleHash_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageTitleHash" ADD CONSTRAINT "CoverageTitleHash_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CoverageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (fail closed), as for every tenant table.
ALTER TABLE "CoverageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageReport"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "CoverageStat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageStat" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageStat"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "CoverageGap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageGap" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageGap"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "CoverageTitleHash" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageTitleHash" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageTitleHash"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- Reports are rebuilt, so old ones may be deleted by the runtime role.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CoverageReport", "CoverageStat", "CoverageGap", "CoverageTitleHash" TO linguva_app;
  END IF;
END
$$;
