import { describe, expect, it } from "vitest";
import {
  DeepLProvider,
  deeplSourceLang,
  deeplTargetLang,
} from "../../app/.server/providers/deepl";
import { withRetry } from "../../app/.server/providers/retry";
import { TranslationProviderError } from "../../app/.server/providers/types";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(responses: Array<(body: { text: string[] }) => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : {};
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const respond = responses[Math.min(i++, responses.length - 1)]!;
    return respond(body);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (body: { text: string[] }) =>
  Response.json({
    translations: body.text.map((t) => ({ text: `DE:${t}`, billed_characters: t.length })),
  });

const noSleep = { sleep: async () => undefined };

describe("DeepL language codes", () => {
  it("maps Shopify locales to DeepL codes", () => {
    expect(deeplSourceLang("en-US")).toBe("EN");
    expect(deeplTargetLang("en")).toBe("EN-US");
    expect(deeplTargetLang("en-GB")).toBe("EN-GB");
    expect(deeplTargetLang("pt-BR")).toBe("PT-BR");
    expect(deeplTargetLang("pt")).toBe("PT-PT");
    expect(deeplTargetLang("zh-TW")).toBe("ZH-HANT");
    expect(deeplTargetLang("zh-CN")).toBe("ZH-HANS");
    expect(deeplTargetLang("ar")).toBe("AR");
    expect(deeplTargetLang("uk")).toBe("UK");
  });
});

describe("DeepLProvider", () => {
  it("sends XML tag handling, auth header and source/target languages", async () => {
    const { impl, calls } = fakeFetch([ok]);
    const provider = new DeepLProvider({ apiKey: "key:fx", fetch: impl });
    const result = await provider.translate({
      segments: ['Buy <g id="1">now</g>'],
      sourceLocale: "en",
      targetLocale: "de",
      context: "Product: Shoe",
    });
    expect(result).toEqual({
      translations: ['DE:Buy <g id="1">now</g>'],
      billedCharacters: 21,
      provider: "deepl",
    });
    expect(calls[0]!.url).toBe("https://api-free.deepl.com/v2/translate");
    expect(calls[0]!.headers.Authorization).toBe("DeepL-Auth-Key key:fx");
    expect(calls[0]!.body).toMatchObject({
      source_lang: "EN",
      target_lang: "DE",
      tag_handling: "xml",
      ignore_tags: ["x"],
      context: "Product: Shoe",
    });
  });

  it("asks for the configured form of address, falling back where a language has none", async () => {
    const { impl, calls } = fakeFetch([ok, ok]);
    const provider = new DeepLProvider({ apiKey: "key:fx", fetch: impl });
    await provider.translate({ segments: ["Hello"], sourceLocale: "en", targetLocale: "de", formality: "less" });
    await provider.translate({ segments: ["Hello"], sourceLocale: "en", targetLocale: "de" });
    // prefer_*: never fails for languages without formal/informal forms (DeepL API reference).
    expect(calls[0]!.body.formality).toBe("prefer_less");
    expect(calls[1]!.body).not.toHaveProperty("formality");
  });

  it("uses the Pro endpoint for non-free keys", async () => {
    const { impl, calls } = fakeFetch([ok]);
    await new DeepLProvider({ apiKey: "pro-key", fetch: impl }).translate({
      segments: ["a"],
      sourceLocale: "de",
      targetLocale: "en",
    });
    expect(calls[0]!.url).toBe("https://api.deepl.com/v2/translate");
  });

  it("splits large inputs into several requests and keeps order", async () => {
    const { impl, calls } = fakeFetch([ok]);
    const segments = Array.from({ length: 120 }, (_, i) => `text ${i}`);
    const result = await new DeepLProvider({ apiKey: "k", fetch: impl }).translate({
      segments,
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(calls.length).toBe(3);
    expect(result.translations).toEqual(segments.map((s) => `DE:${s}`));
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { impl, calls } = fakeFetch([
      () => new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      () => new Response(null, { status: 503 }),
      ok,
    ]);
    const result = await new DeepLProvider({ apiKey: "k", fetch: impl, retry: noSleep }).translate({
      segments: ["hello"],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(calls.length).toBe(3);
    expect(result.translations).toEqual(["DE:hello"]);
  });

  it.each([
    [456, "quota"],
    [403, "auth"],
    [400, "invalid"],
  ])("does not retry HTTP %i (%s)", async (status, kind) => {
    const { impl, calls } = fakeFetch([() => new Response("secret body", { status })]);
    const promise = new DeepLProvider({ apiKey: "k", fetch: impl, retry: noSleep }).translate({
      segments: ["hello"],
      sourceLocale: "en",
      targetLocale: "de",
    });
    await expect(promise).rejects.toMatchObject({ kind, status });
    await expect(promise).rejects.not.toThrow(/secret body/);
    expect(calls.length).toBe(1);
  });

  it("gives up after the retry budget", async () => {
    const { impl, calls } = fakeFetch([() => new Response(null, { status: 500 })]);
    await expect(
      new DeepLProvider({ apiKey: "k", fetch: impl, retry: { ...noSleep, retries: 2 } }).translate({
        segments: ["x"],
        sourceLocale: "en",
        targetLocale: "de",
      }),
    ).rejects.toBeInstanceOf(TranslationProviderError);
    expect(calls.length).toBe(3);
  });

  it("rejects responses with the wrong number of translations", async () => {
    const { impl } = fakeFetch([() => Response.json({ translations: [] })]);
    await expect(
      new DeepLProvider({ apiKey: "k", fetch: impl, retry: { ...noSleep, retries: 0 } }).translate({
        segments: ["x"],
        sourceLocale: "en",
        targetLocale: "de",
      }),
    ).rejects.toThrow(/malformed/);
  });
});

describe("withRetry", () => {
  it("uses capped exponential backoff with jitter", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new TranslationProviderError("p", "retryable", "x");
        },
        {
          retries: 4,
          baseDelayMs: 100,
          maxDelayMs: 500,
          random: () => 1,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(5);
    expect(delays).toEqual([100, 200, 400, 500]);
  });
});

describe("DeepLProvider.getUsage", () => {
  it("reads character count and limit from the usage endpoint", async () => {
    const { impl, calls } = fakeFetch([() => Response.json({ character_count: 1200, character_limit: 500000 })]);
    const usage = await new DeepLProvider({ apiKey: "free-key:fx", fetch: impl }).getUsage();
    expect(usage).toEqual({ characterCount: 1200, characterLimit: 500000 });
    expect(calls[0]!.url).toBe("https://api-free.deepl.com/v2/usage");
  });

  it("reports an invalid key as an auth error", async () => {
    const { impl } = fakeFetch([() => new Response(null, { status: 403 })]);
    await expect(new DeepLProvider({ apiKey: "k:fx", fetch: impl }).getUsage()).rejects.toMatchObject({ kind: "auth" });
  });
});
