-- Live translation coverage (docs/SECURITY_MODEL.md §5m): one row per
-- resource and language with field keys, states and counts (no merchant
-- text), counts per language, type, field group and state, and the scan
-- state of each language and type. Replaces the per-report statistics.

-- CreateEnum
CREATE TYPE "CoverageSegmentStatus" AS ENUM ('SCANNING', 'SCANNED', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "CoverageItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "parentGid" TEXT,
    "sourceKeys" TEXT[],
    "currentKeys" TEXT[],
    "outdatedKeys" TEXT[],
    "draftKeys" TEXT[],
    "reviewKeys" TEXT[],
    "lastAttemptFailed" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "fieldStates" TEXT[],
    "stateComplete" INTEGER NOT NULL DEFAULT 0,
    "stateReview" INTEGER NOT NULL DEFAULT 0,
    "stateDraft" INTEGER NOT NULL DEFAULT 0,
    "stateFailed" INTEGER NOT NULL DEFAULT 0,
    "stateOutdated" INTEGER NOT NULL DEFAULT 0,
    "stateMissing" INTEGER NOT NULL DEFAULT 0,
    "seoIssues" INTEGER NOT NULL DEFAULT 0,
    "seoTitleHash" TEXT,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,
    "seenAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoverageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageCount" (
    "shopId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "fieldGroup" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoverageCount_pkey" PRIMARY KEY ("shopId","locale","resourceType","fieldGroup","state")
);

-- CreateTable
CREATE TABLE "CoverageSegment" (
    "shopId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "status" "CoverageSegmentStatus" NOT NULL,
    "reportId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "scannedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoverageSegment_pkey" PRIMARY KEY ("shopId","locale","resourceType")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverageItem_shopId_locale_resourceGid_key" ON "CoverageItem"("shopId", "locale", "resourceGid");

-- CreateIndex
CREATE INDEX "CoverageItem_shopId_locale_resourceType_id_idx" ON "CoverageItem"("shopId", "locale", "resourceType", "id");

-- CreateIndex
CREATE INDEX "CoverageItem_shopId_resourceGid_idx" ON "CoverageItem"("shopId", "resourceGid");

-- The latest attempt per resource (failed fields on the coverage page).
CREATE INDEX "TranslationJobItem_shopId_resourceGid_idx" ON "TranslationJobItem"("shopId", "resourceGid");

-- AddForeignKey
ALTER TABLE "CoverageItem" ADD CONSTRAINT "CoverageItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageCount" ADD CONSTRAINT "CoverageCount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageSegment" ADD CONSTRAINT "CoverageSegment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The per-report statistics are replaced by the live tables above.
DROP TABLE "CoverageStat";
DROP TABLE "CoverageGap";
DROP TABLE "CoverageTitleHash";

-- Row-level security (fail closed), as for every tenant table.
ALTER TABLE "CoverageItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageItem"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "CoverageCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageCount"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "CoverageSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverageSegment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverageSegment"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- Items of deleted resources and old counts are removed by the runtime role.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CoverageItem", "CoverageCount", "CoverageSegment" TO linguva_app;
  END IF;
END
$$;
