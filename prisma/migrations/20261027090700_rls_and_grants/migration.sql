-- Row-level security for tenant-owned tables (docs/DATABASE_SCHEMA.md §3).
--
-- The runtime role sets `app.shop_id` transaction-locally through withTenant().
-- With no tenant set, NULLIF(...) yields NULL and the policy matches no rows
-- (fail closed). FORCE makes the policy apply to the table owner too.

ALTER TABLE "ShopInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopInstallation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopInstallation"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "ShopSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopSettings"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "ShopLocale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopLocale" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopLocale"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

-- Runtime role grants. Skipped when the role doesn't exist (for example a
-- throwaway shadow database), so the migration stays portable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT USAGE ON SCHEMA public TO linguva_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "Session", "Shop", "ShopInstallation", "ShopSettings", "ShopLocale",
      "WebhookEvent", "PrivacyRequest"
      TO linguva_app;
    -- Audit log is append-only for the runtime role.
    GRANT SELECT, INSERT ON "AuditLog" TO linguva_app;
  END IF;
END
$$;
