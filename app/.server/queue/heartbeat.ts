/**
 * Worker heartbeat in Redis: the worker writes a short-lived key while its
 * queues are being processed; the web process reads it to tell whether
 * background jobs run at all (GET /healthz/worker, the Overview). The key
 * expires by itself when the worker stops or dies, so no clocks are compared.
 */
import type { Redis } from "ioredis";
import { logger } from "../lib/logger";

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TTL_MS = 45_000;
/** Longest wait for Redis when a page asks; a slow answer is "unknown", never "stopped". */
export const HEARTBEAT_READ_TIMEOUT_MS = 500;

export function heartbeatKey(prefix: string): string {
  return `${prefix}:worker:heartbeat`;
}

/** What the key holds: operational facts only, no secrets and no shop data. */
export interface HeartbeatInfo {
  v: 1;
  at: string;
  startedAt: string;
  mode: "embedded" | "standalone";
  pid: number;
  commit: string | null;
  provider: string;
}

export interface HeartbeatOptions {
  prefix: string;
  /** False while the worker can't take jobs (closing, not connected): no beat is written. */
  healthy: () => boolean;
  info: Omit<HeartbeatInfo, "v" | "at">;
  intervalMs?: number;
  ttlMs?: number;
  now?: () => Date;
}

export function startHeartbeat(redis: Pick<Redis, "set">, options: HeartbeatOptions) {
  const key = heartbeatKey(options.prefix);
  const ttl = options.ttlMs ?? HEARTBEAT_TTL_MS;
  const now = options.now ?? (() => new Date());
  let pending = false;
  let stopped = false;

  const beat = async () => {
    // A SET still waiting (Redis down: commands queue up) isn't joined by another.
    if (stopped || pending || !options.healthy()) return;
    pending = true;
    try {
      const value: HeartbeatInfo = { v: 1, at: now().toISOString(), ...options.info };
      await redis.set(key, JSON.stringify(value), "PX", ttl);
    } catch (error) {
      logger.warn({ err: (error as Error).name }, "worker heartbeat not written");
    } finally {
      pending = false;
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return {
    beat,
    // The key is left to expire: a worker that restarts at once keeps it alive.
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export type WorkerStatus =
  | { state: "running"; startedAt: string | null; mode: string | null }
  | { state: "stopped" }
  /** Redis didn't answer in time or is reconnecting: nothing is known. */
  | { state: "unknown" }
  /** No Redis configured: background jobs can't run here at all. */
  | { state: "unavailable" };

const NOT_CONNECTED = new Set(["reconnecting", "close", "end"]);

/**
 * One read in flight per client and key: callers share it. The endpoint is
 * public, and a Redis whose connects hang keeps every command queued, so
 * each request would otherwise add one more for the whole outage.
 */
const pendingReads = new WeakMap<object, Map<string, Promise<string | null>>>();

function sharedGet(redis: Pick<Redis, "get">, key: string): Promise<string | null> {
  let reads = pendingReads.get(redis);
  if (!reads) pendingReads.set(redis, (reads = new Map()));
  let read = reads.get(key);
  if (!read) {
    read = redis.get(key).finally(() => reads.delete(key));
    reads.set(key, read);
  }
  return read;
}

export async function readWorkerStatus(
  redis: Pick<Redis, "get" | "status">,
  prefix: string,
  timeoutMs = HEARTBEAT_READ_TIMEOUT_MS,
): Promise<WorkerStatus> {
  if (NOT_CONNECTED.has(redis.status)) return { state: "unknown" };
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      sharedGet(redis, heartbeatKey(prefix)),
      new Promise<"timeout">((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
      }),
    ]);
    if (value === "timeout") return { state: "unknown" };
    if (value === null) return { state: "stopped" };
    const info = JSON.parse(value) as Partial<HeartbeatInfo>;
    return { state: "running", startedAt: typeof info.startedAt === "string" ? info.startedAt : null, mode: typeof info.mode === "string" ? info.mode : null };
  } catch {
    return { state: "unknown" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
