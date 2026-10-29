/**
 * The deployment smoke checks (pnpm ops:smoke): what counts as a pass, with
 * a simulated deployment, so a broken deployment fails the run.
 */
import { describe, expect, it } from "vitest";
import { checkBaseUrl, runSmokeChecks } from "../../scripts/ops/smoke-checks";

function deployment(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: string[] = [];
  const routes: Record<string, () => Response> = {
    "/healthz": () => Response.json({ status: "ok" }),
    "/": () => new Response("Linguva", { headers: { "X-Content-Type-Options": "nosniff" } }),
    "/webhooks/app/uninstalled": () => new Response(null, { status: 401 }),
    "/app": () => new Response(null, { status: 302, headers: { Location: "/auth/login" } }),
    "/auth/login": () => new Response("refused", { status: 403 }),
    "/auth/callback": () => new Response("refused", { status: 403 }),
    ...overrides,
  };
  const fetchImpl = async (input: string) => {
    const url = new URL(input);
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/app" && url.searchParams.get("shop")) return new Response("refused", { status: 403 });
    return (routes[url.pathname] ?? (() => new Response(null, { status: 404 })))();
  };
  return { fetchImpl, calls };
}

describe("deployment smoke checks", () => {
  it("passes a healthy staging deployment that turns away the production store", async () => {
    const { fetchImpl, calls } = deployment();
    const results = await runSmokeChecks({ baseUrl: "https://linguva-staging.example.app", refusedShop: "karinex.myshopify.com" }, fetchImpl);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(6);
    expect(calls).toContain("/app?embedded=1&shop=karinex.myshopify.com");
  });

  it("fails when the database is down, a webhook isn't checked, or the store isn't refused", async () => {
    const { fetchImpl } = deployment({
      "/healthz": () => Response.json({ status: "unavailable" }, { status: 503 }),
      "/webhooks/app/uninstalled": () => new Response(null, { status: 200 }),
      "/auth/login": () => new Response(null, { status: 302 }),
    });
    const results = await runSmokeChecks({ baseUrl: "https://linguva-staging.example.app", refusedShop: "karinex.myshopify.com" }, fetchImpl);
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual([
      "Health check answers ok (database reachable)",
      "Unsigned webhook is refused (HMAC checked)",
      "karinex.myshopify.com is turned away before authentication",
    ]);
  });

  it("requires a running background worker when asked (production without a worker service)", async () => {
    const running = deployment({ "/healthz/worker": () => Response.json({ status: "ok" }) });
    const ok = await runSmokeChecks({ baseUrl: "https://linguva.example.app", expectWorker: true }, running.fetchImpl);
    expect(ok.find((r) => r.name === "Background worker is running")).toMatchObject({ ok: true });
    const stopped = deployment({ "/healthz/worker": () => Response.json({ status: "stopped" }, { status: 503 }) });
    const failed = await runSmokeChecks({ baseUrl: "https://linguva.example.app", expectWorker: true }, stopped.fetchImpl);
    expect(failed.filter((r) => !r.ok).map((r) => r.name)).toEqual(["Background worker is running"]);
    // Not asked: not checked.
    const plain = await runSmokeChecks({ baseUrl: "https://linguva.example.app" }, stopped.fetchImpl);
    expect(plain.some((r) => r.name === "Background worker is running")).toBe(false);
  });

  it("reports a network failure as a failed check, not a crash", async () => {
    const results = await runSmokeChecks({ baseUrl: "https://down.example.app" }, async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(results.every((r) => !r.ok && r.detail.includes("ECONNREFUSED"))).toBe(true);
  });

  it("accepts only an https base address (http for localhost)", () => {
    expect(() => checkBaseUrl("http://linguva.example.app")).toThrow(/https/);
    expect(() => checkBaseUrl("https://linguva.example.app/app")).toThrow(/base address/);
    expect(checkBaseUrl("http://localhost:3999").host).toBe("localhost:3999");
  });
});
