-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "InstallationEventType" AS ENUM ('INSTALLED', 'REINSTALLED', 'UNINSTALLED', 'SCOPES_UPDATED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('MERCHANT_USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PrivacyTopic" AS ENUM ('CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT', 'SHOP_REDACT');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'COMPLETED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopDomain" TEXT NOT NULL,
    "shopifyShopGid" TEXT,
    "name" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopInstallation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "event" "InstallationEventType" NOT NULL,
    "scopes" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shopId" UUID NOT NULL,
    "autoTranslateNew" BOOLEAN NOT NULL DEFAULT false,
    "protectManualEdits" BOOLEAN NOT NULL DEFAULT true,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "aiDataProcessingConsentAt" TIMESTAMPTZ(3),
    "consentVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "ShopLocale" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL,
    "published" BOOLEAN NOT NULL,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopLocale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "apiVersion" TEXT,
    "triggeredAt" TIMESTAMPTZ(3),
    "payloadHash" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopId" UUID,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "webhookId" TEXT NOT NULL,
    "topic" "PrivacyTopic" NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopGid_key" ON "Shop"("shopifyShopGid");

-- CreateIndex
CREATE INDEX "ShopInstallation_shopId_occurredAt_idx" ON "ShopInstallation"("shopId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopLocale_shopId_locale_key" ON "ShopLocale"("shopId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_receivedAt_idx" ON "WebhookEvent"("shopDomain", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRequest_webhookId_key" ON "PrivacyRequest"("webhookId");

-- CreateIndex
CREATE INDEX "PrivacyRequest_shopDomain_receivedAt_idx" ON "PrivacyRequest"("shopDomain", "receivedAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "ShopInstallation" ADD CONSTRAINT "ShopInstallation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopLocale" ADD CONSTRAINT "ShopLocale_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
