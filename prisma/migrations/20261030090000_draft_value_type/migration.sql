-- A draft remembers the Shopify content type of its field (e.g.
-- LIST_SINGLE_LINE_TEXT_FIELD, LINK, RICH_TEXT_FIELD), so Review can show
-- lists, links and rich text readably instead of as JSON. Display only:
-- publishing checks the structure against the type Shopify reports at that
-- moment, never this column. NULL for drafts made before this migration
-- (shown as text, as before). Row-level security, policies and grants of
-- TranslationDraft are unchanged; reviewed in docs/SECURITY_MODEL.md §5j.

-- AlterTable
ALTER TABLE "TranslationDraft" ADD COLUMN "valueType" TEXT;

ALTER TABLE "TranslationDraft" ADD CONSTRAINT "TranslationDraft_valueType_check"
  CHECK ("valueType" IS NULL OR "valueType" ~ '^[A-Z][A-Z_]{0,63}$');
