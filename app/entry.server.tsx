import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { addSecurityHeaders } from "./.server/lib/security-headers";
import { logger } from "./.server/lib/logger";

export const streamTimeout = 5000;

/**
 * Unexpected loader and action errors: logged for operations (the page only
 * shows a generic message). Name, code and a short message only; no request
 * data, so no tokens or store content end up in logs. Responses that routes
 * throw on purpose (404, Shopify's auth flow) and cancelled requests are
 * not errors.
 */
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted || error instanceof Response) return;
  const err = error as { name?: string; code?: string; message?: string; stack?: string };
  logger.error(
    {
      err: { name: err?.name, code: err?.code, message: String(err?.message ?? error).slice(0, 300) },
      route: new URL(request.url).pathname,
      method: request.method,
      at: err?.stack?.split("\n").slice(1, 4).map((l) => l.trim()),
    },
    "request failed",
  );
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
  addSecurityHeaders(request, responseHeaders, { document: true });
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
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
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
