import pino from "pino";

/**
 * Keys that hold credentials: provider and Shopify headers (deepl.ts sends
 * `Authorization: DeepL-Auth-Key …`, azure.ts `Ocp-Apim-Subscription-Key`,
 * google.ts `X-goog-api-key` or a Bearer token), a Google service account's
 * key file and the assertion signed with it, session tokens, keys and
 * cookies. Header names in their spellings; hyphenated ones in brackets.
 */
const SECRET_KEYS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "sessionToken",
  "token",
  "apiKey",
  "secret",
  "password",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  '["set-cookie"]',
  '["Set-Cookie"]',
  '["x-shopify-access-token"]',
  '["X-Shopify-Access-Token"]',
  '["ocp-apim-subscription-key"]',
  '["Ocp-Apim-Subscription-Key"]',
  '["x-goog-api-key"]',
  '["X-goog-api-key"]',
  '["X-Goog-Api-Key"]',
  "private_key",
  "privateKey",
  "assertion",
  "access_token",
  "credentials",
];

/** Each key at the top level and up to two levels down: { headers: { Authorization } }, { ctx: { session: { accessToken } } }. */
const redactPaths = SECRET_KEYS.flatMap((key) => (key.startsWith("[") ? [key, `*${key}`, `*.*${key}`] : [key, `*.${key}`, `*.*.${key}`]));

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.LOG_SERVICE ?? "linguva-web" },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
};

/**
 * Structured JSON logger. Tokens, secrets and merchant content must never be
 * logged; the redact list is a safety net, not a licence to log objects freely.
 */
export const logger = pino(loggerOptions);

/**
 * The app's own errors whose messages are built from codes, numbers and ids
 * only (keep it so when adding one). Any other message can carry merchant
 * text: a Prisma validation error repeats the arguments of the failed call.
 */
const PLAIN_MESSAGE_ERRORS = new Set([
  "AccessDeniedError",
  "AiConsentRequiredError",
  "AiRequestTooLargeError",
  "BackgroundJobsUnavailableError",
  "ConfirmationRequiredError",
  "DecryptionError",
  "GlossaryLimitError",
  "ItemPermanentError",
  "JobStopError",
  "MarketsAccessError",
  "QuotaExceededError",
  "RateLimitedError",
  "RequestRateLimitedError",
  "ResourceNotFoundError",
  "ShopifyTimeoutError",
  "TranslationProviderError",
]);

/**
 * Logs an unexpected loader or action error for operations: its name and
 * code, the message of the app's own errors, and where it happened (stack
 * frames only; a multi-line message continues into the stack's first lines).
 * No request data, so no tokens or store content end up in logs.
 */
export function logRequestError(error: unknown, request: Request, log: Pick<pino.Logger, "error"> = logger) {
  const err = (error ?? {}) as { name?: unknown; code?: unknown; stack?: unknown };
  const name = typeof err.name === "string" ? err.name.slice(0, 80) : undefined;
  const code = typeof err.code === "string" || typeof err.code === "number" ? String(err.code).slice(0, 80) : undefined;
  const message = error instanceof Error && name && PLAIN_MESSAGE_ERRORS.has(name) ? error.message.slice(0, 300) : undefined;
  const at = typeof err.stack === "string" ? err.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 3).map((line) => line.trim()) : undefined;
  log.error({ err: { name, code, message }, route: new URL(request.url).pathname, method: request.method, at }, "request failed");
}
