import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

// Runtime role connection (DATABASE_URL = linguva_app, no BYPASSRLS).
const app = new PrismaClient();

async function createShop(domain: string) {
  return app.shop.create({ data: { shopDomain: domain } });
}

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("row-level security", () => {
  it("connects as a role that cannot bypass RLS", async () => {
    const [role] = await app.$queryRaw<
      { rolname: string; rolbypassrls: boolean; rolsuper: boolean }[]
    >`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({
      rolname: "linguva_app",
      rolbypassrls: false,
      rolsuper: false,
    });
  });

  it("only returns the current tenant's rows", async () => {
    const a = await createShop("a.myshopify.com");
    const b = await createShop("b.myshopify.com");
    await withTenant(a.id, (tx) => tx.shopSettings.create({ data: { shopId: a.id } }), app);
    await withTenant(b.id, (tx) => tx.shopSettings.create({ data: { shopId: b.id } }), app);

    const seenByA = await withTenant(a.id, (tx) => tx.shopSettings.findMany(), app);
    expect(seenByA.map((s) => s.shopId)).toEqual([a.id]);

    // Even an explicit filter for another tenant returns nothing.
    const crossRead = await withTenant(
      a.id,
      (tx) => tx.shopSettings.findMany({ where: { shopId: b.id } }),
      app,
    );
    expect(crossRead).toEqual([]);
  });

  it("returns no rows when no tenant is set (fail closed)", async () => {
    const a = await createShop("a.myshopify.com");
    await withTenant(a.id, (tx) => tx.shopSettings.create({ data: { shopId: a.id } }), app);
    expect(await app.shopSettings.findMany()).toEqual([]);
    expect(await app.shopSettings.count()).toBe(0);
  });

  it("rejects writes for another tenant", async () => {
    const a = await createShop("a.myshopify.com");
    const b = await createShop("b.myshopify.com");
    await expect(
      withTenant(a.id, (tx) => tx.shopSettings.create({ data: { shopId: b.id } }), app),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const a = await createShop("a.myshopify.com");
    const b = await createShop("b.myshopify.com");
    await withTenant(
      b.id,
      (tx) => tx.shopLocale.create({
        data: { shopId: b.id, locale: "fr", name: "French", primary: false, published: false, syncedAt: new Date() },
      }),
      app,
    );
    const updated = await withTenant(
      a.id,
      (tx) => tx.shopLocale.updateMany({ where: { shopId: b.id }, data: { published: true } }),
      app,
    );
    const deleted = await withTenant(
      a.id,
      (tx) => tx.shopLocale.deleteMany({ where: { shopId: b.id } }),
      app,
    );
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const stillThere = await withTenant(b.id, (tx) => tx.shopLocale.findMany(), app);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]!.published).toBe(false);
  });

  it("does not leak the tenant setting to the next transaction", async () => {
    const a = await createShop("a.myshopify.com");
    await withTenant(a.id, (tx) => tx.shopSettings.create({ data: { shopId: a.id } }), app);
    const [row] = await app.$queryRaw<{ value: string | null }[]>`
      SELECT NULLIF(current_setting('app.shop_id', true), '') AS value`;
    expect(row!.value).toBeNull();
  });

  it("rejects non-UUID tenant ids before touching the database", async () => {
    await expect(withTenant("a.myshopify.com", async () => 1, app)).rejects.toThrow(
      /shop UUID/,
    );
  });

  it("keeps the audit log append-only for the runtime role", async () => {
    const entry = await app.auditLog.create({
      data: { actorType: "SYSTEM", action: "test.event" },
    });
    await expect(
      app.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/permission denied/);
    await expect(app.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});
