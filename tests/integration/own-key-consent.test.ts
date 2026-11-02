/**
 * The AI consent on the Own key plan (settings/shop-settings.ts, ai-consent.ts):
 * the own-key notice has its own version with exactly the shop's key tokens,
 * a consent to one notice never covers the other (a plan change in either
 * direction asks once), "already covered" counts only the same notice, and
 * there is nothing to allow before the first usable key.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { consentedEngines, getShopSettings, hasCurrentAiConsent, missingConsent, setAiConsent, textConsentTokens } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import type { ConsentToken } from "../../app/lib/engines";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const shop = async (domain: string) => (await upsertInstalledShop({ shopDomain: domain }, app)).shop;
const own = (configured: ConsentToken[]) => ({ configured, payer: "merchant" as const });

describe("the own-key notice", () => {
  it("a Pro shop's DeepL consent doesn't cover its own DeepL key, and the own-key consent doesn't cover Linguva's DeepL", async () => {
    const s = await shop("consent-switch.myshopify.com");
    // Linguva's notice, DeepL only (the legacy version, as every shop accepted it).
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app)).toBe("saved");
    let settings = await getShopSettings(s.id, app);
    expect(settings.consentVersion).toBe("2026-10-deepl-v1");
    expect(hasCurrentAiConsent(settings)).toBe(true);
    expect(hasCurrentAiConsent(settings, ["deepl"], "merchant")).toBe(false);
    expect(consentedEngines(settings, ["deepl"], "merchant")).toEqual([]);

    // On Own key with a DeepL key: asked once, the own-key notice.
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: "1", shown: ["deepl"], consent: own(["deepl"]) }, app)).toBe("saved");
    settings = await getShopSettings(s.id, app);
    expect(settings.consentVersion).toBe("2026-11-ownkey-v1:deepl");
    expect(hasCurrentAiConsent(settings, ["deepl"], "merchant")).toBe(true);
    expect(consentedEngines(settings, ["deepl"], "merchant")).toEqual(["deepl"]);
    // Back on Pro: Linguva's notice is asked for again.
    expect(hasCurrentAiConsent(settings)).toBe(false);
    expect(textConsentTokens(settings)).toEqual(["deepl"]);
  });

  it("adds a key's token to the own-key consent, never one from Linguva's notice", async () => {
    const s = await shop("consent-union.myshopify.com");
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: ["deepl"], consent: own(["deepl"]) }, app)).toBe("saved");
    // A Google key added: "Allow these too".
    const settings = await getShopSettings(s.id, app);
    expect(missingConsent(settings, ["deepl", "google-global"], "merchant")).toEqual(["google-global"]);
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: ["google-global"], consent: own(["google-global"]) }, app)).toBe("saved");
    expect((await getShopSettings(s.id, app)).consentVersion).toBe("2026-11-ownkey-v1:deepl,google-global");

    // Linguva's multi-engine notice earlier: its tokens don't carry over into the own-key version.
    const t = await shop("consent-union-2.myshopify.com");
    await setAiConsent({ shopId: t.id, granted: true, actorId: null, shown: ["deepl", "azure-eu"], consent: { configured: ["deepl", "azure-eu"], payer: "linguva" } }, app);
    expect((await getShopSettings(t.id, app)).consentVersion).toBe("2026-11-engines-v1:azure-eu,deepl");
    await setAiConsent({ shopId: t.id, granted: true, actorId: null, shown: ["google-global"], consent: own(["google-global"]) }, app);
    expect((await getShopSettings(t.id, app)).consentVersion).toBe("2026-11-ownkey-v1:google-global");
  });

  it("has nothing to allow before the first usable key, and needs the list the page showed", async () => {
    const s = await shop("consent-empty.myshopify.com");
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: [], consent: own([]) }, app)).toBe("changed");
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: null, consent: own(["deepl"]) }, app)).toBe("changed");
    // A page that showed only DeepL while the shop has an Azure key too: nothing stored.
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: ["deepl"], consent: own(["deepl", "azure-global"]) }, app)).toBe("changed");
    expect((await getShopSettings(s.id, app)).consentVersion).toBeNull();
    // Withdrawing clears it, as for Linguva's notice.
    await setAiConsent({ shopId: s.id, granted: true, actorId: null, shown: ["deepl"], consent: own(["deepl"]) }, app);
    await setAiConsent({ shopId: s.id, granted: false, actorId: null, consent: own(["deepl"]) }, app);
    expect(await getShopSettings(s.id, app)).toMatchObject({ consentVersion: null, aiDataProcessingConsentAt: null });
  });
});
