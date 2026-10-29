-- CreateEnum
CREATE TYPE "TranslationJobStatus" AS ENUM ('PENDING', 'DISCOVERING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranslationJobItemStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateTable
CREATE TABLE "TranslationJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "targetLocale" TEXT NOT NULL,
    "status" "TranslationJobStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "discoveryCursor" TEXT,
    "discoveryDone" BOOLEAN NOT NULL DEFAULT false,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "succeededItems" INTEGER NOT NULL DEFAULT 0,
    "skippedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "charsBilled" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TranslationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationJobItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "queueJobId" TEXT,
    "status" "TranslationJobItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "fieldsTranslated" INTEGER NOT NULL DEFAULT 0,
    "fieldsRejected" INTEGER NOT NULL DEFAULT 0,
    "charsBilled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TranslationJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationJob_shopId_createdAt_idx" ON "TranslationJob"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "TranslationJob_shopId_status_idx" ON "TranslationJob"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationJob_shopId_idempotencyKey_key" ON "TranslationJob"("shopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TranslationJobItem_jobId_status_idx" ON "TranslationJobItem"("jobId", "status");

-- CreateIndex
CREATE INDEX "TranslationJobItem_shopId_status_idx" ON "TranslationJobItem"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationJobItem_jobId_resourceGid_key" ON "TranslationJobItem"("jobId", "resourceGid");

-- AddForeignKey
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationJobItem" ADD CONSTRAINT "TranslationJobItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationJobItem" ADD CONSTRAINT "TranslationJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TranslationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (same fail-closed policy as other tenant tables).
ALTER TABLE "TranslationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationJob"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "TranslationJobItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationJobItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationJobItem"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- Jobs are never deleted by the runtime role (they go with the shop).
    GRANT SELECT, INSERT, UPDATE ON "TranslationJob", "TranslationJobItem" TO linguva_app;
  END IF;
END
$$;
