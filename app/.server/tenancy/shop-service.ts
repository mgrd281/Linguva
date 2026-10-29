import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "./with-tenant";

export interface InstallInput {
  shopDomain: string;
  shopifyShopGid?: string | null;
  name?: string | null;
  scopes?: string | null;
}

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
  if (!shop || shop.status === "UNINSTALLED") return shop;

  const updated = await client.shop.update({
    where: { id: shop.id },
    data: { status: "UNINSTALLED", uninstalledAt: new Date() },
  });
  await withTenant(
    shop.id,
    async (tx) => {
      await tx.shopInstallation.create({
        data: { shopId: shop.id, event: "UNINSTALLED" },
      });
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
    },
    client,
  );
  return updated;
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
