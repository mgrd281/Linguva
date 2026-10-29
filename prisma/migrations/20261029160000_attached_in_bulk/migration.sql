-- Image alt text and custom fields in bulk jobs.
-- - TranslationJob.includeAttached: the merchant chose to include them
--   (default false: existing and new jobs behave as before).
-- - TranslationDraft.parentGid: the resource an image or custom field
--   belongs to. Nullable: existing drafts are unaffected.
-- Row-level security, policies and grants of both tables are unchanged (new
-- columns of an RLS table are covered by its existing policy); reviewed in
-- docs/SECURITY_MODEL.md §5g.

-- AlterTable
ALTER TABLE "TranslationJob" ADD COLUMN "includeAttached" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TranslationDraft" ADD COLUMN "parentGid" TEXT;

-- The parent must be a Shopify GID like the draft's own resource.
ALTER TABLE "TranslationDraft" ADD CONSTRAINT "TranslationDraft_parentGid_format"
  CHECK ("parentGid" IS NULL OR "parentGid" ~ '^gid://shopify/[A-Za-z]+/[0-9]+$');
