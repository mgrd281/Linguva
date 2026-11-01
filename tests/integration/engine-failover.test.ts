/**
 * Background jobs with several translation engines (docs/AI_ENGINES.md):
 * failover keeps a job running, the ledger charges the engine that answered,
 * a DeepL-only consent never reaches another engine, a cancelled job stops
 * before the next engine, a dropped form of address waits in Review, and a
 * field one engine couldn't keep the markup of is tried again by another.
 * Fake engines (no network); fictional credentials only make the
 * configuration list the engines for consent.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelJob, createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { classifyError } from "../../app/.server/jobs/errors";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { resetConfigCache } from "../../app/.server/lib/config";
import { clearEngineRests, EngineRouter } from "../../app/.server/providers/engine-router";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { TranslationProviderError, type TranslationProvider, type TranslationRequest, type TranslationResult } from "../../app/.server/providers/types";
import { pendingDraftDigests, recordRejectedAttempts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode, setTranslationStyle } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { runEditorAction } from "../../app/.server/translation/resource-editor";
import { getMonthlyUsage, getMonthlyUsageByProvider } from "../../app/.server/usage/usage-ledger";
import type { EngineId } from "../../app/lib/engines";
import { ownerDb, resetDatabase } from "../support/db";
import { FAKE_AZURE_KEY } from "../support/engine-fixtures";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DOMAIN = "engines.myshopify.com";

/** A fake engine: the mock's pseudo-translation under its own id, or the errors it is told to throw. */
class FakeEngine implements TranslationProvider {
  readonly calls: TranslationRequest[] = [];
  private readonly mock = new MockTranslationProvider();
  readonly capabilities?: { formality: boolean; context: boolean };
  constructor(
    readonly id: EngineId,
    private readonly fail: Array<{ kind: TranslationProviderError["kind"]; billed?: number }> = [],
    private readonly options: { dropFormality?: boolean; during?: () => Promise<void> } = {},
  ) {
    // DeepL declares nothing (it applies everything); the others have no form of address.
    if (id !== "deepl") this.capabilities = { formality: false, context: false };
  }
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(request);
    await this.options.during?.();
    const failure = this.fail[this.calls.length - 1] ?? this.fail.at(-1);
    if (failure) {
      const error = new TranslationProviderError(this.id, failure.kind, "fake");
      if (failure.billed) error.billedCharacters = failure.billed;
      throw error;
    }
    const result = await this.mock.translate(request);
    return { ...result, provider: this.id, ...(this.options.dropFormality && request.formality ? { dropped: ["formality" as const] } : {}) };
  }
}

const router = (...engines: FakeEngine[]) => new EngineRouter(engines.map((e) => ({ id: e.id, provider: e })));

beforeEach(async () => {
  await resetDatabase();
  clearEngineRests();
  // DeepL and Azure (EU) are the engines in use: what consent and texts are about.
  vi.stubEnv("DEEPL_API_KEY", "fictional-deepl-key:fx");
  vi.stubEnv("AZURE_TRANSLATOR_KEY", FAKE_AZURE_KEY);
  vi.stubEnv("AZURE_TRANSLATOR_REGION", "westeurope");
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(provider: TranslationProvider, options: { consent?: readonly string[] | null; mode?: "DRAFT" | "AUTO_PUBLISH" } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  if (options.consent && options.consent.length === 1 && options.consent[0] === "deepl") {
    // Allowed while DeepL was the only engine, before Azure was added (a page from then shows DeepL only).
    expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: ["deepl"] }, app)).toBe("changed");
    vi.stubEnv("AZURE_TRANSLATOR_KEY", "");
    resetConfigCache();
    expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app)).toBe("saved");
    vi.stubEnv("AZURE_TRANSLATOR_KEY", FAKE_AZURE_KEY);
    resetConfigCache();
  } else if (options.consent !== null) {
    const saved = await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: options.consent ?? ["deepl", "azure-eu"] }, app);
    expect(saved).toBe("saved");
  }
  if (options.mode === "AUTO_PUBLISH") await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: null }, app);
  const store = new FakeShopifyStore(2);
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:engines", cancelPollMs: 10 };
  const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "engines-1" }, app);
  const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
  return { shop, store, deps, job, itemIds: page.itemIds };
}

const drafts = (shopId: string) => withTenant(shopId, (tx) => tx.translationDraft.findMany({ where: { shopId }, select: { provider: true, status: true, issues: true } }), app);
const jobOf = (shopId: string, jobId: string) => withTenant(shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: jobId } }), app);

describe("jobs with several engines", () => {
  it("keeps a job running when DeepL's quota is used up: Azure translates, drafts and the ledger say so", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }]);
    const azure = new FakeEngine("azure");
    const { shop, deps, job, itemIds } = await setup(router(deepl, azure));
    const outcome = await processItem(deps, { shopId: shop.id, itemId: itemIds[0]! }, 1);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(azure.calls).toHaveLength(1);
    expect((await jobOf(shop.id, job.id)).status).not.toMatch(/FAILED|CANCELLED/);
    const rows = await drafts(shop.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.provider === "azure")).toBe(true);
    const byProvider = await getMonthlyUsageByProvider(shop.id, undefined, app);
    expect(byProvider.azure).toBeGreaterThan(0);
    expect(byProvider.deepl ?? 0).toBe(0);
    // The next item goes straight to Azure while DeepL rests.
    await processItem(deps, { shopId: shop.id, itemId: itemIds[1]! }, 1);
    expect(deepl.calls).toHaveLength(1);
    expect(azure.calls).toHaveLength(2);
  });

  it("stops the job with PROVIDER_QUOTA only when every engine's quota is used up", async () => {
    const { shop, deps, itemIds } = await setup(router(new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure", [{ kind: "quota" }])));
    const error = await processItem(deps, { shopId: shop.id, itemId: itemIds[0]! }, 1).catch((e: unknown) => e);
    expect(classifyError(error)).toMatchObject({ kind: "job-stop", code: "PROVIDER_QUOTA" });
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
  });

  it("never sends a DeepL-only consent's texts to Azure", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }]);
    const azure = new FakeEngine("azure");
    const { shop, deps, itemIds } = await setup(router(deepl, azure), { consent: ["deepl"] });
    // The consent stored is DeepL's: the version shops accepted before.
    const settings = await withTenant(shop.id, (tx) => tx.shopSettings.findFirstOrThrow({ where: { shopId: shop.id } }), app);
    expect(settings.consentVersion).toBe("2026-10-deepl-v1");
    const error = await processItem(deps, { shopId: shop.id, itemId: itemIds[0]! }, 1).catch((e: unknown) => e);
    // DeepL's own error, unchanged: the shop's only engine is used up.
    expect(error).toMatchObject({ provider: "deepl", kind: "quota" });
    expect(azure.calls).toHaveLength(0);
    expect(deepl.calls[0]!.engines).toEqual(["deepl"]);
  });

  it("calls no further engine for a job cancelled while the first one fails, and bills only what it billed", async () => {
    let shopId = "";
    let jobId = "";
    const deepl = new FakeEngine("deepl", [{ kind: "quota", billed: 3 }], {
      during: async () => {
        await cancelJob(shopId, jobId, app);
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
    });
    const azure = new FakeEngine("azure");
    const { shop, deps, job, itemIds } = await setup(router(deepl, azure));
    shopId = shop.id;
    jobId = job.id;
    const error = await processItem(deps, { shopId: shop.id, itemId: itemIds[0]! }, 1).catch((e: unknown) => e);
    expect(azure.calls).toHaveLength(0);
    // Untried engines count as only down: no quota stop for engines that weren't asked.
    expect(classifyError(error).kind).not.toBe("job-stop");
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(3);
  });

  it("never publishes a result whose form of address was dropped, and writes no machine memory", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }]);
    const azure = new FakeEngine("azure", [], { dropFormality: true });
    const { shop, store, deps, itemIds } = await setup(router(deepl, azure), { mode: "AUTO_PUBLISH" });
    await setTranslationStyle({ shopId: shop.id, formality: { de: "more" }, storeContext: "", allowedLocales: ["de"] }, app);
    await processItem(deps, { shopId: shop.id, itemId: itemIds[0]! }, 1);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    const rows = await drafts(shop.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(JSON.stringify(row.issues)).toContain("FORMALITY_NOT_APPLIED");
    const memory = await withTenant(shop.id, (tx) => tx.translationMemory.count({ where: { shopId: shop.id } }), app);
    expect(memory).toBe(0);
  });
});

describe("a refusal because an engine couldn't keep the markup", () => {
  it("holds the field while that engine is planned and frees it once another engine serves the language", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    const gid = "gid://shopify/Product/1";
    await recordRejectedAttempts(
      shop.id,
      [{ jobId: null, resourceGid: gid, parentGid: null, resourceTitle: "Jacket", locale: "de", key: "body_html", sourceDigest: "d1", sourceValue: "<p>x</p>", issues: [], provider: "azure", currentDigest: null, valueType: "HTML", reason: "ENGINE_MARKUP" }],
      app,
    );
    const held = (options: { includeRefused?: boolean; engine?: string }) => pendingDraftDigests(shop.id, [gid], "de", app, options);
    expect((await held({ includeRefused: true, engine: "azure" })).get(`${gid}|body_html`)).toBe("d1");
    expect((await held({ includeRefused: true, engine: "deepl" })).has(`${gid}|body_html`)).toBe(false);
    // A caller that can't tell the engine re-sends nothing (today's rule for every refusal).
    expect((await held({ includeRefused: true })).get(`${gid}|body_html`)).toBe("d1");
    // A translation the merchant starts tries refused fields again anyway.
    expect((await held({ includeRefused: false })).has(`${gid}|body_html`)).toBe(false);
  });
});

describe("consent for several engines (setAiConsent)", () => {
  const consentOf = (shopId: string) =>
    withTenant(shopId, (tx) => tx.shopSettings.findFirstOrThrow({ where: { shopId }, select: { consentVersion: true, aiDataProcessingConsentAt: true } }), app);
  const grants = (shopId: string) => ownerDb.auditLog.count({ where: { shopId, action: "ai_consent.granted" } });

  it("stores nothing for a missing or stale list while Azure is configured beside DeepL", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    // No list (a page that showed nothing) and DeepL's list from before Azure was added.
    for (const shown of [null, ["deepl"]]) {
      expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: "7", shown }, app)).toBe("changed");
      expect(await consentOf(shop.id)).toEqual({ consentVersion: null, aiDataProcessingConsentAt: null });
      expect(await grants(shop.id)).toBe(0);
    }
  });

  it("stores the engines version for the full list, in any order", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: "7", shown: ["azure-eu", "deepl"] }, app)).toBe("saved");
    const consent = await consentOf(shop.id);
    expect(consent.consentVersion).toBe("2026-11-engines-v1:azure-eu,deepl");
    expect(consent.aiDataProcessingConsentAt).not.toBeNull();
    expect(await grants(shop.id)).toBe(1);
  });

  it("accepts a missing list only while DeepL is the only engine", async () => {
    vi.stubEnv("AZURE_TRANSLATOR_KEY", "");
    resetConfigCache();
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: "7", shown: null }, app)).toBe("saved");
    expect((await consentOf(shop.id)).consentVersion).toBe("2026-10-deepl-v1");
  });

  it("withdraws whatever list the page sent (only grants are refused)", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "7", shown: ["deepl", "azure-eu"] }, app);
    for (const shown of [null, ["deepl"]]) {
      expect(await setAiConsent({ shopId: shop.id, granted: false, actorId: "7", shown }, app)).toBe("saved");
      expect(await consentOf(shop.id)).toEqual({ consentVersion: null, aiDataProcessingConsentAt: null });
    }
  });

  it("answers CONSENT_CHANGED in the editor when its form sent no list", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
    const form = new FormData();
    form.set("intent", "grant-consent");
    const ctx = { admin: {}, shopId: shop.id, actorId: "7", resourceId: "gid://shopify/Product/1", target: "de" } as unknown as Parameters<typeof runEditorAction>[0];
    expect(await runEditorAction(ctx, form)).toEqual({ kind: "error", code: "CONSENT_CHANGED" });
    expect((await consentOf(shop.id)).consentVersion).toBeNull();
  });
});
