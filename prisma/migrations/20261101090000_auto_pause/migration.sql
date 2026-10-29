-- Automatic translation pauses instead of failing a job for every change
-- while a limit or the provider blocks it: until the daily cap resets, the
-- next month, or a re-check an hour later when the provider was missing.
-- The periodic check keeps its position during a pause, so the changes are
-- translated once it lifts. A time and a reason code, no merchant content.
-- Row-level security, policies and grants of ShopSettings are unchanged;
-- reviewed in docs/SECURITY_MODEL.md §5o.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "autoPausedUntil" TIMESTAMPTZ(3),
ADD COLUMN "autoPauseReason" TEXT;

ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_autoPauseReason_check"
  CHECK ("autoPauseReason" IS NULL OR "autoPauseReason" ~ '^[A-Z_]{1,40}$');

-- When the item's last run started (read the resource): a later change of
-- the resource is checked again, an earlier one has nothing new. A time only.
ALTER TABLE "TranslationJobItem" ADD COLUMN "startedAt" TIMESTAMPTZ(3);
