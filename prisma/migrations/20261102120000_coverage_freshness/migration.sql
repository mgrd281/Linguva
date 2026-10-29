-- Coverage freshness (docs/SECURITY_MODEL.md §5p). A coverage item keeps the
-- first 16 hex characters of Shopify's digest of each counted original, so a
-- pending draft made for an older original no longer counts as a draft;
-- items are found by their owner, so a deleted product's or collection's
-- custom fields leave with it; and a draft the app retires because its
-- language is no longer one of the store's additional languages says so.
-- Hashes and a reason code, no merchant text. Row-level security, policies
-- and grants of CoverageItem and TranslationDraft are unchanged (the
-- table-level grants cover the new columns).

-- AlterTable
ALTER TABLE "CoverageItem" ADD COLUMN     "sourceDigests" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Only hex digits (or empty entries): no text of the original can be kept here.
ALTER TABLE "CoverageItem" ADD CONSTRAINT "CoverageItem_sourceDigests_check"
  CHECK ("sourceDigests" IS NULL OR array_to_string("sourceDigests", '') ~ '^[0-9a-f]*$');

-- AlterTable
ALTER TABLE "TranslationDraft" ADD COLUMN     "staleReason" TEXT;

ALTER TABLE "TranslationDraft" ADD CONSTRAINT "TranslationDraft_staleReason_check"
  CHECK ("staleReason" IS NULL OR "staleReason" ~ '^[A-Z_]{1,40}$');

-- CreateIndex
CREATE INDEX "CoverageItem_shopId_parentGid_idx" ON "CoverageItem"("shopId", "parentGid");
