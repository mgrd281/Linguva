import { randomBytes } from "node:crypto";
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { addSecurityHeaders } from "./.server/lib/security-headers";
import { logger, logRequestError } from "./.server/lib/logger";
import { dropMigrationDatabaseUrl, getConfig, logConfigWarnings } from "./.server/lib/config";
import { siteConfigWarnings } from "./.server/site/pages";
import { startEmbeddedWorker } from "./.server/jobs/embedded-worker";

export const streamTimeout = 5000;

// The owner role's database URL: the migrations ran before this server
// started, in their own process (docs/SECURITY_MODEL.md §5n).
dropMigrationDatabaseUrl();

// Settings to fix before merchants pay (for example the platform cap); a warning, never a stop.
logConfigWarnings((message) => logger.warn(message));
try {
  for (const warning of siteConfigWarnings(getConfig())) logger.warn(warning);
} catch {
  // An invalid configuration is reported where it is used.
}

// Background jobs inside this process's container when no worker service
// exists (on by default in production only; docs/RAILWAY_STAGING.md §8b).
startEmbeddedWorker();

/**
 * Unexpected loader and action errors: logged for operations (the page only
 * shows a generic message), with name and code but no merchant text
 * (logRequestError). Responses that routes throw on purpose (404, Shopify's
 * auth flow) and cancelled requests are not errors.
 */
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted || error instanceof Response) return;
  logRequestError(error, request);
}

// Loader and action data (client navigation, fetchers).
export function handleDataRequest(response: Response, { request }: { request: Request }) {
  addSecurityHeaders(request, response.headers, { document: false });
  return response;
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  // React Router's inline scripts carry this nonce; the policy allows no other inline script.
  const nonce = import.meta.env.DEV ? undefined : randomBytes(16).toString("base64");
  addSecurityHeaders(request, responseHeaders, { document: true, scriptNonce: nonce });
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />,
      {
        nonce,
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          logRequestError(error, request);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
