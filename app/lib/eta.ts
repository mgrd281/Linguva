/**
 * Remaining time of a running bulk job, shown only when the estimate can be
 * trusted: enough items done (at least 10 and 5 % of the total), at least 30
 * seconds of work observed. Otherwise null, and the page shows progress
 * without a time.
 */
export const ETA_MIN_DONE = 10;
export const ETA_MIN_SHARE = 0.05;
export const ETA_MIN_ELAPSED_MS = 30_000;
/** Longer estimates are shown as "more than a day" rather than as a precise time. */
export const ETA_MAX_MS = 24 * 60 * 60 * 1000;

export function reliableEta(input: { done: number; total: number; startedAt: Date | string | null; now?: Date }): number | null {
  const { done, total } = input;
  if (!input.startedAt || total <= 0 || done >= total) return null;
  const elapsed = (input.now ?? new Date()).getTime() - new Date(input.startedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < ETA_MIN_ELAPSED_MS) return null;
  if (done < ETA_MIN_DONE || done < total * ETA_MIN_SHARE) return null;
  const remaining = (elapsed / done) * (total - done);
  return Math.min(Math.round(remaining), ETA_MAX_MS);
}
