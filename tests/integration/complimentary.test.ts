import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const shopify = vi.hoisted(() => {
  // The Plan page reads the store's languages from Shopify. The Shopify
  // library keeps the fetch it finds when it loads, so it is replaced first:
  // that one query is answered here, and nothing else may reach Shopify.
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.endsWith(".myshopify.com")) return real(input, init);
    const body = String(init?.body ?? "");
    calls.push(url.hostname);
    if (url.pathname.endsWith("/graphql.json") && body.includes("LinguvaShopLocales")) {
      return Response.json({
        data: {
          shopLocales: [
            { locale: "en", name: "English", primary: true, published: true },
            { locale: "de", name: "German", primary: false, published: true },
          ],
        },
      });
    }
    throw new Error(`No real Shopify request in tests: ${url.pathname}`);
  }) as typeof fetch;
  return { calls };
});

/**
 * Owner complimentary access: every feature without a subscription for the
 * operator's own stores, while AI usage stays metered and costed.
 */
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-api";
import type { LoaderFunctionArgs } from "react-router";
import {
  complimentaryUsageReport,
  grantComplimentaryAccess,
  revokeComplimentaryAccess,
} from "../../app/.server/billing/complimentary";
import { getBillingStatus, type BillingDeps } from "../../app/.server/billing/subscription";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { getMonthlyUsage, reserveUsage, settleUsage } from "../../app/.server/usage/usage-ledger";
import { chargeForResult } from "../../app/.server/usage/engine-charge";
import { resetConfigCache } from "../../app/.server/lib/config";
import { PLANS } from "../../app/lib/plans";
import { loader as planLoader } from "../../app/routes/app.plan";
import { sessionStorage } from "../../app/shopify.server";
import { ownerDb, resetDatabase } from "../support/db";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";
import { testEnv } from "../support/env";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const OWN = "gid://shopify/Shop/1001";
const OTHER = "gid://shopify/Shop/2002";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const shop = async (domain: string, gid: string | null) =>
  (await upsertInstalledShop({ shopDomain: domain, shopifyShopGid: gid }, app)).shop;

function deps(extra: Partial<BillingDeps> = {}): BillingDeps {
  // Billing required, and the merchant has no subscription.
  return { prisma: app, settings: PARTNER_SETTINGS, required: true, fetchImpl: fakePartnerApi(null).fetchImpl, complimentaryGids: [OWN], ...extra };
}

const grant = (gid = OWN, extra: Partial<Parameters<typeof grantComplimentaryAccess>[1]> = {}) =>
  grantComplimentaryAccess(ownerDb, { shopifyShopGid: gid, reason: "Operator's own store", operator: "owner", ...extra });

describe("owner complimentary access", () => {
  it("gives every feature without a subscription when granted AND configured", async () => {
    const s = await shop("own-store.myshopify.com", OWN);
    expect((await getBillingStatus(deps(), s)).mustChoosePlan).toBe(true);

    await grant(OWN, { monthlyCharLimit: 3_000_000 });
    const status = await getBillingStatus(deps(), s);
    expect(status).toMatchObject({
      configured: true,
      state: "COMPLIMENTARY",
      mustChoosePlan: false,
      entitlements: { plan: "complimentary", monthlyChars: 3_000_000, bulk: true, glossary: true, autoPublish: true, smartAuto: true, maxTargetLocales: 20 },
    });
  });

  it("does nothing without the server allowlist, or for another store", async () => {
    const own = await shop("own-store.myshopify.com", OWN);
    const other = await shop("customer.myshopify.com", OTHER);
    await grant(OWN);
    await grant(OTHER);
    // The database row alone isn't enough: OTHER isn't configured.
    expect((await getBillingStatus(deps(), other)).state).toBe("NONE");
    // Removing the GID from the configuration revokes access immediately.
    expect((await getBillingStatus(deps({ complimentaryGids: [] }), own)).state).toBe("NONE");
    // The allowlist alone isn't enough either.
    const listedOnly = await shop("listed-only.myshopify.com", "gid://shopify/Shop/3003");
    expect((await getBillingStatus(deps({ complimentaryGids: ["gid://shopify/Shop/3003"] }), listedOnly)).state).toBe("NONE");
  });

  it("ignores names, domains and e-mail addresses: only the Shopify GID counts", async () => {
    // Same name and a look-alike domain, different Shopify store.
    await shop("own-store.myshopify.com", OWN);
    await grant(OWN);
    const lookalike = await shop("own-store-1.myshopify.com", OTHER);
    await app.shop.update({ where: { id: lookalike.id }, data: { name: "Own store" } });
    expect((await getBillingStatus(deps(), lookalike)).state).toBe("NONE");
    // A shop whose stored GID doesn't match the grant (for example after a
    // re-link) loses access until the operator grants the new GID.
    const own = await app.shop.findUniqueOrThrow({ where: { shopifyShopGid: OWN } });
    await ownerDb.shop.update({ where: { id: own.id }, data: { shopifyShopGid: "gid://shopify/Shop/4004" } });
    const moved = await app.shop.findUniqueOrThrow({ where: { id: own.id } });
    expect((await getBillingStatus(deps({ complimentaryGids: [OWN, "gid://shopify/Shop/4004"] }), moved)).state).toBe("NONE");
  });

  it("ends on revocation or expiry, with audit entries", async () => {
    const s = await shop("own-store.myshopify.com", OWN);
    let now = new Date();
    await grant(OWN, { expiresAt: new Date(now.getTime() + 60_000) });
    expect((await getBillingStatus(deps({ now: () => now }), s)).state).toBe("COMPLIMENTARY");
    now = new Date(now.getTime() + 120_000);
    expect((await getBillingStatus(deps({ now: () => now }), s)).state).toBe("NONE");

    await grant(OWN);
    await revokeComplimentaryAccess(ownerDb, { shopifyShopGid: OWN, reason: "Store sold", operator: "owner" });
    expect((await getBillingStatus(deps(), s, { force: true })).state).toBe("NONE");
    await expect(revokeComplimentaryAccess(ownerDb, { shopifyShopGid: OWN, reason: "again", operator: "owner" })).rejects.toThrow(/no active/);

    const audit = await ownerDb.auditLog.findMany({ where: { shopId: s.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorId, a.targetId])).toEqual([
      ["complimentary_access.granted", "owner", OWN],
      ["complimentary_access.granted", "owner", OWN],
      ["complimentary_access.revoked", "owner", OWN],
    ]);
  });

  it("refuses unknown shops, malformed GIDs and missing reasons", async () => {
    await shop("own-store.myshopify.com", OWN);
    await expect(grant("gid://shopify/Shop/999")).rejects.toThrow(/No installed shop/);
    await expect(grant("own-store.myshopify.com")).rejects.toThrow(/Expected a shop GID/);
    await expect(grant(OWN, { reason: " " })).rejects.toThrow(/reason/);
    await expect(grant(OWN, { monthlyCharLimit: 0 })).rejects.toThrow(/between/);
    await expect(grant(OWN, { expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(/past/);
  });

  it("still meters AI usage and stops at the complimentary allowance, with an internal cost report", async () => {
    const s = await shop("own-store.myshopify.com", OWN);
    await grant(OWN, { monthlyCharLimit: 60 });
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    await setBulkPublishMode({ shopId: s.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const store = new FakeShopifyStore(3);
    const d: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 1_000_000,
      keyPrefix: "lv:test:complimentary",
      billingFor: async () => getBillingStatus(deps(), s),
    };
    const { job } = await createBulkJob({ shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "c-1" }, app);
    const page = await runDiscoveryPage(d, { shopId: s.id, jobId: job.id });
    // Bulk and automatic publishing work without a subscription.
    await processItem(d, { shopId: s.id, itemId: page.itemIds[0]! }, 1);
    expect(store.calls).toContain("LinguvaTranslationsRegister");
    await expect(processItem(d, { shopId: s.id, itemId: page.itemIds[1]! }, 1)).rejects.toMatchObject({ scope: "monthly", limit: 60 });

    const used = await getMonthlyUsage(s.id, undefined, app);
    expect(used).toBeGreaterThan(0);
    const report = await complimentaryUsageReport(ownerDb, { allowlist: [OWN], usdPerMillionChars: 25 });
    expect(report).toEqual([
      expect.objectContaining({ shopifyShopGid: OWN, active: true, chars: used, estimatedCostUsd: Math.round((used / 1e6) * 25 * 100) / 100 }),
    ]);
    expect(report[0]).not.toHaveProperty("byProvider");
  });

  it("reports characters and cost per engine when rates per engine are given (one engine: the same figure)", async () => {
    const s = await shop("own-store.myshopify.com", OWN);
    await grant(OWN);
    const single = await reserveUsage({ shopId: s.id, key: "deepl-only", chars: 400_000, limit: 10_000_000, provider: "deepl" }, app);
    await settleUsage(single, 400_000, app);
    const rates = { deepl: 25, azure: 10, google: 20 };
    const [deeplOnly] = await complimentaryUsageReport(ownerDb, { allowlist: [OWN], usdPerMillionChars: 25, ratesByProvider: rates });
    const [plain] = await complimentaryUsageReport(ownerDb, { allowlist: [OWN], usdPerMillionChars: 25 });
    expect(deeplOnly).toMatchObject({ chars: 400_000, byProvider: { deepl: 400_000 }, estimatedCostUsd: plain!.estimatedCostUsd });
    // Azure answered a second request: its characters at its own rate.
    const failover = await reserveUsage({ shopId: s.id, key: "azure", chars: 200_000, limit: 10_000_000, provider: "deepl" }, app);
    await settleUsage(failover, 200_000, app, chargeForResult({ provider: "azure", billedCharacters: 200_000 }));
    const [mixed] = await complimentaryUsageReport(ownerDb, { allowlist: [OWN], usdPerMillionChars: 25, ratesByProvider: rates });
    expect(mixed).toMatchObject({ chars: 600_000, byProvider: { deepl: 400_000, azure: 200_000 }, estimatedCostUsd: 12 });
  });

  it("prints the report with only MIGRATION_DATABASE_URL set, as documented (no other app variable)", async () => {
    const s = await shop("own-store.myshopify.com", OWN);
    await grant(OWN);
    const reservation = await reserveUsage({ shopId: s.id, key: "report", chars: 400_000, limit: 10_000_000, provider: "deepl" }, app);
    await settleUsage(reservation, 400_000, app);
    // The operator tool as `pnpm build:ops` bundles it, run in a clean environment.
    const bundle = await build({
      entryPoints: ["scripts/ops/complimentary.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      write: false,
      logLevel: "silent",
    });
    // Under node_modules, so the bundle's external packages (Prisma) resolve as from build/ops.
    const dir = join(process.cwd(), "node_modules", ".cache", "linguva-tests");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `complimentary-${process.pid}.mjs`);
    writeFileSync(file, bundle.outputFiles[0]!.text);
    try {
      const run = spawnSync(process.execPath, [file, "report"], {
        env: { PATH: process.env.PATH ?? "", MIGRATION_DATABASE_URL: testEnv.MIGRATION_DATABASE_URL!, COMPLIMENTARY_SHOP_GIDS: OWN },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(run.stderr).not.toMatch(/Invalid environment configuration/);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain("own-store.myshopify.com");
      expect(run.stdout).toContain("Estimate at 25 USD per million characters for DeepL (AI_COST_USD_PER_MILLION_CHARS).");
      expect(run.stdout).toContain("Estimate at 10 USD per million characters for Microsoft Azure");
      expect(run.stdout).toContain("Estimate at 20 USD per million characters for Google Cloud");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("keeps the plan's entitlements for everyone else", async () => {
    const s = await shop("customer.myshopify.com", OTHER);
    const status = await getBillingStatus(deps({ fetchImpl: fakePartnerApi({ handle: "starter" }).fetchImpl }), s);
    expect(status).toMatchObject({ state: "ACTIVE", entitlements: PLANS.starter });
  });
});

describe("the Plan page", () => {
  /** The Plan page's data as App Bridge requests it: the shop's session token, its offline session stored. */
  async function planPage(shopDomain: string) {
    await sessionStorage.storeSession(new Session({ id: `offline_${shopDomain}`, shop: shopDomain, state: "", isOnline: false, accessToken: "shpat_test" }));
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = { iss: `https://${shopDomain}/admin`, dest: `https://${shopDomain}`, aud: process.env.SHOPIFY_API_KEY, sub: "42", exp: now + 60, nbf: now - 5, iat: now - 5, jti: randomUUID(), sid: randomUUID() };
    const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}`;
    const token = `${unsigned}.${createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(unsigned).digest("base64url")}`;
    const request = new Request("https://linguva.test/app/plan", { headers: { Authorization: `Bearer ${token}` } });
    return planLoader({ request, params: {}, context: {} } as LoaderFunctionArgs);
  }

  it("sends the internal AI cost rate only to the owner's complimentary stores", async () => {
    await shop("own-store.myshopify.com", OWN);
    await shop("customer.myshopify.com", OTHER);
    await grant(OWN);
    vi.stubEnv("COMPLIMENTARY_SHOP_GIDS", OWN);
    resetConfigCache();
    try {
      const own = await planPage("own-store.myshopify.com");
      expect(own).toMatchObject({ state: "COMPLIMENTARY", costPerMillion: 25, choosePlanUrl: null });
      // Billing isn't configured here: every feature, but no internal figures.
      const customer = await planPage("customer.myshopify.com");
      expect(customer).toMatchObject({ configured: false, state: "ACTIVE", costPerMillion: null, choosePlanUrl: null });
      // The operator's platform-wide AI cap isn't any store's business.
      for (const data of [own, customer]) {
        expect(data.limits).not.toHaveProperty("platformDailyLimit");
        expect(data.languages?.items.map((l) => l.locale)).toEqual(["de"]);
      }
      // Each store's own languages were read from Shopify (the stand-in above).
      expect(shopify.calls).toEqual(["own-store.myshopify.com", "customer.myshopify.com"]);
    } finally {
      vi.unstubAllEnvs();
      resetConfigCache();
    }
  });
});
