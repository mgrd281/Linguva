-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "formalityByLocale" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ShopSettings" ADD COLUMN "aiStoreContext" TEXT;

ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_aiStoreContext_length" CHECK (char_length("aiStoreContext") <= 300);
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_formality_object" CHECK (jsonb_typeof("formalityByLocale") = 'object');
