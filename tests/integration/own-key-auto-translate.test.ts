/**
 * Automatic translation on the Own key plan (jobs/auto-translate.ts,
 * jobs/auto-sweep.ts): items are created only when the own-key consent covers
 * the shop's own keys (a Google-only shop translates with Google; no key, no
 * item), a pause follows the payer (a Pro pause for the used-up allowance
 * doesn't hold a shop that moved to Own key, an own key's pause doesn't hold
 * a shop that moved to Pro: the sweep clears it), and Pro shops are unchanged.
 * Mock mode (the test environment): own members are offline mocks under the
 * engine's id, the operator's provider is the plain mock.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { sweepChangedContent } from "../../app/.server/jobs/auto-sweep";
import { createAutoItems, queueAutoTranslate, type AutoTranslatePayload } from "../../app/.server/jobs/auto-translate";
import { processItem, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { ownKeyTranslation } from "../../app/.server/providers/shop-translation";
import { autoPauseAfterStop, getShopSettings, setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import type { ConsentToken } from "../../app/lib/engines";
import { OWN_KEY_PLAN, PLANS, type Entitlements } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const minutes = (n: number) => n * 60_000;

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

type Billing = { configured: boolean; entitlements: Entitlements };

function world() {
  const billing = new Map<string, Billing>();
  const store = new FakeShopifyStore(2);
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    ownKeyTranslation: (shopId, settings) => ownKeyTranslation(shopId, { settings, client: app }),
    monthlyLimit: 1_000_000,
    billingFor: async (shopId) => billing.get(shopId) ?? { configured: true, entitlements: PLANS.pro },
    keyPrefix: "lv:test:own-auto",
  };
  return { billing, store, deps };
}

function fakeQueue() {
  const added: AutoTranslatePayload[] = [];
  return { added, queue: { add: async (_: string, data: AutoTranslatePayload) => void added.push(data) } };
}

async function shop(domain: string, options: { own?: { keys: Array<{ engine: string; apiKey: string }>; consent?: ConsentToken[] }; operatorConsent?: boolean } = {}) {
  const { shop: s } = await upsertInstalledShop({ shopDomain: domain }, app);
  for (const key of options.own?.keys ?? []) await seedOwnKey(s.id, key, { client: app, mode: "mock" });
  if (options.own?.consent?.length) {
    const tokens = options.own.consent;
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: tokens, consent: { configured: tokens, payer: "merchant" } }, app)).toBe("saved");
  }
  if (options.operatorConsent) await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
  await setAutoTranslate({ shopId: s.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
  return s;
}

const drafts = (shopId: string) => withTenant(shopId, (tx) => tx.translationDraft.findMany({ select: { provider: true } }), app);

describe("automatic translation on the Own key plan", () => {
  it("creates items for a Google-only shop with the own-key consent, and translates them with Google", async () => {
    const w = world();
    const s = await shop("auto-google.myshopify.com", { own: { keys: [{ engine: "google", apiKey: "mock-google-1" }], consent: ["google-global"] } });
    w.billing.set(s.id, { configured: true, entitlements: OWN_KEY_PLAN });
    const created = await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor);
    expect(created.itemIds).toHaveLength(1);
    expect(await processItem(w.deps, { shopId: s.id, itemId: created.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const rows = await drafts(s.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.provider === "google")).toBe(true);
  });

  it("creates no item without a key, nor with a consent to Linguva's notice only", async () => {
    const w = world();
    const none = await shop("auto-none.myshopify.com", { operatorConsent: true });
    w.billing.set(none.id, { configured: true, entitlements: OWN_KEY_PLAN });
    expect(await createAutoItems(app, { shopId: none.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor)).toEqual({ itemIds: [], reused: [], busy: false });
    // A key, but the store allowed Linguva's notice only (it came from another plan): asked once for the own-key notice.
    const old = await shop("auto-old-consent.myshopify.com", { own: { keys: [{ engine: "deepl", apiKey: "mock-deepl-1:fx" }] }, operatorConsent: true });
    w.billing.set(old.id, { configured: true, entitlements: OWN_KEY_PLAN });
    expect(await createAutoItems(app, { shopId: old.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor)).toEqual({ itemIds: [], reused: [], busy: false });
  });

  it("leaves a Pro shop as it was (Linguva's consent, the operator's provider)", async () => {
    const w = world();
    const s = await shop("auto-pro.myshopify.com", { operatorConsent: true });
    const created = await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor);
    expect(created.itemIds).toHaveLength(1);
    expect(await processItem(w.deps, { shopId: s.id, itemId: created.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await drafts(s.id)).every((d) => d.provider === "mock")).toBe(true);
  });
});

describe("pauses follow the payer", () => {
  it("upgrade while QUOTA_EXCEEDED: a Pro shop paused until the 1st moves to Own key with a key, the sweep clears the pause", async () => {
    const w = world();
    const s = await shop("auto-upgrade.myshopify.com", { own: { keys: [{ engine: "deepl", apiKey: "mock-deepl-2:fx" }], consent: ["deepl"] } });
    const start = (await getShopSettings(s.id, app)).autoSweptAt!;
    await autoPauseAfterStop(s.id, "QUOTA_EXCEEDED", new Date(), app);
    expect((await getShopSettings(s.id, app)).autoPauseReason).toBe("QUOTA_EXCEEDED");
    // While on Pro the pause holds: no item.
    expect((await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor)).itemIds).toEqual([]);

    w.billing.set(s.id, { configured: true, entitlements: OWN_KEY_PLAN });
    w.store.touch(P1, new Date(start.getTime() + minutes(5)));
    const { added, queue } = fakeQueue();
    const summary = await sweepChangedContent({ ...w.deps }, queue, new Date(start.getTime() + minutes(30)));
    expect(summary).toMatchObject({ shops: 1, failed: 0 });
    expect(added.map((a) => a.resourceGid)).toContain(P1);
    expect(await getShopSettings(s.id, app)).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
    const created = await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor);
    expect(created.itemIds).toHaveLength(1);
    expect(await processItem(w.deps, { shopId: s.id, itemId: created.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await drafts(s.id)).every((d) => d.provider === "deepl")).toBe(true);
  });

  it("downgrade while OWN_KEY_AUTH_DEEPL: an own-key shop paused for 30 days moves to Pro, the sweep clears it and the operator translates", async () => {
    const w = world();
    const s = await shop("auto-downgrade.myshopify.com", { own: { keys: [{ engine: "deepl", apiKey: "mock-deepl-3:fx" }], consent: ["deepl"] }, operatorConsent: true });
    const start = (await getShopSettings(s.id, app)).autoSweptAt!;
    w.billing.set(s.id, { configured: true, entitlements: OWN_KEY_PLAN });
    const until = await autoPauseAfterStop(s.id, "OWN_KEY_AUTH_DEEPL", new Date(), app);
    expect(until!.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * minutes(1));
    // On Own key the pause holds.
    expect((await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor)).itemIds).toEqual([]);
    const held = fakeQueue();
    await sweepChangedContent({ ...w.deps }, held.queue, new Date(start.getTime() + minutes(10)));
    expect(held.added).toEqual([]);
    expect((await getShopSettings(s.id, app)).autoPauseReason).toBe("OWN_KEY_AUTH_DEEPL");

    // Moved to Pro (with Linguva's consent too): the webhook gate (no billing read) still says paused once…
    w.billing.set(s.id, { configured: true, entitlements: PLANS.pro });
    const webhook = fakeQueue();
    expect(await queueAutoTranslate({ shopDomain: "auto-downgrade.myshopify.com", topic: "products/update", payload: { admin_graphql_api_id: P1 } }, { queue: webhook.queue, prisma: app })).toBe("paused");
    // …and the sweep clears the pause and picks the change up.
    w.store.touch(P1, new Date(start.getTime() + minutes(15)));
    const { added, queue } = fakeQueue();
    await sweepChangedContent({ ...w.deps }, queue, new Date(start.getTime() + minutes(30)));
    expect(added.map((a) => a.resourceGid)).toContain(P1);
    expect(await getShopSettings(s.id, app)).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
    const created = await createAutoItems(app, { shopId: s.id, resourceGid: P1, resourceType: "PRODUCT" }, w.deps.billingFor);
    expect(created.itemIds).toHaveLength(1);
    expect(await processItem(w.deps, { shopId: s.id, itemId: created.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await drafts(s.id)).every((d) => d.provider === "mock")).toBe(true);
  });

  it("a Pro shop's own pause still holds it on Pro (unchanged)", async () => {
    const w = world();
    const s = await shop("auto-pro-pause.myshopify.com", { operatorConsent: true });
    const start = (await getShopSettings(s.id, app)).autoSweptAt!;
    await autoPauseAfterStop(s.id, "PROVIDER_QUOTA", new Date(), app);
    w.store.touch(P1, new Date(start.getTime() + minutes(5)));
    const { added, queue } = fakeQueue();
    await sweepChangedContent({ ...w.deps }, queue, new Date(start.getTime() + minutes(30)));
    expect(added).toEqual([]);
    expect((await getShopSettings(s.id, app)).autoPauseReason).toBe("PROVIDER_QUOTA");
  });
});
