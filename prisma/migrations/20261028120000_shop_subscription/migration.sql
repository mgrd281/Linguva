-- CreateEnum
CREATE TYPE "SubscriptionState" AS ENUM ('ACTIVE', 'NONE');

-- CreateTable
CREATE TABLE "ShopSubscription" (
    "shopId" UUID NOT NULL,
    "state" "SubscriptionState" NOT NULL,
    "planHandle" TEXT,
    "pendingPlanHandle" TEXT,
    "billingPeriod" TEXT,
    "trialEndsAt" TIMESTAMPTZ(3),
    "cancelAtEndOfCycle" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopSubscription_pkey" PRIMARY KEY ("shopId")
);

-- AddForeignKey
ALTER TABLE "ShopSubscription" ADD CONSTRAINT "ShopSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ShopSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopSubscription"
  USING ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "ShopSubscription" TO linguva_app;
  END IF;
END
$$;
