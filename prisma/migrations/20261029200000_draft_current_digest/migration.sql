-- A draft remembers which translation it was made to replace (sha256 of
-- the value, or 'none' when the field had no translation). Approving it
-- later publishes only if that translation is still in place, so a
-- translation someone wrote in the meantime is never overwritten. NULL for
-- drafts made before this migration (no check, as before). Row-level
-- security, policies and grants of TranslationDraft are unchanged;
-- reviewed in docs/SECURITY_MODEL.md §5i.

-- AlterTable
ALTER TABLE "TranslationDraft" ADD COLUMN "currentDigest" TEXT;

ALTER TABLE "TranslationDraft" ADD CONSTRAINT "TranslationDraft_currentDigest_check"
  CHECK ("currentDigest" IS NULL OR "currentDigest" ~ '^([0-9a-f]{64}|none)$');
