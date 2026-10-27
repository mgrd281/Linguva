-- CreateEnum
CREATE TYPE "TranslationOrigin" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('RESERVE', 'ADJUST', 'RELEASE');

-- CreateTable
CREATE TABLE "TranslationRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "marketGid" TEXT,
    "value" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "origin" "TranslationOrigin" NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLedger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "chars" INTEGER NOT NULL,
    "provider" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationRevision_shopId_resourceGid_locale_createdAt_idx" ON "TranslationRevision"("shopId", "resourceGid", "locale", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLedger_shopId_periodKey_idx" ON "UsageLedger"("shopId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageLedger_shopId_idempotencyKey_key" ON "UsageLedger"("shopId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TranslationRevision" ADD CONSTRAINT "TranslationRevision_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (same fail-closed policy as other tenant tables).
ALTER TABLE "TranslationRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationRevision"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "UsageLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageLedger" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UsageLedger"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- History and usage are append-only for the runtime role.
    GRANT SELECT, INSERT ON "TranslationRevision", "UsageLedger" TO linguva_app;
  END IF;
END
$$;
