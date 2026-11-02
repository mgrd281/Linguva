import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGoogleTokens,
  GOOGLE_TOKEN_URL,
  GoogleTokenSource,
  parseServiceAccount,
  signedAssertion,
  tokenSlot,
  TRANSLATION_SCOPE,
  type ServiceAccountCredentials,
} from "../../app/.server/providers/google-auth";
import { TranslationProviderError } from "../../app/.server/providers/types";

// A throwaway key generated for this run: fictional account, never sent anywhere.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const FILE = {
  type: "service_account",
  project_id: "linguva-fictional-01",
  private_key_id: "0123456789abcdef0123456789abcdef01234567",
  private_key: PEM,
  client_email: "translator@linguva-fictional-01.iam.gserviceaccount.com",
  client_id: "100000000000000000001",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  // The legacy URL from Google's sample key file: never used.
  token_uri: "https://accounts.google.com/o/oauth2/token",
};
const RAW = JSON.stringify(FILE);
const CREDENTIALS: ServiceAccountCredentials = {
  projectId: FILE.project_id,
  clientEmail: FILE.client_email,
  privateKey: PEM,
  privateKeyId: FILE.private_key_id,
};
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

interface Call {
  url: string;
  init: RequestInit;
}
const allCalls: Call[] = [];

function fakeFetch(respond: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    allCalls.push(call);
    return respond(call, calls.length);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const grant = (n = 1, expiresIn: unknown = 3600) => Response.json({ access_token: `ya29.fictional-token-${n}`, expires_in: expiresIn, token_type: "Bearer" });

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Every 8-character piece of the key file that could show up in a message. */
function leaksKeyFile(text: string): boolean {
  for (let i = 0; i + 8 <= RAW.length; i++) {
    const piece = RAW.slice(i, i + 8);
    // Pieces that are ordinary JSON punctuation or field names prove nothing.
    if (/^[\s",:{}a-z_]+$/.test(piece)) continue;
    if (text.includes(piece)) return true;
  }
  return false;
}

beforeEach(() => {
  clearGoogleTokens();
  allCalls.length = 0;
});

afterEach(() => {
  // Only Google's fixed token endpoint, and only through a fake.
  for (const call of allCalls) expect(call.url).toBe(GOOGLE_TOKEN_URL);
});

describe("parseServiceAccount", () => {
  it("reads the key file pasted raw or as base64", () => {
    expect(parseServiceAccount(RAW)).toEqual(CREDENTIALS);
    expect(parseServiceAccount(`  ${RAW}\n`)).toEqual(CREDENTIALS);
    expect(parseServiceAccount(Buffer.from(RAW).toString("base64"))).toEqual(CREDENTIALS);
  });

  it("accepts legacy domain-scoped project ids and a file without a key id", () => {
    const withoutId: Partial<typeof FILE> = { ...FILE, project_id: "example.com:proj-123" };
    delete withoutId.private_key_id;
    expect(parseServiceAccount(JSON.stringify(withoutId))).toEqual({
      projectId: "example.com:proj-123",
      clientEmail: FILE.client_email,
      privateKey: PEM,
    });
  });

  it.each([
    ["wrong type", { ...FILE, type: "authorized_user" }],
    ["no project", { ...FILE, project_id: undefined }],
    ["upper-case project", { ...FILE, project_id: "Linguva-Project" }],
    ["short project", { ...FILE, project_id: "abc" }],
    ["no client email", { ...FILE, client_email: undefined }],
    ["foreign client email", { ...FILE, client_email: "someone@example.com" }],
    ["no private key", { ...FILE, private_key: undefined }],
    ["bad PEM", { ...FILE, private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n" }],
    ["EC key", { ...FILE, private_key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() }],
  ])("refuses a file with %s", (_name, file) => {
    expect(parseServiceAccount(JSON.stringify(file))).toBeNull();
  });

  it("never throws and never echoes the file, for malformed JSON and a bad PEM", () => {
    const inputs = [
      RAW.slice(0, -10),
      `${RAW}}`,
      RAW.replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----x"),
      JSON.stringify({ ...FILE, private_key: PEM.slice(0, 200) }),
      Buffer.from(RAW.slice(0, -10)).toString("base64"),
      "",
      "{",
      "null",
      "[]",
      "not base64 at all ✓",
    ];
    for (const input of inputs) {
      let result: unknown;
      let thrown: unknown;
      try {
        result = parseServiceAccount(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeUndefined();
      expect(result).toBeNull();
      expect(leaksKeyFile(String(result))).toBe(false);
    }
  });
});

describe("signedAssertion", () => {
  it("is an RS256 JWT for the token endpoint, backdated 30 s and valid for exactly one hour", () => {
    const jwt = signedAssertion(CREDENTIALS, NOW / 1000);
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT", kid: FILE.private_key_id });
    const body = decodePart(claims);
    expect(body).toEqual({
      iss: FILE.client_email,
      scope: TRANSLATION_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: NOW / 1000 - 30,
      exp: NOW / 1000 - 30 + 3600,
    });
    expect(Number(body.exp) - Number(body.iat)).toBe(3600);
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("leaves out kid without a key id", () => {
    const withoutId: ServiceAccountCredentials = { ...CREDENTIALS };
    delete withoutId.privateKeyId;
    expect(decodePart(signedAssertion(withoutId, NOW / 1000).split(".")[0]!)).toEqual({ alg: "RS256", typ: "JWT" });
  });
});

describe("GoogleTokenSource", () => {
  it("posts the signed assertion to the fixed token URL, never to the file's token_uri", async () => {
    const { impl, calls } = fakeFetch(() => grant());
    const source = new GoogleTokenSource(parseServiceAccount(RAW)!, { fetch: impl, now: () => NOW });
    expect(await source.token()).toBe("ya29.fictional-token-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(GOOGLE_TOKEN_URL);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    const body = new URLSearchParams(calls[0]!.init.body as string);
    expect(String(calls[0]!.init.body).startsWith("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=")).toBe(true);
    const [header, claims, signature] = body.get("assertion")!.split(".") as [string, string, string];
    expect(decodePart(claims).aud).toBe(GOOGLE_TOKEN_URL);
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("does no network and no signing at construction", () => {
    const { impl, calls } = fakeFetch(() => grant());
    new GoogleTokenSource(CREDENTIALS, { fetch: impl });
    expect(calls).toHaveLength(0);
  });

  it("caches the token, shared by every source of the account, and refreshes it 5 minutes before expiry", async () => {
    let now = NOW;
    const { impl, calls } = fakeFetch((_call, n) => grant(n));
    const source = new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => now });
    expect(await source.token()).toBe("ya29.fictional-token-1");
    now += 54 * 60 * 1000;
    expect(await new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => now }).token()).toBe("ya29.fictional-token-1");
    expect(calls).toHaveLength(1);
    now += 60 * 1000 + 1;
    expect(await source.token()).toBe("ya29.fictional-token-2");
    expect(calls).toHaveLength(2);
  });

  it("distrusts an expires_in outside 60..3600 seconds and uses 3000", async () => {
    let now = NOW;
    const { impl, calls } = fakeFetch((_call, n) => grant(n, n === 1 ? 86_400 : "3600"));
    const source = new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => now });
    await source.token();
    now += (3000 - 300) * 1000 - 1;
    await source.token();
    expect(calls).toHaveLength(1);
    now += 2;
    await source.token();
    expect(calls).toHaveLength(2);
  });

  it("lets concurrent callers share one in-flight request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { impl, calls } = fakeFetch(async () => {
      await gate;
      return grant();
    });
    const source = new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW });
    const tokens = Promise.all([source.token(), source.token(), new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW }).token()]);
    release();
    expect(await tokens).toEqual(["ya29.fictional-token-1", "ya29.fictional-token-1", "ya29.fictional-token-1"]);
    expect(calls).toHaveLength(1);
  });

  it("mints a new token after invalidate()", async () => {
    const { impl, calls } = fakeFetch((_call, n) => grant(n));
    const source = new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW });
    await source.token();
    source.invalidate();
    expect(await source.token()).toBe("ya29.fictional-token-2");
    expect(calls).toHaveLength(2);
  });

  it("keeps using a still-valid token when the early refresh fails", async () => {
    let now = NOW;
    const { impl } = fakeFetch((_call, n) => (n === 1 ? grant(1) : new Response(null, { status: 503 })));
    const source = new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => now });
    await source.token();
    now += 57 * 60 * 1000;
    expect(await source.token()).toBe("ya29.fictional-token-1");
    now += 4 * 60 * 1000;
    await expect(source.token()).rejects.toMatchObject({ kind: "retryable" });
  });

  it.each([
    [400, { error: "invalid_grant", error_description: "Invalid JWT Signature. SECRET-INPUT" }, "auth", "TOKEN_GRANT", "token HTTP 400 invalid_grant"],
    [401, { error: "invalid_grant" }, "auth", "TOKEN_GRANT", "token HTTP 401 invalid_grant"],
    [401, { error: "invalid_client", error_description: "SECRET-INPUT" }, "auth", undefined, "token HTTP 401 invalid_client"],
    [400, { error: "unauthorized_client" }, "auth", undefined, "token HTTP 400 unauthorized_client"],
    [400, { error: "disabled_client" }, "auth", undefined, "token HTTP 400 disabled_client"],
    [400, { error: "invalid_scope" }, "auth", undefined, "token HTTP 400 invalid_scope"],
    [403, { error: "has spaces SECRET-INPUT" }, "auth", undefined, "token HTTP 403"],
    [500, { error: "internal_failure" }, "retryable", undefined, "token HTTP 500 internal_failure"],
    [503, null, "retryable", undefined, "token HTTP 503"],
  ] as const)("token HTTP %i %j → %s %s", async (status, body, kind, reason, message) => {
    const { impl } = fakeFetch(() => (body ? Response.json(body, { status }) : new Response(null, { status })));
    const failure = (await new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW }).token().catch((e: unknown) => e)) as TranslationProviderError;
    expect(failure).toBeInstanceOf(TranslationProviderError);
    expect(failure).toMatchObject({ provider: "google", kind, status, message: `google ${kind}: ${message}` });
    expect(failure.reason).toBe(reason);
    expect(failure.message).not.toContain("SECRET-INPUT");
    expect(leaksKeyFile(failure.message)).toBe(false);
  });

  it("treats a network error and a token-less answer as retryable, never quoting a token or assertion", async () => {
    const network = fakeFetch(() => {
      throw new TypeError("fetch failed for assertion=eyJhbGciOi");
    });
    await expect(new GoogleTokenSource(CREDENTIALS, { fetch: network.impl, now: () => NOW }).token()).rejects.toMatchObject({
      kind: "retryable",
      message: "google retryable: network error: TypeError",
    });
    const odd = fakeFetch(() => Response.json({ access_token: "has spaces\nand lines", expires_in: 3600 }));
    const failure = (await new GoogleTokenSource(CREDENTIALS, { fetch: odd.impl, now: () => NOW }).token().catch((e: unknown) => e)) as Error;
    expect(failure.message).toBe("google retryable: malformed token response");
  });
});

describe("token slots (hardening)", () => {
  // Another throwaway key: a key file that copies the account's email and key id with another key.
  const OTHER_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const FORGED: ServiceAccountCredentials = { ...CREDENTIALS, privateKey: OTHER_PEM };

  it("differs for the same email and key id with another private key, and is stable for one account", () => {
    expect(tokenSlot(FORGED)).not.toBe(tokenSlot(CREDENTIALS));
    expect(tokenSlot({ ...CREDENTIALS })).toBe(tokenSlot(CREDENTIALS));
    expect(tokenSlot(CREDENTIALS)).toMatch(/^[0-9a-f]{16}$/);
    // Never the key or the account in it.
    expect(PEM).not.toContain(tokenSlot(CREDENTIALS));
    expect(tokenSlot({ ...CREDENTIALS, privateKeyId: undefined })).not.toBe(tokenSlot(CREDENTIALS));
  });

  it("never hands a cached token to a key file that copies another account's email and key id", async () => {
    const { impl, calls } = fakeFetch((_call, n) => grant(n));
    expect(await new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW }).token()).toBe("ya29.fictional-token-1");
    expect(await new GoogleTokenSource(FORGED, { fetch: impl, now: () => NOW }).token()).toBe("ya29.fictional-token-2");
    expect(calls).toHaveLength(2);
    // The real account still shares its own token.
    expect(await new GoogleTokenSource(CREDENTIALS, { fetch: impl, now: () => NOW }).token()).toBe("ya29.fictional-token-1");
    expect(calls).toHaveLength(2);
  });
});
