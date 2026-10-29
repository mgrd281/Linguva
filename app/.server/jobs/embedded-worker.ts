/**
 * Background jobs inside the web container (docs/RAILWAY_STAGING.md §8b).
 * The web process supervises one child process running the same worker a
 * separate worker service runs (build/worker/index.js), so a deployment
 * with only the web service still measures coverage and runs jobs.
 *
 * On by default only in production (LINGUVA_STAGE=production), where no
 * worker service exists; LINGUVA_EMBEDDED_WORKER=on|off decides elsewhere,
 * and an unrecognised value means off. The child never takes the web server
 * down: a crash is restarted with backoff, SIGTERM stops it cleanly, and the
 * web keeps serving whatever happens to it.
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { setPriority } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";

/** Wait after the web process starts, so the server listens first. */
export const START_DELAY_MS = 5_000;
export const MIN_RESTART_DELAY_MS = 1_000;
export const MAX_RESTART_DELAY_MS = 5 * 60_000;
/** A child that ran this long counts as healthy: the backoff starts again. */
export const STABLE_AFTER_MS = 60_000;
/** SIGKILL for a child that hasn't stopped this long after SIGTERM. */
export const STOP_TIMEOUT_MS = 20_000;
/** Last resort after SIGTERM: the web process exits even if something hangs. */
export const HARD_EXIT_MS = 25_000;

const ON = new Set(["on", "true", "1", "yes"]);
const OFF = new Set(["off", "false", "0", "no"]);

export interface EmbeddedWorkerSetting {
  on: boolean;
  reason: string;
}

export function embeddedWorkerSetting(env: NodeJS.ProcessEnv): EmbeddedWorkerSetting {
  // The worker itself never starts another one.
  if (env.LINGUVA_WORKER_MODE === "embedded") return { on: false, reason: "worker process" };
  const raw = env.LINGUVA_EMBEDDED_WORKER?.trim().toLowerCase();
  if (raw) {
    if (ON.has(raw)) return { on: true, reason: "LINGUVA_EMBEDDED_WORKER" };
    if (OFF.has(raw)) return { on: false, reason: "LINGUVA_EMBEDDED_WORKER" };
    // The variable exists to switch background jobs off: a typo fails safe.
    return { on: false, reason: "LINGUVA_EMBEDDED_WORKER not recognised (use on or off)" };
  }
  if (env.LINGUVA_STAGE === "production") return { on: true, reason: "production default" };
  return { on: false, reason: "not production" };
}

/** The web's environment for the child, without the owner role's database URL. */
export function workerChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...env, LOG_SERVICE: "linguva-worker", LINGUVA_WORKER_MODE: "embedded" };
  delete child.MIGRATION_DATABASE_URL;
  return child;
}

/** 1 s, 2 s, 4 s … up to 5 min, ±20 % so restarts don't line up. */
export function restartDelayMs(failures: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_RESTART_DELAY_MS, MIN_RESTART_DELAY_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** What the supervisor needs of a child process (Node's ChildProcess has it). */
export interface WorkerChild {
  readonly pid?: number;
  kill(signal: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

type Log = Pick<typeof logger, "info" | "warn" | "error">;

export interface SupervisorDeps {
  spawnWorker(): WorkerChild;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  random(): number;
  log: Log;
}

export interface WorkerSupervisor {
  /** Starts the first child after START_DELAY_MS. */
  begin(): void;
  /** SIGTERM to the child (SIGKILL after STOP_TIMEOUT_MS); resolves once it has exited. Idempotent. */
  stop(): Promise<void>;
  /** Synchronous last word when the web process exits: SIGTERM, no waiting. */
  killNow(): void;
  readonly running: boolean;
}

export function createWorkerSupervisor(deps: SupervisorDeps): WorkerSupervisor {
  let child: WorkerChild | null = null;
  let failures = 0;
  let attempt = 0;
  let timer: unknown = null;
  let stopping = false;
  let stopped: Promise<void> | null = null;
  let onChildEnd: (() => void) | null = null;

  const schedule = (ms: number) => {
    timer = deps.setTimer(() => {
      timer = null;
      start();
    }, ms);
  };

  const restartLater = (detail: Record<string, unknown>, ranMs: number | null) => {
    if (stopping) return;
    // A run that lasted long enough was healthy: start the backoff again.
    if (ranMs !== null && ranMs >= STABLE_AFTER_MS) failures = 0;
    failures++;
    const wait = restartDelayMs(failures, deps.random);
    deps.log.warn({ ...detail, failures, restartInMs: wait }, "embedded worker exited");
    schedule(wait);
  };

  function start() {
    if (stopping) return;
    attempt++;
    let current: WorkerChild;
    try {
      current = deps.spawnWorker();
    } catch (error) {
      restartLater({ err: (error as Error).message, attempt }, null);
      return;
    }
    child = current;
    const startedAt = deps.now();
    let ended = false;
    const end = (detail: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      if (child === current) child = null;
      const notify = onChildEnd;
      onChildEnd = null;
      notify?.();
      restartLater(detail, deps.now() - startedAt);
    };
    current.once("exit", (code, signal) => end({ code, signal, attempt }));
    current.on("error", (error) => {
      // Without a pid the process never started; otherwise (a failed kill)
      // it is still running and its exit is still to come.
      if (current.pid === undefined) end({ err: error.message, attempt });
      else deps.log.warn({ err: error.message, pid: current.pid }, "embedded worker error");
    });
    if (current.pid !== undefined) deps.log.info({ pid: current.pid, attempt }, "embedded worker started");
  }

  return {
    begin() {
      if (!stopping && timer === null && child === null) schedule(START_DELAY_MS);
    },
    stop() {
      if (stopped) return stopped;
      stopping = true;
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      const current = child;
      if (!current) return (stopped = Promise.resolve());
      stopped = new Promise<void>((resolveStop) => {
        let killTimer: unknown = null;
        onChildEnd = () => {
          if (killTimer !== null) deps.clearTimer(killTimer);
          resolveStop();
        };
        killTimer = deps.setTimer(() => {
          deps.log.warn({ pid: current.pid }, "embedded worker didn't stop in time; killing it");
          current.kill("SIGKILL");
        }, STOP_TIMEOUT_MS);
        current.kill("SIGTERM");
      });
      return stopped;
    },
    killNow() {
      stopping = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      child?.kill("SIGTERM");
    },
    get running() {
      return child !== null;
    },
  };
}

/** build/worker/index.js next to the server bundle, else under the working directory. */
function workerEntry(): string | null {
  const candidates = [resolve(process.cwd(), "build/worker/index.js")];
  try {
    candidates.unshift(resolve(dirname(fileURLToPath(import.meta.url)), "../worker/index.js"));
  } catch {
    // Not a file URL (bundled differently): the working directory decides.
  }
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Lower CPU priority and first in line for the out-of-memory killer: the web stays responsive. Best effort. */
function deprioritise(pid: number | undefined) {
  if (pid === undefined) return;
  try {
    setPriority(pid, 10);
  } catch {
    // Not permitted here; harmless.
  }
  try {
    writeFileSync(`/proc/${pid}/oom_score_adj`, "500");
  } catch {
    // Not Linux, or not permitted; harmless.
  }
}

const STATE = Symbol.for("linguva.embeddedWorker");

/**
 * Called once when the web server's bundle loads (entry.server). Never
 * throws into the web process; a second call (hot reload) does nothing.
 */
export function startEmbeddedWorker(env: NodeJS.ProcessEnv = process.env): void {
  const holder = globalThis as { [STATE]?: true };
  if (holder[STATE]) return;
  holder[STATE] = true;
  const log = logger.child({ component: "embedded-worker" });
  try {
    const setting = embeddedWorkerSetting(env);
    if (!setting.on) {
      log.info({ reason: setting.reason }, "embedded worker off");
      return;
    }
    const entry = workerEntry();
    if (!entry) {
      log.error({}, "embedded worker: build/worker/index.js not found; background jobs won't run");
      return;
    }
    const supervisor = createWorkerSupervisor({
      spawnWorker: () => {
        const child = spawn(process.execPath, [entry], { stdio: "inherit", env: workerChildEnv(env) });
        deprioritise(child.pid);
        return child;
      },
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
      now: Date.now,
      random: Math.random,
      log,
    });

    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info({ signal }, "embedded worker stopping");
      // The web server closes on the same signal (react-router-serve); the
      // process ends by itself once the child is gone and requests are done.
      setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
      void supervisor.stop();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    // The web process ends for another reason: the child mustn't outlive it.
    process.on("exit", () => supervisor.killNow());

    log.info({ reason: setting.reason, startInMs: START_DELAY_MS }, "embedded worker on");
    supervisor.begin();
  } catch (error) {
    log.error({ err: (error as Error).message }, "embedded worker could not be set up; background jobs won't run");
  }
}
