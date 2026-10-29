/**
 * Whether background jobs run (docs/RAILWAY_STAGING.md §8b): the worker's
 * heartbeat expires by itself when it stops, and GET /healthz/worker says
 * so without details.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loader } from "../../app/routes/healthz_.worker";
import { resetQueueClient } from "../../app/.server/queue/client";
import { heartbeatKey, readWorkerStatus, startHeartbeat } from "../../app/.server/queue/heartbeat";
import { keyPrefix } from "../../app/.server/queue/redis";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const redis = testRedis();
// The key the web process of this environment reads.
const KEY = heartbeatKey(keyPrefix("test"));
const info = { startedAt: new Date().toISOString(), mode: "standalone" as const, pid: process.pid, commit: null, provider: "none" };

// Also before: another suite (the browser tests' setup) may have left a heartbeat on this Redis.
beforeEach(() => redis.del(KEY));
afterEach(() => redis.del(KEY));
afterAll(async () => {
  await resetQueueClient();
  await redis.quit();
});

describe("worker heartbeat", () => {
  it("is running while the worker writes it and stopped soon after it stops", async () => {
    const prefix = testPrefix();
    const beat = startHeartbeat(redis, { prefix, healthy: () => true, info, intervalMs: 50, ttlMs: 400 });
    await waitFor(async () => (await readWorkerStatus(redis, prefix)).state === "running", 3_000);
    beat.stop();
    await waitFor(async () => (await readWorkerStatus(redis, prefix)).state === "stopped", 3_000);
    await deletePrefix(redis, prefix);
  });
});

describe("GET /healthz/worker", () => {
  it("answers 503 without a heartbeat and 200 with one, never cached, without details", async () => {
    let response = await loader();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "stopped" });

    await redis.set(KEY, JSON.stringify({ v: 1, at: new Date().toISOString(), ...info }), "PX", 10_000);
    response = await loader();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
