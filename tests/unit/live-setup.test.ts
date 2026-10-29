/**
 * The live tests' one-time setup (tests/live/global-setup.ts) with Shopify
 * simulated: the dev-store gate, the target language (unpublished French is
 * fine), and a clear stop instead of failed suites when no language exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import setup from "../live/global-setup";

const SHOP = "linguva-test-lab.myshopify.com";

function shopify(locales: Array<{ locale: string; primary: boolean; published: boolean }>, partnerDevelopment = true) {
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string };
    sent.push(/(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "?");
    if (query.includes("shopLocales")) return Response.json({ data: { shopLocales: locales.map((l) => ({ ...l, name: l.locale })) } });
    return Response.json({ data: { shop: { myshopifyDomain: SHOP, plan: { partnerDevelopment, publicDisplayName: "Development" } } } });
  });
  return sent;
}

function project() {
  const provided: Record<string, unknown> = {};
  return { provided, project: { provide: (key: string, value: unknown) => (provided[key] = value) } as never };
}

function env(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("live test setup", () => {
  it("uses an unpublished French language and reads only", async () => {
    env({ LIVE_SHOPIFY_SHOP: SHOP, LIVE_SHOPIFY_ADMIN_TOKEN: "t", LIVE_TARGET_LOCALE: "", LIVE_ALLOW_WRITES: "" });
    const sent = shopify([{ locale: "en", primary: true, published: true }, { locale: "fr", primary: false, published: false }]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { provided, project: p } = project();
    await setup(p);
    expect(provided.liveTargetLocale).toBe("fr");
    expect(info.mock.calls[0]![0]).toBe(
      `Live tests against ${SHOP} (Partner development store), target language fr (unpublished), read-only: Shopify mutations are refused.`,
    );
    // Exactly two read queries: the dev-store gate and the languages.
    expect(sent).toEqual(["LinguvaLiveShopFacts", "LinguvaShopLocales"]);
  });

  it("stops with steps to add a language instead of failing every suite", async () => {
    env({ LIVE_SHOPIFY_SHOP: SHOP, LIVE_SHOPIFY_ADMIN_TOKEN: "t", LIVE_TARGET_LOCALE: "de" });
    shopify([{ locale: "en", primary: true, published: true }]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    await expect(setup(project().project)).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    const message = String(error.mock.calls[0]![0]);
    expect(message).toContain("Live tests not started: setup incomplete");
    expect(message).toContain("LIVE_TARGET_LOCALE=de isn't enabled on linguva-test-lab.myshopify.com");
    expect(message).toContain("Additional languages on the store: none.");
    expect(message).toContain("settings/languages");
  });

  it("refuses a store that isn't a Partner development store", async () => {
    env({ LIVE_SHOPIFY_SHOP: SHOP, LIVE_SHOPIFY_ADMIN_TOKEN: "t" });
    shopify([{ locale: "en", primary: true, published: true }, { locale: "fr", primary: false, published: false }], false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    await expect(setup(project().project)).rejects.toThrow("exit 1");
    expect(String(error.mock.calls[0]![0])).toContain("is not a Partner development store");
  });

  it("skips quietly when live tests aren't configured", async () => {
    for (const k of ["LIVE_SHOPIFY_SHOP", "LIVE_SHOPIFY_ADMIN_TOKEN", "LIVE_SHOPIFY_CLIENT_ID", "LIVE_SHOPIFY_CLIENT_SECRET", "LIVE_USE_APP_SESSION"]) vi.stubEnv(k, "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await setup(project().project);
    expect(String(info.mock.calls[0]![0])).toContain("Live tests are off");
  });
});
