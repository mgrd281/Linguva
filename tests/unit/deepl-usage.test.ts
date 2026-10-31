import { beforeEach, describe, expect, it } from "vitest";

import { getConfig, isOperatorShop } from "../../app/.server/lib/config";
import { clearDeepLKeyPauses, DeepLKeyPool } from "../../app/.server/providers/deepl-pool";
import { clearDeepLUsageCache, deeplKeysUsage } from "../../app/.server/providers/deepl-usage";
import { shareLeft } from "../../app/components/DeepLQuota";

/** /v2/usage per key; any other path translates (or answers 456 for "spent"). */
function server(usage: Record<string, { status?: number; count?: number; limit?: number }>) {
  const calls: string[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>).Authorization!.replace("DeepL-Auth-Key ", "");
    calls.push(`${key} ${new URL(url).pathname}`);
    const u = usage[key] ?? {};
    if (new URL(url).pathname === "/v2/translate") {
      return key === "spent:fx" ? new Response("{}", { status: 456 }) : Response.json({ translations: [{ text: "Hello", billed_characters: 5 }] });
    }
    if (u.status && u.status !== 200) return new Response("{}", { status: u.status });
    return Response.json({ character_count: u.count ?? 0, character_limit: u.limit ?? 0 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  clearDeepLUsageCache();
  clearDeepLKeyPauses();
});

describe("DeepL keys' usage", () => {
  it("reads each key's usage in order, with plan and a four-character hint only", async () => {
    const s = server({ "aaaa1234:fx": { count: 250_000, limit: 1_000_000 }, "bbbb5678": { count: 7, limit: 0 } });
    const usage = await deeplKeysUsage(["aaaa1234:fx", "bbbb5678"], { fetch: s.impl });
    expect(usage).toEqual([
      { position: 1, plan: "free", hint: "1234", used: 250_000, limit: 1_000_000, state: "ok" },
      { position: 2, plan: "pro", hint: "5678", used: 7, limit: null, state: "ok" },
    ]);
    expect(shareLeft(usage[0]!)).toBe(75);
    expect(shareLeft(usage[1]!)).toBeNull();
  });

  it("says refused or unreachable instead of a figure", async () => {
    const s = server({ "bad:fx": { status: 403 }, "down:fx": { status: 503 } });
    const usage = await deeplKeysUsage(["bad:fx", "down:fx"], { fetch: s.impl });
    expect(usage.map((u) => [u.state, u.used])).toEqual([
      ["refused", null],
      ["unreachable", null],
    ]);
  });

  it("asks DeepL at most every two minutes per key", async () => {
    let t = 1_000;
    const s = server({ "k:fx": { count: 1, limit: 10 } });
    await deeplKeysUsage(["k:fx"], { fetch: s.impl, now: () => t });
    t += 60_000;
    await deeplKeysUsage(["k:fx"], { fetch: s.impl, now: () => t });
    expect(s.calls).toHaveLength(1);
    t += 2 * 60_000;
    await deeplKeysUsage(["k:fx"], { fetch: s.impl, now: () => t });
    expect(s.calls).toHaveLength(2);
  });

  it("marks a key the pool moved on from as resting", async () => {
    const s = server({ "spent:fx": { count: 10, limit: 10 } });
    await new DeepLKeyPool(["spent:fx", "next:fx"], { fetch: s.impl, retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 } }).translate({
      segments: ["Hallo"],
      sourceLocale: "de",
      targetLocale: "en",
    });
    const usage = await deeplKeysUsage(["spent:fx", "next:fx"], { fetch: s.impl });
    expect(usage.map((u) => u.state)).toEqual(["resting", "ok"]);
  });
});

describe("operator stores", () => {
  const env = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`, NODE_ENV: "test" };
  const config = (extra: Record<string, string>) => getConfig({ ...env, ...extra } as NodeJS.ProcessEnv);

  it("are only the stores listed in OPERATOR_SHOPS", () => {
    const c = config({ OPERATOR_SHOPS: "karinex.myshopify.com, other.myshopify.com" });
    expect(isOperatorShop("karinex.myshopify.com", c)).toBe(true);
    expect(isOperatorShop("KARINEX.myshopify.com", c)).toBe(true);
    expect(isOperatorShop("merchant.myshopify.com", c)).toBe(false);
    expect(isOperatorShop("", c)).toBe(false);
  });

  it("are none without the list", () => {
    expect(isOperatorShop("karinex.myshopify.com", config({}))).toBe(false);
  });
});
