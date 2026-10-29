import { describe, expect, it } from "vitest";
import {
  editorPath,
  kindOfGid,
  providerContext,
  resourceGid,
  stillWithoutAccess,
} from "../../app/lib/resource-kinds";

describe("resource kinds", () => {
  it("builds GIDs only from numeric ids", () => {
    expect(resourceGid("PRODUCT", "42")).toBe("gid://shopify/Product/42");
    expect(resourceGid("COLLECTION", "7")).toBe("gid://shopify/Collection/7");
    for (const bad of ["", "abc", "1/2", "gid://shopify/Product/1", "1 OR 1=1", "1".repeat(21)]) {
      expect(resourceGid("COLLECTION", bad)).toBeNull();
    }
  });

  it("maps GIDs back to their editor", () => {
    expect(kindOfGid("gid://shopify/Collection/3")).toBe("COLLECTION");
    expect(kindOfGid("gid://shopify/Metafield/3")).toBeNull();
    expect(kindOfGid("gid://shopify/Product/x")).toBeNull();
    expect(editorPath("gid://shopify/Collection/3", "pt-BR")).toBe("/app/collections/3?lang=pt-BR");
    expect(editorPath("gid://shopify/Product/9", "de")).toBe("/app/products/9?lang=de");
    expect(editorPath("gid://shopify/OnlineStorePage/9", "de")).toBeNull();
  });

  it("describes the resource to the provider", () => {
    expect(providerContext("gid://shopify/Collection/3", "Sale")).toBe("Collection: Sale");
    expect(providerContext("gid://shopify/Product/3", "Jacket")).toBe("Product: Jacket");
    expect(providerContext("gid://shopify/Product/3", "")).toBeUndefined();
  });
});

describe("stillWithoutAccess", () => {
  it("drops a type whose access was allowed since the measurement, keeps the rest", () => {
    const denied = ["MENU", "METAOBJECT", "PRODUCT"];
    expect(stillWithoutAccess(denied, [])).toEqual(["MENU", "METAOBJECT", "PRODUCT"]);
    expect(stillWithoutAccess(denied, ["read_online_store_navigation"])).toEqual(["METAOBJECT", "PRODUCT"]);
    expect(stillWithoutAccess(denied, ["read_online_store_navigation", "read_metaobjects"])).toEqual(["PRODUCT"]);
  });
});
