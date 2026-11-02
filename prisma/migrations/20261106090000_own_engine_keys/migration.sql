-- Own key plan: a merchant's own engine keys, and who pays for a ledger row
-- (docs/SECURITY_MODEL.md §5r). Ciphertext only, a 4-character hint, codes and times.

-- A blocked ALTER on UsageLedger (the hottest write table) fails fast instead of queueing every reservation.
SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "ShopEngineCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "engine" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "dataLocation" TEXT NOT NULL,
    "region" TEXT,
    "deeplPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastErrorCode" TEXT,
    "lastErrorAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopEngineCredential_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "UsageLedger" ADD COLUMN     "payer" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ShopEngineCredential_shopId_engine_key" ON "ShopEngineCredential"("shopId", "engine");

-- AddForeignKey
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Values the app writes are checked here too.
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_engine_check"
  CHECK ("engine" IN ('deepl', 'azure', 'google'));
-- Never plaintext: only the cipher's envelope v1.<kid>.<iv>.<tag>.<ciphertext>.
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_secret_check"
  CHECK ("secret" ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');
-- Never more than the last four characters in clear.
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_hint_check"
  CHECK ("hint" ~ '^[A-Za-z0-9._-]{4}$');
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_dataLocation_check"
  CHECK (("engine" = 'deepl' AND "dataLocation" = 'eu') OR ("engine" = 'azure' AND "dataLocation" IN ('eu', 'global')) OR ("engine" = 'google' AND "dataLocation" = 'global'));
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_region_check"
  CHECK ("region" IS NULL OR ("engine" = 'azure' AND "region" ~ '^[a-z0-9]{2,32}$'));
-- DeepL rows always name their plan (IS NOT NULL: a NULL plan would make the first branch NULL, which a CHECK accepts).
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_deeplPlan_check"
  CHECK (("engine" = 'deepl' AND "deeplPlan" IS NOT NULL AND "deeplPlan" IN ('free', 'pro')) OR ("engine" <> 'deepl' AND "deeplPlan" IS NULL));
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_status_check"
  CHECK ("status" IN ('OK', 'QUOTA', 'REFUSED', 'UNREADABLE', 'RECHECK'));
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_keyVersion_check"
  CHECK ("keyVersion" >= 1);
ALTER TABLE "ShopEngineCredential" ADD CONSTRAINT "ShopEngineCredential_lastErrorCode_check"
  CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" ~ '^[A-Z_]{1,40}$');

-- Who pays: NULL = Linguva's engines; 'merchant' = the Own key plan's own keys (never a smart row).
-- NOT VALID: every existing row has payer NULL (the column is new), so no full scan under
-- ACCESS EXCLUSIVE; new and updated rows are checked. A later migration may VALIDATE it
-- (SHARE UPDATE EXCLUSIVE only).
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_payer_check"
  CHECK ("payer" IS NULL OR ("payer" = 'merchant' AND "origin" IS NULL)) NOT VALID;

-- Row-level security (fail closed), as for every tenant table.
ALTER TABLE "ShopEngineCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopEngineCredential" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopEngineCredential"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- The merchant adds, replaces, checks and removes keys; app/uninstalled deletes them.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ShopEngineCredential" TO linguva_app;
  END IF;
END
$$;
