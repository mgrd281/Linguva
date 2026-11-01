/**
 * Log redaction (app/.server/lib/logger.ts): credentials never reach a log
 * line, in the shapes they come in (provider and Shopify headers, sessions,
 * nested contexts), while ids and codes stay readable.
 */
import pino from "pino";
import { describe, expect, it } from "vitest";
import { JobStopError } from "../../app/.server/jobs/errors";
import { loggerOptions, logRequestError } from "../../app/.server/lib/logger";
import { QuotaExceededError } from "../../app/.server/usage/usage-ledger";

/** The app's logger configuration writing into memory (tests run with LOG_LEVEL=silent). */
function capture() {
  const lines: string[] = [];
  const log = pino({ ...loggerOptions, level: "info" }, { write: (line: string) => void lines.push(line) });
  return { log, lines };
}

// Fake values, each recognisable in the output.
const SECRET = {
  deepl: "DeepL-Auth-Key 3f6c1a2e-0b4d-4e8f-9a7b-5c2d1e0f9a8b:fx",
  bearer: "Bearer eyJhbGciOiJIUzI1NiJ9.session-token-payload.signature",
  offline: "shpat_offline_access_token_0001",
  refresh: "shprt_refresh_token_0002",
  nested: "shpat_nested_access_token_0003",
  apiKey: "deepl-api-key-0004:fx",
  token: "partner-api-token-0005",
  idToken: "eyJ.id-token-0006.sig",
  sessionToken: "eyJ.session-token-0007.sig",
  secret: "app-client-secret-0008",
  cookie: "shopify_session=cookie-value-0009",
  header: "shpat_header_token_0010",
  child: "shpat_child_binding_0011",
  error: "DeepL-Auth-Key error-header-0012",
};

describe("log redaction", () => {
  it("never writes a credential, in the shapes the app and its libraries use", () => {
    const { log, lines } = capture();
    log.info({ headers: { Authorization: SECRET.deepl } }, "provider request");
    log.info({ request: { headers: { authorization: SECRET.bearer, Cookie: SECRET.cookie } } }, "incoming request");
    log.info({ session: { accessToken: SECRET.offline, refreshToken: SECRET.refresh } }, "session");
    log.info({ ctx: { session: { accessToken: SECRET.nested } } }, "nested session");
    log.info({ apiKey: SECRET.apiKey, token: SECRET.token, idToken: SECRET.idToken, sessionToken: SECRET.sessionToken, secret: SECRET.secret }, "settings");
    log.warn({ response: { headers: { "X-Shopify-Access-Token": SECRET.header, "set-cookie": SECRET.cookie } } }, "admin call");
    log.child({ accessToken: SECRET.child }).info("child logger");
    log.error({ err: Object.assign(new Error("request failed"), { headers: { Authorization: SECRET.error } }) }, "provider error");

    expect(lines).toHaveLength(8);
    const output = lines.join("");
    for (const [name, value] of Object.entries(SECRET)) expect(output, name).not.toContain(value.split(" ").pop());
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(15);
  });

  it("keeps ids and codes readable", () => {
    const { log, lines } = capture();
    log.warn({ shopId: "7d5c0a9e-1111-4222-8333-944455556666", webhookId: "w-1", errorCode: "QUOTA_EXCEEDED" }, "job stopped");
    expect(JSON.parse(lines[0]!)).toMatchObject({
      shopId: "7d5c0a9e-1111-4222-8333-944455556666",
      webhookId: "w-1",
      errorCode: "QUOTA_EXCEEDED",
      msg: "job stopped",
    });
  });
});

describe("request error log (entry.server handleError)", () => {
  const request = () => new Request("https://linguva.test/app/review?q=Wollm%C3%BCtze", { method: "POST" });
  const MERCHANT = "Handgestrickte Wollmütze aus Merinowolle";

  it("keeps the name and code of other errors, never their message: Prisma repeats the call's arguments", () => {
    const { log, lines } = capture();
    // As Prisma reports them: the failed call with its arguments, over several lines.
    const validation = Object.assign(
      new Error(`\nInvalid \`prisma.translationDraft.create()\` invocation:\n\n{\n  data: {\n    value: "${MERCHANT}",\n    shopId: 7\n  }\n}\n\nArgument \`shopId\`: Invalid value provided.`),
      { name: "PrismaClientValidationError" },
    );
    const unique = Object.assign(new Error(`Unique constraint failed: "${MERCHANT}"`), { name: "PrismaClientKnownRequestError", code: "P2002" });
    logRequestError(validation, request(), log);
    logRequestError(unique, request(), log);
    logRequestError(`thrown text: ${MERCHANT}`, request(), log);

    expect(lines.join("")).not.toContain("Wollmütze");
    const [first, second, third] = lines.map((line) => JSON.parse(line));
    expect(first).toMatchObject({ err: { name: "PrismaClientValidationError" }, route: "/app/review", method: "POST", msg: "request failed" });
    expect(first.err.message).toBeUndefined();
    expect(second.err).toEqual({ name: "PrismaClientKnownRequestError", code: "P2002" });
    expect(third.err).toEqual({});
    // Where it happened: stack frames only, not the message lines a stack starts with.
    expect(first.at.length).toBeGreaterThan(0);
    for (const frame of first.at) expect(frame).toMatch(/^at /);
  });

  it("keeps the message of the app's own errors, which is built from codes and numbers", () => {
    const { log, lines } = capture();
    logRequestError(new QuotaExceededError(19_000, 2_000, 20_000), request(), log);
    logRequestError(new JobStopError("PLAN_BULK"), request(), log);
    expect(lines.map((line) => JSON.parse(line).err.message)).toEqual(["monthly character limit reached (19000 + 2000 > 20000)", "Job stopped: PLAN_BULK"]);
  });
});

describe("log redaction of translation engine credentials", () => {
  it("never writes an Azure or Google key, a service account's key file, an assertion or a token", () => {
    const { log, lines } = capture();
    const values = {
      azure: "uiazurekey0004fictional0000000000",
      azureLower: "uiazurekey0005fictional0000000000",
      google: "ui-google-key-0005-fictional0000",
      googleLower: "ui-google-key-0006-fictional0000",
      googleUpper: "ui-google-key-0007-fictional0000",
      pem: "-----BEGIN PRIVATE KEY-----fictional0008",
      pem2: "-----BEGIN PRIVATE KEY-----fictional0009",
      assertion: "eyJ.fictional-assertion-0010.sig",
      token: "ya29.fictional-access-token-0011",
      json: '{"type":"service_account","fictional":"0012"}',
    };
    log.info({ headers: { "Ocp-Apim-Subscription-Key": values.azure } }, "azure request");
    log.info({ request: { headers: { "ocp-apim-subscription-key": values.azureLower } } }, "azure request");
    log.info({ headers: { "X-goog-api-key": values.google, "x-goog-api-key": values.googleLower, "X-Goog-Api-Key": values.googleUpper } }, "google request");
    log.info({ credentials: { private_key: values.pem, privateKey: values.pem2 } }, "service account");
    log.info({ body: { assertion: values.assertion, access_token: values.token } }, "token");
    log.info({ credentials: values.json }, "config");
    const output = lines.join("");
    for (const [name, value] of Object.entries(values)) expect(output, name).not.toContain(value);
  });
});
