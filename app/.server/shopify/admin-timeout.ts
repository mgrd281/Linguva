/**
 * A time limit for every Shopify Admin API call. Without it, a call that
 * Shopify never answers holds a page (or a worker slot) indefinitely.
 *
 * - In pages, a timeout becomes a 504 response: the error page explains it
 *   and offers Try again. Nothing was changed by the call that timed out
 *   from the app's side; a write may still complete in Shopify, which is
 *   why every publish is read back and digest-checked.
 * - In the worker, it is an ordinary error: BullMQ retries the item with
 *   backoff, like any other transient failure.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

type Admin = Pick<AdminApiContext, "graphql">;

export class ShopifyTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Shopify did not respond within ${timeoutMs} ms`);
    this.name = "ShopifyTimeoutError";
  }
}

export function withShopifyTimeout<A extends Admin>(admin: A, timeoutMs: number, mode: "page" | "worker"): A {
  const graphql = (async (query: string, options: Parameters<Admin["graphql"]>[1] = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      return await admin.graphql(query, { ...options, signal });
    } catch (error) {
      if (!timeout.aborted) throw error;
      if (mode === "page") {
        throw new Response("Shopify took too long to respond.", { status: 504, statusText: "Shopify timeout" });
      }
      throw new ShopifyTimeoutError(timeoutMs);
    }
  }) as A["graphql"];
  return Object.assign(Object.create(Object.getPrototypeOf(admin)), admin, { graphql });
}
