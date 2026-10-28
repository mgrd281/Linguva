/**
 * Smoke checks of a deployed Linguva (docs/RAILWAY_STAGING.md §6), from the
 * outside and without secrets: health, the public page, webhook signature
 * checking and, for staging, that a store it doesn't serve is turned away.
 * Only reads; sends one unsigned webhook that must be refused.
 */

export interface SmokeOptions {
  /** https://… (http only for localhost). */
  baseUrl: string;
  /** A store the deployment must refuse, e.g. karinex.myshopify.com on staging. */
  refusedShop?: string;
  timeoutMs?: number;
}

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function checkBaseUrl(raw: string): URL {
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("--url must be https:// (http only for localhost)");
  if (url.pathname !== "/" || url.search) throw new Error("--url must be the app's base address, without a path");
  return url;
}

export async function runSmokeChecks(options: SmokeOptions, fetchImpl: Fetch = fetch): Promise<SmokeResult[]> {
  const base = checkBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const at = (path: string) => new URL(path, base).toString();
  const request = (path: string, init: RequestInit = {}) =>
    fetchImpl(at(path), { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...init });
  const results: SmokeResult[] = [];
  const check = async (name: string, run: () => Promise<[boolean, string]>) => {
    try {
      const [ok, detail] = await run();
      results.push({ name, ok, detail });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  await check("Health check answers ok (database reachable)", async () => {
    const response = await request("/healthz");
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    return [response.status === 200 && body?.status === "ok", `HTTP ${response.status}, ${JSON.stringify(body)}`];
  });

  await check("Public page answers without a server error", async () => {
    const response = await request("/");
    return [response.status < 500, `HTTP ${response.status}`];
  });

  await check("Security headers on the public page", async () => {
    const response = await request("/");
    const nosniff = response.headers.get("x-content-type-options") === "nosniff";
    return [nosniff, `X-Content-Type-Options: ${response.headers.get("x-content-type-options") ?? "missing"}`];
  });

  await check("Unsigned webhook is refused (HMAC checked)", async () => {
    const response = await request("/webhooks/app/uninstalled", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "app/uninstalled",
        "X-Shopify-Shop-Domain": "smoke-check.myshopify.com",
        "X-Shopify-Hmac-Sha256": "bm90LWEtdmFsaWQtc2lnbmF0dXJl",
        "X-Shopify-Webhook-Id": `smoke-${Date.now()}`,
        "X-Shopify-API-Version": "2026-10",
      },
      body: "{}",
    });
    return [response.status === 401, `HTTP ${response.status} (expected 401)`];
  });

  await check("App page without a Shopify session is not served", async () => {
    const response = await request("/app");
    // A redirect to the login or bounce page, or a refusal; never the app itself.
    return [response.status !== 200 || !(await response.text()).includes("s-app-nav"), `HTTP ${response.status}`];
  });

  if (options.refusedShop) {
    const shop = options.refusedShop;
    await check(`${shop} is turned away before authentication`, async () => {
      const page = await request(`/app?embedded=1&shop=${encodeURIComponent(shop)}`);
      const auth = await request(`/auth/login?shop=${encodeURIComponent(shop)}`);
      const install = await request(`/auth/callback?shop=${encodeURIComponent(shop)}`);
      const ok = page.status === 403 && auth.status === 403 && install.status === 403;
      return [ok, `/app ${page.status}, /auth/login ${auth.status}, /auth/callback ${install.status} (expected 403 each)`];
    });
  }
  return results;
}
