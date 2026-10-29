-- CreateTable
CREATE TABLE "PlatformUsageDay" (
    "day" DATE NOT NULL,
    "chars" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUsageDay_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "UsageLedger_shopId_createdAt_idx" ON "UsageLedger"("shopId", "createdAt");

-- Platform-wide counter: no tenant data, no RLS. The runtime role may only
-- read and adjust it (no DELETE).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "PlatformUsageDay" TO linguva_app;
  END IF;
END
$$;
