/**
 * Whether background jobs are being processed (docs/RAILWAY_STAGING.md §8b):
 * 200 while a worker's heartbeat is in Redis, 503 otherwise. For
 * `pnpm ops:smoke --expect-worker` and the image check, not for Railway's
 * deploy health check (that stays /healthz). Public, no details.
 */
import { getWorkerStatus } from "../.server/queue/client";

const HEADERS = { "Cache-Control": "no-store" };

export const loader = async () => {
  const status = await getWorkerStatus();
  const running = status.state === "running";
  return Response.json({ status: running ? "ok" : status.state }, { status: running ? 200 : 503, headers: HEADERS });
};
