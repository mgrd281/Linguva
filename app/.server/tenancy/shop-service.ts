import type { PrismaClient } from "@prisma/client";
import { deleteShopEngineKeys } from "../credentials/store";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "./with-tenant";

export interface InstallInput {
  shopDomain: string;
  shopifyShopGid?: string | null;
  name?: string | null;
  scopes?: string | null;
}

/**
 * Shopify cancels the app's subscription when the app is uninstalled, so
 * the cached plan no longer holds: "no plan", checked never. The next
 * billing check asks the Partner API again, and with plans required a
 * reinstalled store chooses a plan again (App Store requirement 1.2.2).
 */
const CANCELLED_SUBSCRIPTION = {
  state: "NONE",
  planHandle: null,
  pendingPlanHandle: null,
  billingPeriod: null,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: null,
  checkedAt: new Date(0),
} as const;

/**
 * Creates or reactivates the tenant for a freshly authenticated shop and
 * records the installation event. Idempotent and safe under concurrency:
 * on first open the app's loaders authenticate in parallel, so several
 * requests install the same shop at once. Exactly one of them creates the
 * shop (INSTALLED) or reactivates it (REINSTALLED); the others only refresh
 * metadata.
 */
export async function upsertInstalledShop(
  input: InstallInput,
  client: PrismaClient = defaultClient,
) {
  const metadata = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.shopifyShopGid ? { shopifyShopGid: input.shopifyShopGid } : {}),
  };

  let event: "INSTALLED" | "REINSTALLED" | null = null;
  let existing = await client.shop.findUnique({ where: { shopDomain: input.shopDomain } });
  if (!existing) {
    try {
      existing = await client.shop.create({
        data: { shopDomain: input.shopDomain, name: input.name ?? null, shopifyShopGid: input.shopifyShopGid ?? null },
      });
      event = "INSTALLED";
    } catch (error) {
      // Another request created it first.
      if ((error as { code?: string }).code !== "P2002") throw error;
      existing = await client.shop.findUniqueOrThrow({ where: { shopDomain: input.shopDomain } });
    }
  }
  if (!event && existing.status === "UNINSTALLED") {
    // Only the request that flips the status records the reinstall.
    const flipped = await client.shop.updateMany({
      where: { id: existing.id, status: "UNINSTALLED" },
      data: { status: "ACTIVE", uninstalledAt: null, installedAt: new Date() },
    });
    if (flipped.count === 1) event = "REINSTALLED";
  }
  const shop =
    event === "INSTALLED" && !Object.keys(metadata).length
      ? existing
      : await client.shop.update({ where: { id: existing.id }, data: { status: "ACTIVE", ...metadata } });

  await withTenant(
    shop.id,
    async (tx) => {
      // ON CONFLICT DO NOTHING: concurrent requests can't collide.
      await tx.shopSettings.createMany({ data: [{ shopId: shop.id }], skipDuplicates: true });
      if (event) {
        await tx.shopInstallation.create({
          data: { shopId: shop.id, event, scopes: input.scopes ?? null },
        });
      }
      // The uninstall reset the plan already; this also covers one recorded before that reset existed.
      if (event === "REINSTALLED") {
        await tx.shopSubscription.updateMany({ where: { shopId: shop.id }, data: CANCELLED_SUBSCRIPTION });
        // The uninstall deleted the store's engine keys; a reinstall starts without any, also if one outlived it.
        await tx.shopEngineCredential.deleteMany({ where: { shopId: shop.id } });
      }
    },
    client,
  );

  return { shop, event };
}

export async function findShopByDomain(
  shopDomain: string,
  client: PrismaClient = defaultClient,
) {
  return client.shop.findUnique({ where: { shopDomain } });
}

export async function markShopUninstalled(
  shopDomain: string,
  client: PrismaClient = defaultClient,
) {
  const shop = await client.shop.findUnique({ where: { shopDomain } });
  // Tokens are useless after uninstall; delete them immediately.
  await client.session.deleteMany({ where: { shop: shopDomain } });
  if (!shop) return shop;
  // A repeated (or replayed) uninstall changes nothing else, but the keys still go.
  if (shop.status === "UNINSTALLED") {
    await deleteEngineKeysOf(shop.id, client);
    return shop;
  }

  const updated = await client.shop.update({
    where: { id: shop.id },
    // No scheduled check is due for an uninstalled shop.
    data: { status: "UNINSTALLED", uninstalledAt: new Date(), smartNextRunAt: null },
  });
  await withTenant(
    shop.id,
    async (tx) => {
      await tx.shopInstallation.create({
        data: { shopId: shop.id, event: "UNINSTALLED" },
      });
      // Shopify cancelled the subscription: a reinstall asks again (CANCELLED_SUBSCRIPTION).
      await tx.shopSubscription.updateMany({ where: { shopId: shop.id }, data: CANCELLED_SUBSCRIPTION });
      // Background work stops with the installation.
      await tx.translationJob.updateMany({
        where: { shopId: shop.id, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date(), errorCode: "SHOP_UNINSTALLED" },
      });
      await tx.coverageReport.updateMany({
        where: { shopId: shop.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", finishedAt: new Date(), errorCode: "SHOP_UNINSTALLED" },
      });
      await tx.coverageSegment.updateMany({
        where: { shopId: shop.id, status: "SCANNING" },
        data: { status: "FAILED", errorCode: "SHOP_UNINSTALLED" },
      });
      // The smart schedule stops and stays paused: a reinstall never resumes checks or
      // automatic publishing without the merchant (settings are kept until shop/redact).
      await tx.smartAutoRun.updateMany({
        where: { shopId: shop.id, status: { in: ["QUEUED", "WAITING", "RUNNING"] } },
        data: { status: "CANCELLED", errorCode: "SHOP_UNINSTALLED", finishedAt: new Date() },
      });
      await tx.smartAutoConfig.updateMany({
        where: { shopId: shop.id, enabled: true },
        data: { enabled: false, nextRunAt: null, pausedAt: null, pauseReason: null, pausedUntil: null },
      });
    },
    client,
  );
  await deleteEngineKeysOf(shop.id, client);
  return updated;
}

/**
 * The store's own translation keys (Own key plan) go with its access. Always after the status
 * change: a key save that is still in its live check reads the Shop row FOR SHARE in its own
 * transaction and refuses unless ACTIVE, and a save that locked the row first commits before the
 * status change (and so before this delete) runs.
 */
async function deleteEngineKeysOf(shopId: string, client: PrismaClient) {
  const engines = await deleteShopEngineKeys(shopId, client);
  if (engines.length === 0) return;
  // createMany: no RETURNING, so the runtime role needs no SELECT on AuditLog.
  await client.auditLog.createMany({
    data: [{ shopId, actorType: "SYSTEM", actorId: null, action: "engine_key.removed", targetType: "shop", targetId: null, metadata: { engines, reason: "SHOP_UNINSTALLED" } }],
  });
}

export async function recordScopesUpdate(
  shopDomain: string,
  scopes: string,
  client: PrismaClient = defaultClient,
) {
  const shop = await client.shop.findUnique({ where: { shopDomain } });
  if (!shop) return;
  await withTenant(
    shop.id,
    (tx) =>
      tx.shopInstallation.create({
        data: { shopId: shop.id, event: "SCOPES_UPDATED", scopes },
      }),
    client,
  );
}
