/**
 * A fake of the three engines' HTTP APIs for the Own key plan's tests: the
 * merchant's keys (and fictional operator keys) are accepted or refused per
 * key, and every request is recorded, so a test can prove which key and host
 * each call used. Any host other than DeepL's two, Azure Translator's two
 * and Google's v2 throws. No real engine is ever reached.
 */

export type FakeKeyBehaviour = "ok" | "quota" | "refused" | "down";

export interface FakeEngineSpec {
  /** Accepted keys and how each answers; a key not listed is refused. */
  deepl?: Record<string, FakeKeyBehaviour | { behaviour?: FakeKeyBehaviour; usage?: { count: number; limit: number } }>;
  azure?: Record<string, FakeKeyBehaviour>;
  google?: Record<string, FakeKeyBehaviour | "rate-limited" | "service-disabled">;
  /** How texts translate (default: "[<to>] <text>"). */
  translate?: (texts: string[], to: string) => string[];
}

export interface FakeEngineCall {
  host: string;
  path: string;
  method: string;
  /** The credential header as sent: DeepL Authorization, Azure Ocp-Apim-Subscription-Key, Google X-goog-api-key. */
  authHeader: string | null;
  region: string | null;
  body: string | null;
}

const DEEPL_HOSTS = new Set(["api.deepl.com", "api-free.deepl.com"]);
const AZURE_HOSTS = new Set(["api-eur.cognitive.microsofttranslator.com", "api.cognitive.microsofttranslator.com"]);
const GOOGLE_HOST = "translation.googleapis.com";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const errorInfo = (reason: string) => ({ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason });

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = new Headers(init?.headers);
  return headers.get(name);
}

const defaultTranslate = (texts: string[], to: string) => texts.map((t) => `[${to}] ${t}`);

export function fakeEngineFetch(spec: FakeEngineSpec): { fetch: typeof fetch; calls: FakeEngineCall[] } {
  const calls: FakeEngineCall[] = [];
  const translate = spec.translate ?? defaultTranslate;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? init.body : null;
    const method = init?.method ?? "GET";
    if (DEEPL_HOSTS.has(url.hostname)) {
      const auth = headerOf(init, "Authorization");
      calls.push({ host: url.hostname, path: url.pathname, method, authHeader: auth, region: null, body });
      const key = auth?.replace(/^DeepL-Auth-Key /, "") ?? "";
      const entry = spec.deepl?.[key];
      const behaviour = typeof entry === "string" ? entry : entry ? (entry.behaviour ?? "ok") : "refused";
      // DeepL's API Free keys only work on api-free, Pro keys only on api.
      if (key.endsWith(":fx") !== (url.hostname === "api-free.deepl.com")) return json(403, { message: "Wrong endpoint" });
      if (behaviour === "refused") return json(403, { message: "Forbidden" });
      if (behaviour === "down") return json(503, { message: "Unavailable" });
      if (url.pathname === "/v2/usage") {
        const usage = typeof entry === "object" && entry.usage ? entry.usage : { count: behaviour === "quota" ? 500_000 : 1_234, limit: 500_000 };
        return json(200, { character_count: usage.count, character_limit: usage.limit });
      }
      if (url.pathname === "/v2/languages") return json(200, ["DE", "FR", "ES", "IT", "NL", "EN-GB", "EN-US"].map((language) => ({ language, name: language })));
      if (url.pathname === "/v2/translate") {
        if (behaviour === "quota") return json(456, { message: "Quota exceeded" });
        const parsed = JSON.parse(body ?? "{}") as { text: string[]; target_lang: string };
        const out = translate(parsed.text, parsed.target_lang.toLowerCase());
        return json(200, { translations: out.map((text, i) => ({ text, detected_source_language: "EN", billed_characters: parsed.text[i]!.length })) });
      }
      return json(404, {});
    }
    if (AZURE_HOSTS.has(url.hostname)) {
      const key = headerOf(init, "Ocp-Apim-Subscription-Key");
      calls.push({ host: url.hostname, path: url.pathname, method, authHeader: key, region: headerOf(init, "Ocp-Apim-Subscription-Region"), body });
      if (url.pathname === "/languages") return json(200, { translation: Object.fromEntries(["de", "fr", "es", "it", "nl"].map((code) => [code, { name: code }])) });
      const behaviour = (key && spec.azure?.[key]) || "refused";
      if (behaviour === "refused") return json(401, { error: { code: 401000, message: "Access denied" } });
      if (behaviour === "quota") return json(403, { error: { code: 403001, message: "Free quota exceeded" } });
      if (behaviour === "down") return json(503, { error: { code: 503000, message: "Unavailable" } });
      if (url.pathname === "/translate") {
        const parsed = JSON.parse(body ?? "[]") as Array<{ text: string }>;
        const to = url.searchParams.get("to") ?? "de";
        const out = translate(parsed.map((p) => p.text), to);
        return json(200, out.map((text) => ({ translations: [{ text, to }] })));
      }
      return json(404, {});
    }
    if (url.hostname === GOOGLE_HOST) {
      const key = headerOf(init, "X-goog-api-key");
      calls.push({ host: url.hostname, path: url.pathname, method, authHeader: key, region: null, body });
      const behaviour = (key && spec.google?.[key]) || "refused";
      if (behaviour === "refused") return json(400, { error: { status: "INVALID_ARGUMENT", details: [errorInfo("API_KEY_INVALID")] } });
      if (behaviour === "quota") return json(403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } });
      if (behaviour === "rate-limited") return json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } });
      if (behaviour === "service-disabled") return json(403, { error: { status: "PERMISSION_DENIED", details: [errorInfo("SERVICE_DISABLED")] } });
      if (behaviour === "down") return json(503, { error: { status: "UNAVAILABLE" } });
      if (url.pathname === "/language/translate/v2/languages") {
        return json(200, { data: { languages: ["de", "fr", "es", "it", "nl"].map((language) => ({ language })) } });
      }
      if (url.pathname === "/language/translate/v2") {
        const parsed = JSON.parse(body ?? "{}") as { q: string[]; target: string };
        return json(200, { data: { translations: translate(parsed.q, parsed.target).map((translatedText) => ({ translatedText })) } });
      }
      return json(404, {});
    }
    throw new Error(`fakeEngineFetch: unexpected host ${url.hostname}`);
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}
