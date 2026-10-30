/**
 * The content hub's probes are kept a minute per shop and set of granted
 * optional scopes: a repeat view asks Shopify nothing, a change of
 * permissions or time asks again, a view with an unanswered type isn't
 * kept, and the page's own errors (auth, time limit) still end the page.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearContentHubCache, HUB_CACHE_MS, loadContentHub } from "../../app/.server/translation/content-hub";
import { FakeShopifyStore } from "../support/fake-store";

const SHOP = "8f1d6a1e-0000-4000-8000-000000000001";
const OTHER = "8f1d6a1e-0000-4000-8000-000000000002";
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

beforeEach(() => clearContentHubCache());

function store() {
  const s = new FakeShopifyStore(2);
  s.addResource("MENU", "1", [{ key: "title", value: "Main menu", type: "SINGLE_LINE_TEXT_FIELD" }]);
  s.addResource("SHOP_POLICY", "1", [{ key: "body", value: "<p>Returns within 30 days.</p>", type: "HTML" }]);
  s.deniedTypes.add("SHOP_POLICY");
  return s;
}
const probes = (s: FakeShopifyStore) => s.calls.filter((c) => c === "LinguvaProbeTranslatable").length;

describe("the content hub's cache", () => {
  it("asks Shopify nothing on a second view within a minute with the same permissions", async () => {
    const s = store();
    const first = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 });
    expect(probes(s)).toBe(26);
    const again = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 + HUB_CACHE_MS - 1 });
    expect(probes(s)).toBe(26);
    expect(again).toEqual(first);
    // A scope no content type needs (markets) doesn't change what the probes may read.
    await loadContentHub(s.asAdmin(), ["read_online_store_navigation", "read_markets"], { shopId: SHOP, now: T0 + 1 });
    expect(probes(s)).toBe(26);
    // After a minute: asked again.
    await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 + HUB_CACHE_MS });
    expect(probes(s)).toBe(52);
  });

  it("probes again when the granted permissions change, and works the statuses out from them every time", async () => {
    const s = store();
    const before = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 });
    expect(before.find((e) => e.type === "SHOP_POLICY")?.status).toBe("needs-permission");
    const granted = await loadContentHub(s.asAdmin(), ["read_online_store_navigation", "read_legal_policies"], { shopId: SHOP, now: T0 + 1 });
    expect(probes(s)).toBe(52);
    // Granted, and Shopify still refuses: nothing the merchant can do.
    expect(granted.find((e) => e.type === "SHOP_POLICY")?.status).toBe("unavailable");
    // Each shop has its own results.
    await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: OTHER, now: T0 + 2 });
    expect(probes(s)).toBe(78);
    // Forgetting one shop (before asking Shopify for a permission) keeps the other's.
    clearContentHubCache(SHOP);
    await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: OTHER, now: T0 + 3 });
    expect(probes(s)).toBe(78);
    await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 + 3 });
    expect(probes(s)).toBe(104);
  });

  it("doesn't keep a view in which Shopify didn't answer for a type", async () => {
    const s = store();
    s.brokenTypes.add("MENU");
    const first = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 });
    expect(first.find((e) => e.type === "MENU")?.status).toBe("unknown");
    expect(first.filter((e) => e.status === "unknown").map((e) => e.type)).toEqual(["MENU"]);
    s.brokenTypes.clear();
    const second = await loadContentHub(s.asAdmin(), ["read_online_store_navigation"], { shopId: SHOP, now: T0 + 1 });
    expect(probes(s)).toBe(52);
    expect(second.find((e) => e.type === "MENU")?.status).toBe("has-content");
  });

  it("lets the page's time limit and auth responses through", async () => {
    const s = store();
    s.failNext = { count: 1, error: () => new Response("Shopify is taking too long", { status: 504 }) as unknown as Error };
    const thrown = await loadContentHub(s.asAdmin(), [], { shopId: SHOP, now: T0 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(504);
  });

  it("probes every time without a shop (no cache)", async () => {
    const s = store();
    await loadContentHub(s.asAdmin(), []);
    await loadContentHub(s.asAdmin(), []);
    expect(probes(s)).toBe(52);
  });
});
