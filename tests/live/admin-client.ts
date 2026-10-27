/**
 * Minimal Admin GraphQL client for live tests, shaped like the app's
 * `admin.graphql` so the production code paths run unchanged. It talks only
 * to the configured shop and never logs the token.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { LiveSettings } from "./guard";

export const LIVE_API_VERSION = "2026-10";

export type LiveAdmin = Pick<AdminApiContext, "graphql">;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Client credentials grant: works only for stores in the app's own organization. */
async function requestToken(shop: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    throw new Error(`Token request failed with ${response.status}. Is the app installed on this store, in the same organization?`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Token response had no access_token");
  return body.access_token;
}

export function createLiveAdmin(settings: LiveSettings): LiveAdmin & { calls: string[] } {
  const endpoint = `https://${settings.shop}/admin/api/${LIVE_API_VERSION}/graphql.json`;
  const calls: string[] = [];
  let token: Promise<string> | null = null;
  const accessToken = () =>
    (token ??=
      settings.credentials.kind === "token"
        ? Promise.resolve(settings.credentials.token)
        : requestToken(settings.shop, settings.credentials.clientId, settings.credentials.clientSecret));

  const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const name = /(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "anonymous";
    calls.push(name);
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
        body: JSON.stringify({ query, variables: options?.variables ?? {} }),
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${name}: Shopify answered ${response.status}. Check the token and its scopes.`);
      }
      const body = (await response.json()) as { data?: unknown; errors?: Array<{ message: string; extensions?: { code?: string } }> };
      const throttled = response.status === 429 || body.errors?.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < 5) {
        await sleep(1000 * attempt);
        continue;
      }
      if (body.errors?.length) {
        // Like the app's client: top-level GraphQL errors are thrown.
        throw new Error(`${name}: ${body.errors.map((e) => e.message).join("; ")}`);
      }
      return Response.json(body);
    }
  };

  return { graphql: graphql as unknown as LiveAdmin["graphql"], calls };
}
