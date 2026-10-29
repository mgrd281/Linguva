/**
 * What the Overview says about measuring (app/.server/overview/measurement.ts):
 * only what is known, from the newest report and the time.
 */
import { describe, expect, it } from "vitest";
import { measurementState, QUEUE_SLOW_MS, type ReportInfo } from "../../app/.server/overview/measurement";
import { STALE_REPORT_MS } from "../../app/.server/coverage/coverage";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const report = (status: string, overrides: Partial<ReportInfo> = {}): ReportInfo => ({
  status,
  segments: ["PRODUCT|de", "COLLECTION|de", "PAGE|de", "PRODUCT|fr"],
  segmentIndex: 0,
  createdAt: ago(60_000),
  updatedAt: ago(60_000),
  ...overrides,
});
const at = (r: ReportInfo | null, jobsAvailable = true) => measurementState(r, { jobsAvailable, now: NOW });

describe("measurement state", () => {
  it("never measured, or can't measure here", () => {
    expect(at(null)).toEqual({ state: "never", done: 0, total: 0, since: null });
    expect(at(null, false).state).toBe("unavailable");
    expect(at(report("FAILED"), false).state).toBe("unavailable");
    expect(at(report("QUEUED"), false).state).toBe("unavailable");
  });

  it("a queued report shows no progress: starting, then waiting (it starts by itself)", () => {
    expect(at(report("QUEUED", { createdAt: ago(QUEUE_SLOW_MS - 1), updatedAt: ago(QUEUE_SLOW_MS - 1) }))).toMatchObject({ state: "queued", done: 0, total: 4 });
    expect(at(report("QUEUED", { createdAt: ago(QUEUE_SLOW_MS), updatedAt: ago(QUEUE_SLOW_MS) })).state).toBe("waiting");
  });

  it("a running report shows the parts read", () => {
    expect(at(report("RUNNING", { segmentIndex: 3, updatedAt: ago(5_000) }))).toEqual({ state: "running", done: 3, total: 4, since: null });
    // Never more than all parts.
    expect(at(report("RUNNING", { segmentIndex: 9, updatedAt: ago(5_000) })).done).toBe(4);
  });

  it("a report without progress for the stale time can be started again (the server replaces it at exactly that age)", () => {
    expect(at(report("RUNNING", { updatedAt: ago(STALE_REPORT_MS - 1) })).state).toBe("running");
    expect(at(report("RUNNING", { updatedAt: ago(STALE_REPORT_MS) }))).toMatchObject({ state: "stalled", since: ago(STALE_REPORT_MS) });
    expect(at(report("QUEUED", { createdAt: ago(STALE_REPORT_MS + 1), updatedAt: ago(STALE_REPORT_MS + 1) })).state).toBe("stalled");
  });

  it("finished or failed", () => {
    expect(at(report("COMPLETED")).state).toBe("done");
    expect(at(report("FAILED")).state).toBe("failed");
  });
});
