/**
 * Vitest setup file (unit, integration, security, performance): no test may
 * reach a real translation engine. globalThis.fetch is wrapped so a request
 * to DeepL, Microsoft (Azure Translator and its token service) or Google
 * Cloud fails before it leaves the process, whatever key the environment
 * holds. Adapters read globalThis.fetch at call time, so one that a test
 * forgot to give a fake fetch hits this guard instead of the network.
 */

/** Engine hosts: the domain itself and every subdomain. */
const ENGINE_DOMAINS = [
  "deepl.com",
  "microsofttranslator.com",
  "cognitive.microsoft.com",
  "cognitiveservices.azure.com",
  "googleapis.com",
];

export class TestGuardError extends Error {
  constructor(host: string) {
    super(`[test-guard] refused ${host}`);
    // The adapters report network errors by name only: the name says where it came from.
    this.name = "TestGuardError";
  }
}

/** The engine host a request would reach, or null when it may go out. */
export function refusedEngineHost(input: RequestInfo | URL): string | null {
  let host: string;
  try {
    host = new URL(input instanceof Request ? input.url : String(input)).hostname.toLowerCase();
  } catch {
    return null;
  }
  // A trailing dot names the same host ("api.deepl.com.").
  const name = host.replace(/\.$/, "");
  return ENGINE_DOMAINS.some((d) => name === d || name.endsWith(`.${d}`)) ? name : null;
}

const GUARDED = Symbol.for("linguva.noRealEngines");

/** fetch that refuses engine hosts and passes everything else to `fetchImpl`. */
export function guardFetch(fetchImpl: typeof fetch): typeof fetch {
  if ((fetchImpl as unknown as Record<symbol, unknown>)[GUARDED]) return fetchImpl;
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = refusedEngineHost(input);
    if (host) throw new TestGuardError(host);
    return fetchImpl(input, init);
  }) as typeof fetch;
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

globalThis.fetch = guardFetch(globalThis.fetch);
