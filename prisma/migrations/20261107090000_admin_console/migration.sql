-- Admin console (docs/ADMIN_CONSOLE.md): its operators and their sessions, and the
-- list prices it shows on the website and the Plan page, with their history
-- (docs/SECURITY_MODEL.md §5s). Global tables: no shop data, no shopId, no RLS.

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'FINANCE', 'SUPPORT', 'READONLY');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastTotpStep" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adminUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanPrice" (
    "handle" TEXT NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "yearlyCents" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "PlanPriceChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "handle" TEXT NOT NULL,
    "oldMonthlyCents" INTEGER NOT NULL,
    "oldYearlyCents" INTEGER,
    "newMonthlyCents" INTEGER NOT NULL,
    "newYearlyCents" INTEGER,
    "reason" TEXT NOT NULL,
    "adminUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_createdAt_idx" ON "AdminSession"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanPriceChange_createdAt_idx" ON "PlanPriceChange"("createdAt");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPriceChange" ADD CONSTRAINT "PlanPriceChange_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Values the app writes are checked here too.
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_email_check"
  CHECK ("email" = lower("email") AND length("email") <= 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+$');
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_passwordHash_check"
  CHECK ("passwordHash" ~ '^scrypt\$[0-9]{1,8}\$[0-9]{1,3}\$[0-9]{1,3}\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{43,}$');
-- Never plaintext: only the cipher's envelope v1.<kid>.<iv>.<tag>.<ciphertext>.
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_totpSecret_check"
  CHECK ("totpSecret" ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_counters_check"
  CHECK ("failedLogins" >= 0 AND "lastTotpStep" >= 0);
-- SHA-256, base64url without padding.
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_tokenHash_check"
  CHECK ("tokenHash" ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_expiresAt_check"
  CHECK ("expiresAt" > "createdAt");
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_handle_check"
  CHECK ("handle" IN ('free', 'starter', 'pro', 'business', 'own-key'));
-- Free stays free; a paid plan costs at least one dollar and at most 100,000 a month.
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_cents_check"
  CHECK (("handle" = 'free' AND "monthlyCents" = 0 AND "yearlyCents" IS NULL)
      OR ("handle" <> 'free' AND "monthlyCents" BETWEEN 100 AND 10000000 AND ("yearlyCents" IS NULL OR "yearlyCents" BETWEEN 100 AND 120000000)));
ALTER TABLE "PlanPriceChange" ADD CONSTRAINT "PlanPriceChange_handle_check"
  CHECK ("handle" IN ('free', 'starter', 'pro', 'business', 'own-key'));
ALTER TABLE "PlanPriceChange" ADD CONSTRAINT "PlanPriceChange_reason_check"
  CHECK (length("reason") BETWEEN 3 AND 500);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    -- Accounts are created, changed and disabled by the operator tool (owner role) only:
    -- the console reads them and keeps the sign-in counters.
    GRANT SELECT ON "AdminUser" TO linguva_app;
    GRANT UPDATE ("failedLogins", "lockedUntil", "lastTotpStep", "lastLoginAt", "updatedAt") ON "AdminUser" TO linguva_app;
    -- Sign-in, sign-out, expiry and clean-up.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdminSession" TO linguva_app;
    -- The console sets prices (never deletes a row: a missing row means the default).
    GRANT SELECT, INSERT, UPDATE ON "PlanPrice" TO linguva_app;
    -- History: append-only.
    GRANT SELECT, INSERT ON "PlanPriceChange" TO linguva_app;
  END IF;
END
$$;
