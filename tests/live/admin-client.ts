/**
 * Minimal Admin GraphQL client for live tests, shaped like the app's
 * `admin.graphql` so the production code paths run unchanged. It talks only
 * to the configured shop and never logs the token.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { LiveTestRefused, type LiveSettings } from "./guard";

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

/**
 * The Linguva app's offline token for the shop, from the local development
 * database in .env (DATABASE_URL, TOKEN_ENCRYPTION_KEYS). Read from the
 * file, not the environment, because live tests run with the test
 * database's environment. Kept in memory only.
 */
export async function appSessionToken(shop: string, file = join(process.cwd(), ".env"), now = new Date()): Promise<string> {
  if (!existsSync(file)) throw new Error("LIVE_USE_APP_SESSION: no .env in the project folder");
  const env = parseEnv(readFileSync(file, "utf8")) as Record<string, string | undefined>;
  if (!env.DATABASE_URL || !env.TOKEN_ENCRYPTION_KEYS) throw new Error("LIVE_USE_APP_SESSION: .env needs DATABASE_URL and TOKEN_ENCRYPTION_KEYS");
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const session = await db.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: "desc" } });
    if (!session?.accessToken) throw new Error(`LIVE_USE_APP_SESSION: no offline session for ${shop}. Open Linguva on the store once with \`pnpm dev\` running.`);
    // Linguva uses expiring offline tokens; the app renews them when it is opened.
    if (session.expires && session.expires.getTime() < now.getTime() + 2 * 60_000) {
      throw new Error(
        `LIVE_USE_APP_SESSION: the app's stored token for ${shop} expired at ${session.expires.toISOString()}. ` +
          "Open Linguva in the store admin once with `pnpm dev` running (that renews it), then run the live tests again.",
      );
    }
    return TokenCipher.fromKeyring(env.TOKEN_ENCRYPTION_KEYS).decrypt(session.accessToken);
  } finally {
    await db.$disconnect();
  }
}

export function createLiveAdmin(settings: LiveSettings): LiveAdmin & { calls: string[] } {
  const endpoint = `https://${settings.shop}/admin/api/${LIVE_API_VERSION}/graphql.json`;
  const calls: string[] = [];
  let token: Promise<string> | null = null;
  const credentials = settings.credentials;
  const accessToken = () =>
    (token ??=
      credentials.kind === "token"
        ? Promise.resolve(credentials.token)
        : credentials.kind === "appSession"
          ? appSessionToken(settings.shop)
          : requestToken(settings.shop, credentials.clientId, credentials.clientSecret));

  const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const operation = /(query|mutation)\s+(\w+)/.exec(query);
    const name = operation?.[2] ?? "anonymous";
    // Read-only unless fixture writes were explicitly allowed: a mutation is
    // refused here, before anything is sent to Shopify.
    if (!settings.allowWrites && (operation?.[1] === "mutation" || /^\s*(#graphql\s*)?mutation\b/.test(query))) {
      throw new LiveTestRefused(`${name} is a Shopify mutation; live tests are read-only without LIVE_ALLOW_WRITES=yes`);
    }
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
      if (response.status === 404) {
        throw new Error(`${name}: Shopify answered 404 for ${settings.shop}. Is LIVE_SHOPIFY_SHOP the store's *.myshopify.com domain (Settings → Domains)?`);
      }
      const raw = (await response.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
      if (!raw || (raw.errors !== undefined && !Array.isArray(raw.errors))) {
        throw new Error(`${name}: unexpected answer from Shopify (HTTP ${response.status}${raw?.errors ? `: ${String(raw.errors).slice(0, 120)}` : ""})`);
      }
      const body = raw as { data?: unknown; errors?: Array<{ message: string; extensions?: { code?: string } }> };
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
