/**
 * What the Overview says about measuring coverage, from the newest report
 * (pure). Only what is known is said: a queued report never shows progress,
 * a report without progress for STALE_REPORT_MS can be started again (the
 * server then replaces it), and percentages come only from completed ones.
 */
import { STALE_REPORT_MS } from "../coverage/coverage";

/** A queued report that hasn't started after this long is "waiting" (it starts by itself). */
export const QUEUE_SLOW_MS = 2 * 60_000;

export type MeasurementState =
  /** Never measured. */
  | "never"
  /** Background jobs can't run here (no Redis). */
  | "unavailable"
  /** Just started, not picked up yet. */
  | "queued"
  /** Queued for a while; starts by itself. */
  | "waiting"
  /** Pages are being read. */
  | "running"
  /** No progress for STALE_REPORT_MS: can be started again. */
  | "stalled"
  /** The newest measurement stopped before the end. */
  | "failed"
  /** The newest measurement completed. */
  | "done";

export interface Measurement {
  state: MeasurementState;
  /** Parts read so far (running) and all parts. */
  done: number;
  total: number;
  /** Last progress of a stalled report. */
  since: string | null;
}

export interface ReportInfo {
  status: string;
  segments: readonly string[];
  segmentIndex: number;
  createdAt: string;
  updatedAt: string;
}

export function measurementState(report: ReportInfo | null, options: { jobsAvailable: boolean; now: number }): Measurement {
  const none = { done: 0, total: 0, since: null };
  if (report && (report.status === "QUEUED" || report.status === "RUNNING") && options.jobsAvailable) {
    const total = report.segments.length;
    if (options.now - Date.parse(report.updatedAt) >= STALE_REPORT_MS) return { state: "stalled", done: 0, total, since: report.updatedAt };
    if (report.status === "RUNNING") return { state: "running", done: Math.min(report.segmentIndex, total), total, since: null };
    return { state: options.now - Date.parse(report.createdAt) >= QUEUE_SLOW_MS ? "waiting" : "queued", done: 0, total, since: null };
  }
  if (!options.jobsAvailable) return { state: "unavailable", ...none };
  if (!report) return { state: "never", ...none };
  if (report.status === "FAILED") return { state: "failed", ...none };
  return { state: "done", ...none };
}

/** Measurements reading the store now (a stalled one can be started again). */
export const UNDER_WAY: ReadonlySet<MeasurementState> = new Set(["queued", "waiting", "running"]);

/** Segments are "TYPE|locale": whether a measurement reads the language. */
const readsLocale = (segments: readonly string[], locale: string) => segments.some((s) => s.slice(s.indexOf("|") + 1) === locale);

/** A measurement under way reads the language now. */
export function scanningOf(report: { segments: readonly string[] } | null, measurement: Measurement, locale: string) {
  return UNDER_WAY.has(measurement.state) && Boolean(report && readsLocale(report.segments, locale));
}
