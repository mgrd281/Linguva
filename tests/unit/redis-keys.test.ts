import { describe, expect, it } from "vitest";
import { keyPrefix, shopKey } from "../../app/.server/queue/redis";

describe("tenant-scoped Redis keys", () => {
  const shop = "0b7d6f0e-6f7a-4f53-9d2b-1f6c2a9e8a11";

  it("builds keys under the environment prefix and shop id", () => {
    expect(shopKey(keyPrefix("test"), shop, "rl", "shopify")).toBe(`lv:test:shop:${shop}:rl:shopify`);
  });

  it.each(["", "shop.myshopify.com", "*", `${shop}:x`, "../other"])(
    "refuses %j as a tenant id",
    (bad) => {
      expect(() => shopKey("lv:test", bad, "rl")).toThrow(/shop UUID/);
    },
  );
});
