/**
 * Google Cloud service-account access tokens for Cloud Translation v3
 * (v3 accepts no API keys), minted with node:crypto: an RS256-signed JWT
 * exchanged at Google's token endpoint (OAuth 2.0 JWT bearer grant).
 *
 * - The token URL is fixed. The key file's token_uri is never used: a
 *   hostile file could otherwise receive the signed assertion.
 * - Neither the key file, the assertion nor a token ever appears in a
 *   message or a log; parse errors are dropped because V8's messages quote
 *   the input.
 */
import { createHash, createPrivateKey, createSign } from "node:crypto";
import { engineFetch, errorJson, providerError, safeToken } from "./engine-http";
import { copyProviderError, TranslationProviderError } from "./types";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"; // fixed: never the JSON's token_uri
export const TRANSLATION_SCOPE = "https://www.googleapis.com/auth/cloud-translation";

export interface ServiceAccountCredentials {
  projectId: string;
  clientEmail: string;
  /** PEM. */
  privateKey: string;
  privateKeyId?: string;
}

/** Project ids, including legacy domain-scoped ones ("example.com:proj-123"). */
const PROJECT_ID = /^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CLIENT_EMAIL = /^[A-Za-z0-9._%+-]{1,128}@[A-Za-z0-9.-]{1,200}\.gserviceaccount\.com$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Google accepts at most an hour; anything else in a response is distrusted. */
const DEFAULT_EXPIRES_S = 3000;
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 10_000;
/** A server clock slightly ahead of Google's would otherwise get invalid_grant ("Token must be a short-lived token"). */
const BACKDATE_S = 30;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The pasted service-account key file: raw JSON or the file in base64. Null unless
 * type is "service_account", project_id matches ^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$
 * (legacy domain-scoped ids included), client_email ends with .gserviceaccount.com and
 * private_key is a PEM key that crypto.createPrivateKey accepts. Never throws (JSON.parse and
 * createPrivateKey errors are caught and dropped: V8 messages quote the input); never echoes the value.
 */
export function parseServiceAccount(raw: string): ServiceAccountCredentials | null {
  try {
    const text = raw.trim();
    const json = text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8").trim();
    if (!json.startsWith("{")) return null;
    const file = parseJson(json) as Record<string, unknown> | null;
    if (!file || typeof file !== "object") return null;
    const { type, project_id: projectId, client_email: clientEmail, private_key: privateKey, private_key_id: privateKeyId } = file;
    if (type !== "service_account") return null;
    if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) return null;
    if (typeof clientEmail !== "string" || !CLIENT_EMAIL.test(clientEmail)) return null;
    if (typeof privateKey !== "string" || !privateKey.includes("-----BEGIN")) return null;
    // RS256 needs an RSA key.
    if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") return null;
    return {
      projectId,
      clientEmail,
      privateKey,
      ...(typeof privateKeyId === "string" && KEY_ID.test(privateKeyId) ? { privateKeyId } : {}),
    };
  } catch {
    return null;
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** RS256 JWT: header {alg,typ,kid}, claims {iss, scope, aud: GOOGLE_TOKEN_URL, iat: now − 30 s, exp: iat + 3600}; base64url without padding. */
export function signedAssertion(credentials: ServiceAccountCredentials, nowSeconds: number): string {
  const iat = Math.floor(nowSeconds) - BACKDATE_S;
  const header = { alg: "RS256", typ: "JWT", ...(credentials.privateKeyId ? { kid: credentials.privateKeyId } : {}) };
  const claims = { iss: credentials.clientEmail, scope: TRANSLATION_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

interface CachedToken {
  token?: string;
  expiresAt: number;
  pending?: Promise<string>;
}

/** Tokens by a hash of the account and key id (never the key itself). Shared by every provider in the process. */
const tokens = new Map<string, CachedToken>();

export function clearGoogleTokens(): void {
  tokens.clear();
}

function slot(credentials: ServiceAccountCredentials): string {
  return createHash("sha256").update(`${credentials.clientEmail}:${credentials.privateKeyId ?? ""}`).digest("hex").slice(0, 16);
}

export class GoogleTokenSource {
  private readonly slot: string;
  private readonly now: () => number;

  constructor(
    private readonly credentials: ServiceAccountCredentials,
    private readonly options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
  ) {
    this.slot = slot(credentials);
    this.now = options.now ?? Date.now;
  }

  /** A cached access token, refreshed 5 min before expiry; concurrent callers share one in-flight request. */
  async token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const entry = tokens.get(this.slot);
    if (entry?.token && this.now() < entry.expiresAt - REFRESH_BEFORE_MS) return entry.token;
    // The shared request isn't tied to one caller's signal (its own timeout bounds it).
    const pending = entry?.pending ?? this.refresh(entry);
    let token: string;
    try {
      token = await pending;
    } catch (error) {
      // Every waiting request gets an error of its own: callers attach their own bill and scope to it.
      throw error instanceof TranslationProviderError ? copyProviderError(error) : error;
    }
    signal?.throwIfAborted();
    return token;
  }

  private refresh(entry: CachedToken | undefined): Promise<string> {
    const pending: Promise<string> = this.mint().then(
      ({ token, expiresAt }) => {
        tokens.set(this.slot, { token, expiresAt });
        return token;
      },
      (error: unknown) => {
        if (tokens.get(this.slot)?.pending === pending) {
          // A refresh 5 min early that fails: the old token still works until it expires.
          if (entry?.token && this.now() < entry.expiresAt) {
            tokens.set(this.slot, { token: entry.token, expiresAt: entry.expiresAt });
            return entry.token;
          }
          tokens.delete(this.slot);
        }
        throw error;
      },
    );
    tokens.set(this.slot, { ...entry, expiresAt: entry?.expiresAt ?? 0, pending });
    return pending;
  }

  /** After a 401 from the API (ACCESS_TOKEN_EXPIRED): the next token() mints a new one. */
  invalidate(): void {
    const entry = tokens.get(this.slot);
    if (entry && !entry.pending) tokens.delete(this.slot);
  }

  private async mint(): Promise<{ token: string; expiresAt: number }> {
    const now = this.now();
    const assertion = signedAssertion(this.credentials, now / 1000);
    const response = await engineFetch(
      this.options.fetch ?? globalThis.fetch,
      GOOGLE_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`,
      },
      { engine: "google", timeoutMs: this.options.timeoutMs ?? TOKEN_TIMEOUT_MS },
    );
    if (!response.ok) {
      const status = response.status;
      const code = safeToken((await errorJson(response) as { error?: unknown } | null)?.error);
      const message = `token HTTP ${status}${code ? ` ${code}` : ""}`;
      if (status >= 500 || status === 408) throw providerError("google", "retryable", message, { status });
      // A rate limit on the token endpoint is still a rate limit: wait, don't switch.
      if (status === 429) throw providerError("google", "retryable", message, { status, reason: "RATE_LIMITED" });
      // invalid_grant is usually clock skew, sometimes a deleted key: rested shorter than other refusals.
      const grant = (status === 400 || status === 401) && code === "invalid_grant";
      if (status >= 400) throw providerError("google", "auth", message, { status, reason: grant ? "TOKEN_GRANT" : undefined });
      throw providerError("google", "retryable", message, { status });
    }
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    const token = body?.access_token;
    if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
      throw providerError("google", "retryable", "malformed token response");
    }
    const expiresIn = typeof body?.expires_in === "number" && body.expires_in >= 60 && body.expires_in <= 3600 ? body.expires_in : DEFAULT_EXPIRES_S;
    return { token, expiresAt: now + expiresIn * 1000 };
  }
}
