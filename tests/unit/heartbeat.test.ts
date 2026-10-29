/**
 * The worker heartbeat (app/.server/queue/heartbeat.ts): what the worker
 * writes, and how the web process reads it without ever mistaking a slow
 * or reconnecting Redis for a stopped worker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { heartbeatKey, HEARTBEAT_TTL_MS, readWorkerStatus, startHeartbeat } from "../../app/.server/queue/heartbeat";

const info = { startedAt: "2026-10-29T00:00:00.000Z", mode: "embedded" as const, pid: 7, commit: "abc1234", provider: "none" };

afterEach(() => {
  vi.useRealTimers();
});

describe("heartbeat writer", () => {
  it("writes at once and then every interval, with an expiry and only operational facts", async () => {
    vi.useFakeTimers();
    const set = vi.fn(async () => "OK");
    const beat = startHeartbeat({ set } as never, { prefix: "lv:test", healthy: () => true, info, intervalMs: 1_000, now: () => new Date("2026-10-29T01:00:00Z") });
    await vi.advanceTimersByTimeAsync(0);
    expect(set).toHaveBeenCalledTimes(1);
    const [key, value, px, ttl] = set.mock.calls[0] as unknown as [string, string, string, number];
    expect([key, px, ttl]).toEqual([heartbeatKey("lv:test"), "PX", HEARTBEAT_TTL_MS]);
    expect(JSON.parse(value)).toEqual({ v: 1, at: "2026-10-29T01:00:00.000Z", ...info });
    expect(Object.keys(JSON.parse(value)).sort()).toEqual(["at", "commit", "mode", "pid", "provider", "startedAt", "v"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(set).toHaveBeenCalledTimes(4);
    beat.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(set).toHaveBeenCalledTimes(4);
  });

  it("writes nothing while the workers can't take jobs, and never piles up writes while Redis hangs", async () => {
    vi.useFakeTimers();
    let healthy = false;
    let release: () => void = () => undefined;
    const set = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("OK"))));
    const beat = startHeartbeat({ set } as never, { prefix: "lv:test", healthy: () => healthy, info, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(set).not.toHaveBeenCalled();
    healthy = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(set).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(set).toHaveBeenCalledTimes(2);
    beat.stop();
  });

  it("survives a failed write", async () => {
    vi.useFakeTimers();
    const set = vi.fn(async () => {
      throw new Error("READONLY");
    });
    const beat = startHeartbeat({ set } as never, { prefix: "lv:test", healthy: () => true, info, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(set).toHaveBeenCalledTimes(3);
    beat.stop();
  });
});

describe("worker status", () => {
  const redis = (status: string, get: () => Promise<string | null>) => ({ status, get: vi.fn(get) });

  it("is running while the key exists, stopped when it expired", async () => {
    const running = redis("ready", async () => JSON.stringify({ v: 1, ...info, at: "x" }));
    expect(await readWorkerStatus(running as never, "lv:test")).toEqual({ state: "running", startedAt: info.startedAt, mode: "embedded" });
    expect(running.get).toHaveBeenCalledWith(heartbeatKey("lv:test"));
    expect(await readWorkerStatus(redis("ready", async () => null) as never, "lv:test")).toEqual({ state: "stopped" });
  });

  it("is unknown, never stopped, when Redis reconnects, fails or is slow", async () => {
    const reconnecting = redis("reconnecting", async () => null);
    expect(await readWorkerStatus(reconnecting as never, "lv:test")).toEqual({ state: "unknown" });
    expect(reconnecting.get).not.toHaveBeenCalled();
    expect(await readWorkerStatus(redis("ready", async () => Promise.reject(new Error("ECONNRESET"))) as never, "lv:test")).toEqual({ state: "unknown" });
    const slow = redis("ready", () => new Promise((resolve) => setTimeout(() => resolve(null), 200)));
    expect(await readWorkerStatus(slow as never, "lv:test", 20)).toEqual({ state: "unknown" });
  });

  it("sends one read at a time per client, so a Redis that hangs can't collect a queue of them", async () => {
    let answer: (value: string | null) => void = () => undefined;
    const hanging = redis("connecting", () => new Promise((resolve) => (answer = resolve)));
    for (let i = 0; i < 5; i++) expect(await readWorkerStatus(hanging as never, "lv:test", 5)).toEqual({ state: "unknown" });
    expect(hanging.get).toHaveBeenCalledTimes(1);
    // A caller still waiting gets the shared answer; the next one sends a new read.
    const waiting = readWorkerStatus(hanging as never, "lv:test", 1_000);
    answer(null);
    expect(await waiting).toEqual({ state: "stopped" });
    expect(hanging.get).toHaveBeenCalledTimes(1);
    await readWorkerStatus(hanging as never, "lv:test", 5);
    expect(hanging.get).toHaveBeenCalledTimes(2);
  });

  it("doesn't leave an unhandled rejection when a shared read fails after every caller gave up", async () => {
    let fail: (error: Error) => void = () => undefined;
    const failing = redis("connecting", () => new Promise((_resolve, reject) => (fail = reject)));
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      expect(await readWorkerStatus(failing as never, "lv:test", 5)).toEqual({ state: "unknown" });
      fail(new Error("Connection is closed."));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("asks a client that is still connecting (the first request after start)", async () => {
    expect(await readWorkerStatus(redis("connecting", async () => null) as never, "lv:test")).toEqual({ state: "stopped" });
  });
});
