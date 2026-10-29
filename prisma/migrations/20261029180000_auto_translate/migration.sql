-- Automatic translation of new and changed products and collections:
-- the languages the merchant chose (autoTranslateNew already exists and
-- stays false by default). Row-level security, policies and grants of
-- ShopSettings are unchanged; reviewed in docs/SECURITY_MODEL.md §5h.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "autoTranslateLocales" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "ShopSettings" SET "autoTranslateLocales" = ARRAY[]::TEXT[] WHERE "autoTranslateLocales" IS NULL;
ALTER TABLE "ShopSettings" ALTER COLUMN "autoTranslateLocales" SET NOT NULL;

-- Shopify allows at most 20 languages per shop; codes like de or pt-BR.
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_autoTranslateLocales_check"
  CHECK (cardinality("autoTranslateLocales") <= 20
         AND array_to_string("autoTranslateLocales", ',') ~ '^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*(,[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)*)?$');
