/**
 * Only the operator (owner database role) can grant complimentary access.
 * The app's runtime role can read its own shop's grant and nothing else,
 * and the posture check fails if it ever gains write access.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { grantComplimentaryAccess } from "../../app/.server/billing/complimentary";
import { checkDatabasePosture } from "../../app/.server/lib/db-posture";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();
const OWN = "gid://shopify/Shop/1001";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup() {
  const own = (await upsertInstalledShop({ shopDomain: "own.myshopify.com", shopifyShopGid: OWN }, app)).shop;
  const other = (await upsertInstalledShop({ shopDomain: "other.myshopify.com", shopifyShopGid: "gid://shopify/Shop/2002" }, app)).shop;
  return { own, other };
}

const row = (shopId: string, gid: string) => ({ shopId, shopifyShopGid: gid, reason: "x", grantedBy: "app", monthlyCharLimit: 1000 });

describe("complimentary access grants", () => {
  it("can't be created, changed or deleted by the runtime role, even for its own shop", async () => {
    const { own, other } = await setup();
    await expect(
      withTenant(other.id, (tx) => tx.complimentaryAccess.create({ data: row(other.id, "gid://shopify/Shop/2002") }), app),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(other.id, (tx) => tx.$executeRaw`INSERT INTO "ComplimentaryAccess" ("shopId","shopifyShopGid","reason","grantedBy","monthlyCharLimit") VALUES (${other.id}::uuid, 'gid://shopify/Shop/2002', 'x', 'x', 1)`, app),
    ).rejects.toThrow(/permission denied/);

    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: OWN, reason: "own", operator: "owner" });
    await expect(
      withTenant(own.id, (tx) => tx.complimentaryAccess.update({ where: { shopId: own.id }, data: { monthlyCharLimit: 100_000_000 } }), app),
    ).rejects.toThrow(/permission denied/);
    await expect(withTenant(own.id, (tx) => tx.complimentaryAccess.delete({ where: { shopId: own.id } }), app)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$executeRawUnsafe(`TRUNCATE "ComplimentaryAccess"`)).rejects.toThrow(/permission denied/);
    // Without the grant option PostgreSQL only warns; the privilege must stay absent.
    await app.$executeRawUnsafe(`GRANT INSERT ON "ComplimentaryAccess" TO linguva_app`).catch(() => undefined);
    const [check] = await app.$queryRaw<Array<{ write: boolean }>>`
      SELECT has_table_privilege(current_user, 'public."ComplimentaryAccess"', 'INSERT, UPDATE, DELETE, TRUNCATE') AS "write"`;
    expect(check!.write).toBe(false);
  });

  it("is readable only by the shop it belongs to", async () => {
    const { own, other } = await setup();
    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: OWN, reason: "own", operator: "owner" });
    expect(await withTenant(own.id, (tx) => tx.complimentaryAccess.count(), app)).toBe(1);
    expect(await withTenant(other.id, (tx) => tx.complimentaryAccess.count(), app)).toBe(0);
    expect(await app.complimentaryAccess.count()).toBe(0);
  });

  it("rejects malformed rows even from the owner role", async () => {
    const { own } = await setup();
    await expect(
      withTenant(own.id, (tx) => tx.complimentaryAccess.create({ data: { ...row(own.id, "own.myshopify.com") } }), ownerDb),
    ).rejects.toThrow(/gid_check/);
    await expect(
      withTenant(own.id, (tx) => tx.complimentaryAccess.create({ data: { ...row(own.id, OWN), monthlyCharLimit: -1 } }), ownerDb),
    ).rejects.toThrow(/limit_check/);
  });

  it("makes the posture check fail if the runtime role can write grants", async () => {
    expect((await checkDatabasePosture(app)).filter((i) => i.code === "RUNTIME_CAN_WRITE_GRANTS")).toEqual([]);
    await ownerDb.$executeRawUnsafe(`GRANT INSERT ON "ComplimentaryAccess" TO linguva_app`);
    try {
      expect(await checkDatabasePosture(app)).toContainEqual({ code: "RUNTIME_CAN_WRITE_GRANTS", detail: "ComplimentaryAccess" });
    } finally {
      await ownerDb.$executeRawUnsafe(`REVOKE INSERT ON "ComplimentaryAccess" FROM linguva_app`);
    }
  });
});
