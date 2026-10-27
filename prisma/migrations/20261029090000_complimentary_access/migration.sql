-- CreateTable
CREATE TABLE "ComplimentaryAccess" (
    "shopId" UUID NOT NULL,
    "shopifyShopGid" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "monthlyCharLimit" INTEGER NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "ComplimentaryAccess_pkey" PRIMARY KEY ("shopId")
);

-- AddForeignKey
ALTER TABLE "ComplimentaryAccess" ADD CONSTRAINT "ComplimentaryAccess_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sanity limits: no negative or absurd allowances, a real Shopify GID.
ALTER TABLE "ComplimentaryAccess" ADD CONSTRAINT "ComplimentaryAccess_limit_check" CHECK ("monthlyCharLimit" > 0 AND "monthlyCharLimit" <= 100000000);
ALTER TABLE "ComplimentaryAccess" ADD CONSTRAINT "ComplimentaryAccess_gid_check" CHECK ("shopifyShopGid" ~ '^gid://shopify/Shop/[0-9]+$');

ALTER TABLE "ComplimentaryAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplimentaryAccess" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ComplimentaryAccess"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

-- Read-only for the app: granting free access is an operator action.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT SELECT ON "ComplimentaryAccess" TO linguva_app;
  END IF;
END
$$;
