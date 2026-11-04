/**
 * The Jobs list's loader (app/routes/app.jobs._index.tsx) against PostgreSQL,
 * called as a function with the session and billing stood in: the Problems
 * tile's figure of problems that need the merchant leaves out a stop whose
 * cause is fixed by now (stopFix), on every tab, also when the stop isn't on
 * screen, as its row and the attention card read it. Times are relative to
 * the clock, since the loader reads it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stand = vi.hoisted(() => ({
  shop: null as null | { id: string; shopDomain: string; name: string | null },
  admin: null as unknown,
  billing: null as unknown,
}));
vi.mock("../../app/.server/shopify/require-shop", () => ({
  requireShop: async () => ({ admin: stand.admin, shop: stand.shop, actorId: "42", session: {}, redirect: () => null, scopes: { query: async () => ({ granted: [] }) } }),
}));
vi.mock("../../app/.server/billing/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/billing/billing")>()),
  shopBilling: async () => stand.billing,
}));

import { PrismaClient, type Prisma, type TranslationJob } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { resetConfigCache } from "../../app/.server/lib/config";
import { resetQueueClient } from "../../app/.server/queue/client";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { PLANS } from "../../app/lib/plans";
import { loader } from "../../app/routes/app.jobs._index";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeEach(async () => {
  await resetDatabase();
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await resetQueueClient();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

let seq = 0;

async function standIn(name: string) {
  const { shop } = await upsertInstalledShop({ shopDomain: `${name}-${++seq}.myshopify.com`, name: "Jobs Store" }, app);
  stand.shop = shop;
  stand.admin = new FakeShopifyStore(0).asAdmin();
  stand.billing = { configured: true, entitlements: PLANS.pro };
  return shop;
}

/** A job that started `ago` before now; a terminal one ended ten minutes later. */
async function job(shopId: string, ago: number, data: Partial<Omit<Prisma.TranslationJobUncheckedCreateInput, "shopId">>): Promise<TranslationJob> {
  const createdAt = new Date(Date.now() - ago);
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.create({
        data: {
          resourceType: "PRODUCT",
          targetLocale: "de",
          discoveryDone: true,
          idempotencyKey: `loader-${++seq}`,
          finishedAt: new Date(createdAt.getTime() + 10 * MIN),
          ...data,
          shopId,
          status: data.status ?? "COMPLETED",
          createdAt,
        },
      }),
    app,
  );
}

const list = async (path: string) =>
  (await loader({ request: new Request(`http://app.test${path}`), params: {}, context: {} } as unknown as LoaderFunctionArgs)) as Awaited<ReturnType<typeof loader>>;

describe("the Jobs list's Problems tile", () => {
  it("counts a stop as needing the merchant only until its cause is fixed, on every tab", async () => {
    const shop = await standIn("tile");
    const stopped = await job(shop.id, 2 * HOUR, { status: "FAILED", errorCode: "CONSENT_REQUIRED", resourceType: "COLLECTION" });
    // No permission yet: the stop needs the merchant (the tile's dot), its row says so.
    const before = await list("/app/jobs");
    expect(before.counts).toMatchObject({ problems: 1, problemsNeedYou: 1 });
    expect(before.rows.find((row) => row.job.id === stopped.id)?.fixed).toBe(false);

    await setAiConsent({ shopId: shop.id, granted: true, actorId: "42" }, app);
    // Fixed by now: one click resumes it. Still a problem, no longer one that needs the merchant.
    const after = await list("/app/jobs");
    expect(after.counts).toMatchObject({ problems: 1, problemsNeedYou: 0 });
    expect(after.rows.find((row) => row.job.id === stopped.id)?.fixed).toBe(true);
    // The same where the stop isn't on screen (another tab) and with a filter that keeps it.
    for (const path of ["/app/jobs?status=completed", "/app/jobs?status=problems", "/app/jobs?lang=de"]) {
      expect((await list(path)).counts, path).toMatchObject({ problems: 1, problemsNeedYou: 0 });
    }

    // A completed job's failed items always need the merchant.
    await job(shop.id, 3 * HOUR, { failedItems: 2, resourceType: "PAGE" });
    expect((await list("/app/jobs?status=completed")).counts).toMatchObject({ problems: 2, problemsNeedYou: 1 });
  });
});
