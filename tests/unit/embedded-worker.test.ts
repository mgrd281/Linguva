/**
 * Background jobs inside the web container (app/.server/jobs/embedded-worker.ts):
 * when it is on, what the child gets, and how the supervisor restarts and
 * stops it, with a simulated child process and clock.
 */
import { describe, expect, it } from "vitest";
import {
  createWorkerSupervisor,
  embeddedWorkerSetting,
  MAX_RESTART_DELAY_MS,
  restartDelayMs,
  STABLE_AFTER_MS,
  HARD_EXIT_MS,
  START_DELAY_MS,
  STOP_TIMEOUT_MS,
  stopTimeouts,
  workerChildEnv,
  type WorkerChild,
} from "../../app/.server/jobs/embedded-worker";

describe("whether the web process runs the worker", () => {
  it("is on by default in production only", () => {
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production" })).toEqual({ on: true, reason: "production default" });
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "staging" }).on).toBe(false);
    expect(embeddedWorkerSetting({}).on).toBe(false);
    expect(embeddedWorkerSetting({ NODE_ENV: "production" }).on).toBe(false);
  });

  it("follows LINGUVA_EMBEDDED_WORKER, read leniently", () => {
    for (const value of ["on", "ON", " true ", "1", "yes"]) expect(embeddedWorkerSetting({ LINGUVA_EMBEDDED_WORKER: value }).on).toBe(true);
    for (const value of ["off", "False", "0", "no"]) expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production", LINGUVA_EMBEDDED_WORKER: value }).on).toBe(false);
  });

  it("switches off on a value it doesn't recognise (the switch exists to turn jobs off)", () => {
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production", LINGUVA_EMBEDDED_WORKER: "aus" })).toMatchObject({ on: false, reason: expect.stringMatching(/not recognised/) });
    // Empty counts as not set.
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production", LINGUVA_EMBEDDED_WORKER: "  " }).on).toBe(true);
  });

  it("never starts another worker from inside the worker", () => {
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production", LINGUVA_EMBEDDED_WORKER: "on", LINGUVA_WORKER_MODE: "embedded" }).on).toBe(false);
  });

  it("is off in the dev server, whatever the switch says (it would run a stale build)", () => {
    expect(embeddedWorkerSetting({ LINGUVA_EMBEDDED_WORKER: "on" }, true)).toMatchObject({ on: false, reason: expect.stringMatching(/pnpm worker:dev/) });
    expect(embeddedWorkerSetting({ LINGUVA_STAGE: "production" }, true).on).toBe(false);
  });
});

describe("time to stop after SIGTERM", () => {
  it("uses Railway's draining time when it allows more than the defaults", () => {
    expect(stopTimeouts({})).toEqual({ stopMs: STOP_TIMEOUT_MS, exitMs: HARD_EXIT_MS });
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "0" })).toEqual({ stopMs: STOP_TIMEOUT_MS, exitMs: HARD_EXIT_MS });
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "120" })).toEqual({ stopMs: 115_000, exitMs: 118_000 });
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: " 26 " })).toEqual({ stopMs: 21_000, exitMs: HARD_EXIT_MS });
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "two minutes" })).toEqual({ stopMs: STOP_TIMEOUT_MS, exitMs: HARD_EXIT_MS });
    // An hour at most: a mistyped huge value would overflow the timers and end the process at once.
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "3600" })).toEqual({ stopMs: 3_595_000, exitMs: 3_598_000 });
    expect(stopTimeouts({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "3000000" })).toEqual({ stopMs: STOP_TIMEOUT_MS, exitMs: HARD_EXIT_MS });
  });
});

describe("the worker's environment", () => {
  it("drops the owner role's database URL and marks the process, without changing the web's environment", () => {
    const env = { DATABASE_URL: "postgres://app", MIGRATION_DATABASE_URL: "postgres://owner", DEEPL_API_KEY: "k" };
    const child = workerChildEnv(env);
    expect(child).toEqual({ DATABASE_URL: "postgres://app", DEEPL_API_KEY: "k", LOG_SERVICE: "linguva-worker", LINGUVA_WORKER_MODE: "embedded" });
    expect(env.MIGRATION_DATABASE_URL).toBe("postgres://owner");
  });
});

describe("restart delay", () => {
  it("doubles from one second up to five minutes, with ±20 % jitter", () => {
    expect(restartDelayMs(1, () => 0.5)).toBe(1_000);
    expect(restartDelayMs(2, () => 0.5)).toBe(2_000);
    expect(restartDelayMs(4, () => 0.5)).toBe(8_000);
    expect(restartDelayMs(30, () => 0.5)).toBe(MAX_RESTART_DELAY_MS);
    expect(restartDelayMs(1, () => 0)).toBe(800);
    expect(restartDelayMs(1, () => 0.999999)).toBe(1_200);
  });
});

/** A child process the test controls, and a clock that only moves when told. */
function harness(options: { stopTimeoutMs?: number } = {}) {
  let time = 0;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let nextId = 1;
  const children: FakeChild[] = [];
  const logs: Array<[string, string]> = [];
  let spawnError: Error | null = null;

  class FakeChild implements WorkerChild {
    pid: number | undefined;
    signals: string[] = [];
    private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];
    constructor(pid: number | undefined) {
      this.pid = pid;
    }
    kill(signal: NodeJS.Signals) {
      this.signals.push(signal);
      return true;
    }
    once(_event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
      this.exitListeners.push(listener);
      return this;
    }
    on(_event: "error", listener: (error: Error) => void) {
      this.errorListeners.push(listener);
      return this;
    }
    exit(code: number | null, signal: NodeJS.Signals | null = null) {
      const listeners = this.exitListeners;
      this.exitListeners = [];
      for (const l of listeners) l(code, signal);
    }
    error(error: Error) {
      for (const l of this.errorListeners) l(error);
    }
  }

  const supervisor = createWorkerSupervisor({
    spawnWorker: () => {
      if (spawnError) throw spawnError;
      const child = new FakeChild(100 + children.length);
      children.push(child);
      return child;
    },
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.push({ at: time + ms, run, id });
      return id;
    },
    clearTimer: (id) => {
      const index = timers.findIndex((t) => t.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    now: () => time,
    random: () => 0.5,
    log: {
      info: (_obj: unknown, msg?: string) => void logs.push(["info", msg ?? ""]),
      warn: (_obj: unknown, msg?: string) => void logs.push(["warn", msg ?? ""]),
      error: (_obj: unknown, msg?: string) => void logs.push(["error", msg ?? ""]),
    } as never,
    ...options,
  });

  /** Moves the clock forward, running every timer that falls due on the way. */
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > end) break;
      timers.shift();
      time = due.at;
      due.run();
    }
    time = end;
  };

  return {
    supervisor,
    children,
    logs,
    advance,
    pendingTimers: () => timers.length,
    failSpawn: (error: Error | null) => {
      spawnError = error;
    },
    FakeChild,
  };
}

describe("worker supervisor", () => {
  it("starts the child only after the web server had time to listen", () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS - 1);
    expect(h.children).toHaveLength(0);
    h.advance(1);
    expect(h.children).toHaveLength(1);
    expect(h.supervisor.running).toBe(true);
    // A second begin() doesn't start a second child.
    h.supervisor.begin();
    h.advance(START_DELAY_MS * 2);
    expect(h.children).toHaveLength(1);
  });

  it("restarts a child that exits, with growing delays, and resets the backoff after a healthy run", () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    h.children[0]!.exit(1);
    expect(h.supervisor.running).toBe(false);
    h.advance(999);
    expect(h.children).toHaveLength(1);
    h.advance(1);
    expect(h.children).toHaveLength(2);
    h.children[1]!.exit(null, "SIGKILL");
    h.advance(1_999);
    expect(h.children).toHaveLength(2);
    h.advance(1);
    expect(h.children).toHaveLength(3);
    // This one runs long enough to count as healthy: the next restart is quick again.
    h.advance(STABLE_AFTER_MS);
    h.children[2]!.exit(0);
    h.advance(1_000);
    expect(h.children).toHaveLength(4);
    expect(h.logs.filter(([, m]) => m === "embedded worker exited")).toHaveLength(3);
  });

  it("counts a failed spawn like a crash and tries again", () => {
    const h = harness();
    h.failSpawn(new Error("EAGAIN"));
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    expect(h.children).toHaveLength(0);
    h.failSpawn(null);
    h.advance(1_000);
    expect(h.children).toHaveLength(1);
  });

  it("treats an error and exit of the same child as one failure, and a failed kill as no exit", () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    // The process is running (it has a pid): an error event alone isn't an exit.
    h.children[0]!.error(new Error("kill EPERM"));
    expect(h.supervisor.running).toBe(true);
    h.children[0]!.exit(1);
    h.children[0]!.error(new Error("late"));
    h.advance(1_000);
    expect(h.children).toHaveLength(2);
    expect(h.pendingTimers()).toBe(0);
  });

  it("stops the child with SIGTERM, waits for it, and never restarts it afterwards", async () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    const stopped = h.supervisor.stop();
    expect(h.supervisor.stop()).toBe(stopped);
    expect(h.children[0]!.signals).toEqual(["SIGTERM"]);
    h.children[0]!.exit(0);
    await stopped;
    h.advance(MAX_RESTART_DELAY_MS * 2);
    expect(h.children).toHaveLength(1);
    expect(h.pendingTimers()).toBe(0);
  });

  it("kills a child that doesn't stop in time", async () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    const stopped = h.supervisor.stop();
    h.advance(STOP_TIMEOUT_MS);
    expect(h.children[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    h.children[0]!.exit(null, "SIGKILL");
    await stopped;
    expect(h.children).toHaveLength(1);
  });

  it("gives the child the stop timeout it was given (Railway's draining time)", async () => {
    const h = harness({ stopTimeoutMs: 115_000 });
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    const stopped = h.supervisor.stop();
    h.advance(STOP_TIMEOUT_MS);
    expect(h.children[0]!.signals).toEqual(["SIGTERM"]);
    h.advance(115_000 - STOP_TIMEOUT_MS);
    expect(h.children[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    h.children[0]!.exit(null, "SIGKILL");
    await stopped;
  });

  it("resolves at once when stopped before the start or while waiting to restart", async () => {
    const before = harness();
    before.supervisor.begin();
    await before.supervisor.stop();
    before.advance(START_DELAY_MS * 2);
    expect(before.children).toHaveLength(0);

    const waiting = harness();
    waiting.supervisor.begin();
    waiting.advance(START_DELAY_MS);
    waiting.children[0]!.exit(1);
    await waiting.supervisor.stop();
    waiting.advance(MAX_RESTART_DELAY_MS);
    expect(waiting.children).toHaveLength(1);
  });

  it("signals the child when the web process exits for another reason", () => {
    const h = harness();
    h.supervisor.begin();
    h.advance(START_DELAY_MS);
    h.supervisor.killNow();
    expect(h.children[0]!.signals).toEqual(["SIGTERM"]);
    h.children[0]!.exit(0);
    h.advance(MAX_RESTART_DELAY_MS);
    expect(h.children).toHaveLength(1);
  });
});
