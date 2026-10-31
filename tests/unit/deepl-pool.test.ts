import { beforeEach, describe, expect, it } from "vitest";

import { clearDeepLKeyPauses, DeepLKeyPool } from "../../app/.server/providers/deepl-pool";
import { deeplApiKeys } from "../../app/.server/lib/config";
import { TranslationProviderError } from "../../app/.server/providers/types";

const request = { segments: ["Hello"], sourceLocale: "en", targetLocale: "de" };

/** Answers per key (the last part of the Authorization header): a status, or 200 for a translation. */
function server(plan: Record<string, number[]>) {
  const used: string[] = [];
  const counters: Record<string, number> = {};
  const impl = (async (_url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>).Authorization!.replace("DeepL-Auth-Key ", "");
    used.push(key);
    const answers = plan[key] ?? [200];
    const status = answers[Math.min(counters[key] ?? 0, answers.length - 1)]!;
    counters[key] = (counters[key] ?? 0) + 1;
    if (status !== 200) return new Response("{}", { status });
    const body = JSON.parse(init.body as string) as { text: string[] };
    return Response.json({ translations: body.text.map((t) => ({ text: `DE:${t}`, billed_characters: t.length })) });
  }) as unknown as typeof fetch;
  return { impl, used };
}

const pool = (keys: string[], s: ReturnType<typeof server>, now = () => 1_000) =>
  new DeepLKeyPool(keys, { fetch: s.impl, retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 } }, now);

beforeEach(() => clearDeepLKeyPauses());

describe("DeepL key pool", () => {
  it("uses the first key while it works", async () => {
    const s = server({});
    const result = await pool(["k1", "k2"], s).translate(request);
    expect(result.translations).toEqual(["DE:Hello"]);
    expect(s.used).toEqual(["k1"]);
  });

  it("moves to the next key when a quota is used up, and remembers it", async () => {
    const s = server({ k1: [456], k2: [200] });
    const p = pool(["k1", "k2"], s);
    expect((await p.translate(request)).billedCharacters).toBe(5);
    expect(s.used).toEqual(["k1", "k2"]);
    await p.translate(request);
    // k1 rests: the second request goes straight to k2.
    expect(s.used).toEqual(["k1", "k2", "k2"]);
  });

  it("tries a resting key again after its pause", async () => {
    let t = 1_000;
    const s = server({ k1: [456, 200], k2: [200] });
    const p = pool(["k1", "k2"], s, () => t);
    await p.translate(request);
    t += 61 * 60 * 1000;
    await p.translate(request);
    expect(s.used).toEqual(["k1", "k2", "k1"]);
  });

  it("moves on when a key is refused", async () => {
    const s = server({ k1: [403], k2: [200] });
    await pool(["k1", "k2"], s).translate(request);
    expect(s.used).toEqual(["k1", "k2"]);
  });

  it("does not switch keys for an error the next key would repeat", async () => {
    const s = server({ k1: [400], k2: [200] });
    await expect(pool(["k1", "k2"], s).translate(request)).rejects.toMatchObject({ kind: "invalid" });
    expect(s.used).toEqual(["k1"]);
  });

  it("reports the quota error when every key is used up, and still tries them after a pause", async () => {
    const s = server({ k1: [456], k2: [456] });
    const p = pool(["k1", "k2"], s);
    await expect(p.translate(request)).rejects.toBeInstanceOf(TranslationProviderError);
    await expect(p.translate(request)).rejects.toMatchObject({ kind: "quota" });
    // With every key resting, all are tried again rather than failing without a call.
    expect(s.used).toEqual(["k1", "k2", "k1", "k2"]);
  });

  it("needs at least one key", () => {
    expect(() => new DeepLKeyPool([])).toThrow();
  });
});

describe("configured DeepL keys", () => {
  it("lists DEEPL_API_KEY first, then DEEPL_API_KEYS split by commas, spaces and line breaks, without repeats", () => {
    expect(deeplApiKeys({ DEEPL_API_KEY: "a:fx", DEEPL_API_KEYS: "b:fx, c:fx\nd:fx;a:fx" })).toEqual(["a:fx", "b:fx", "c:fx", "d:fx"]);
    expect(deeplApiKeys({ DEEPL_API_KEYS: '"x" y' })).toEqual(["x", "y"]);
    expect(deeplApiKeys({})).toEqual([]);
  });
});
