import { describe, expect, it } from "vitest";
import { ShopifyTimeoutError, withShopifyTimeout } from "../../app/.server/shopify/admin-timeout";

type Admin = Parameters<typeof withShopifyTimeout>[0];

/** An Admin client that answers after `ms`, or never, and honours abort signals like fetch. */
function slowAdmin(ms: number | null) {
  return {
    graphql: (_query: string, options: { signal?: AbortSignal } = {}) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = ms === null ? null : setTimeout(() => resolve(Response.json({ data: { ok: true } })), ms);
        options.signal?.addEventListener("abort", () => {
          if (timer) clearTimeout(timer);
          reject(options.signal!.reason);
        });
      });
    },
  } as unknown as Admin;
}

describe("Shopify Admin API time limit", () => {
  it("passes answers through when Shopify is fast enough", async () => {
    const admin = withShopifyTimeout(slowAdmin(10), 500, "page");
    expect(await (await admin.graphql("query { shop { id } }")).json()).toEqual({ data: { ok: true } });
  });

  it("ends a page's wait with a 504 response", async () => {
    const started = Date.now();
    const error = await withShopifyTimeout(slowAdmin(null), 100, "page").graphql("query { shop { id } }").catch((e) => e);
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(504);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("gives the worker a retryable error", async () => {
    const error = await withShopifyTimeout(slowAdmin(null), 100, "worker").graphql("query { shop { id } }").catch((e) => e);
    expect(error).toBeInstanceOf(ShopifyTimeoutError);
  });

  it("keeps the caller's own signal and other errors unchanged", async () => {
    const own = new AbortController();
    const inner = slowAdmin(null);
    const pending = withShopifyTimeout(inner, 5_000, "page").graphql("query { shop { id } }", { signal: own.signal }).catch((e) => e);
    own.abort(new Error("cancelled by caller"));
    const error = await pending;
    expect(error).toEqual(new Error("cancelled by caller"));

    const failing = { graphql: async () => { throw new Error("GraphQL error"); } } as unknown as Admin;
    await expect(withShopifyTimeout(failing, 5_000, "page").graphql("query { shop { id } }")).rejects.toThrow("GraphQL error");
  });
});
