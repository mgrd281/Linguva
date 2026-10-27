-- CreateEnum
CREATE TYPE "BulkPublishMode" AS ENUM ('DRAFT', 'AUTO_PUBLISH');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('APPROVED', 'MACHINE');

-- CreateEnum
CREATE TYPE "GlossaryRule" AS ENUM ('DO_NOT_TRANSLATE', 'PREFERRED', 'FORBIDDEN');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'STALE');

-- AlterEnum
ALTER TYPE "TranslationOrigin" ADD VALUE 'EXTERNAL';

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "autoPublishEnabledAt" TIMESTAMPTZ(3),
ADD COLUMN     "autoPublishEnabledBy" TEXT,
ADD COLUMN     "bulkPublishMode" "BulkPublishMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "reuseMachineMemory" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TranslationJob" ADD COLUMN     "charsSaved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "memoryHits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overwriteProtected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "protectedSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publishMode" "BulkPublishMode" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "TranslationRevision" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restoredFromId" UUID;

-- CreateTable
CREATE TABLE "TranslationMemory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "sourceLocale" TEXT NOT NULL,
    "targetLocale" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT '',
    "sourceHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "targetText" TEXT NOT NULL,
    "status" "MemoryStatus" NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TranslationMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Glossary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Glossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "glossaryId" UUID NOT NULL,
    "rule" "GlossaryRule" NOT NULL,
    "term" TEXT NOT NULL,
    "translation" TEXT,
    "targetLocale" TEXT NOT NULL DEFAULT '',
    "market" TEXT NOT NULL DEFAULT '',
    "caseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationDraft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "jobId" UUID,
    "resourceGid" TEXT NOT NULL,
    "resourceTitle" TEXT,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "segmentPairs" JSONB,
    "issues" JSONB,
    "provider" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TranslationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationMemory_shopId_sourceLocale_targetLocale_market_idx" ON "TranslationMemory"("shopId", "sourceLocale", "targetLocale", "market");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationMemory_shopId_sourceLocale_targetLocale_market_s_key" ON "TranslationMemory"("shopId", "sourceLocale", "targetLocale", "market", "sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Glossary_shopId_name_key" ON "Glossary"("shopId", "name");

-- CreateIndex
CREATE INDEX "GlossaryTerm_shopId_targetLocale_idx" ON "GlossaryTerm"("shopId", "targetLocale");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_glossaryId_rule_term_targetLocale_market_key" ON "GlossaryTerm"("glossaryId", "rule", "term", "targetLocale", "market");

-- CreateIndex
CREATE INDEX "TranslationDraft_shopId_status_locale_idx" ON "TranslationDraft"("shopId", "status", "locale");

-- CreateIndex
CREATE INDEX "TranslationDraft_shopId_jobId_status_idx" ON "TranslationDraft"("shopId", "jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationDraft_shopId_resourceGid_locale_key_key" ON "TranslationDraft"("shopId", "resourceGid", "locale", "key");

-- AddForeignKey
ALTER TABLE "TranslationMemory" ADD CONSTRAINT "TranslationMemory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Glossary" ADD CONSTRAINT "Glossary_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_glossaryId_fkey" FOREIGN KEY ("glossaryId") REFERENCES "Glossary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationDraft" ADD CONSTRAINT "TranslationDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigram similarity for fuzzy memory matches (trusted extension; the
-- database owner may create it).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Row-level security (same fail-closed policy as other tenant tables).
ALTER TABLE "TranslationMemory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationMemory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationMemory"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "Glossary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Glossary" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Glossary"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "GlossaryTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GlossaryTerm" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GlossaryTerm"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "TranslationDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationDraft"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- Merchants manage memory and glossaries (including deletion).
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TranslationMemory", "Glossary", "GlossaryTerm" TO linguva_app;
    -- Drafts change status but are never deleted by the runtime role.
    GRANT SELECT, INSERT, UPDATE ON "TranslationDraft" TO linguva_app;
  END IF;
END
$$;
