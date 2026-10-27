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
 * records the installation event. Idempotent: calling it again for an active
 * shop only refreshes metadata.
 */
export async function upsertInstalledShop(
  input: InstallInput,
  client: PrismaClient = defaultClient,
) {
  const existing = await client.shop.findUnique({
    where: { shopDomain: input.shopDomain },
  });

  const shop = existing
    ? await client.shop.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          uninstalledAt: null,
          ...(existing.status === "UNINSTALLED"
            ? { installedAt: new Date() }
            : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.shopifyShopGid
            ? { shopifyShopGid: input.shopifyShopGid }
            : {}),
        },
      })
    : await client.shop.create({
        data: {
          shopDomain: input.shopDomain,
          name: input.name ?? null,
          shopifyShopGid: input.shopifyShopGid ?? null,
        },
      });

  const event = !existing
    ? "INSTALLED"
    : existing.status === "UNINSTALLED"
      ? "REINSTALLED"
      : null;

  await withTenant(
    shop.id,
    async (tx) => {
      await tx.shopSettings.upsert({
        where: { shopId: shop.id },
        create: { shopId: shop.id },
        update: {},
      });
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
    (tx) =>
      tx.shopInstallation.create({
        data: { shopId: shop.id, event: "UNINSTALLED" },
      }),
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
