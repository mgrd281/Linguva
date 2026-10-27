/** How close a shop is to its monthly AI allowance. */
export type UsageLevel = "ok" | "high" | "exhausted";

/** "high" from 80 %, "exhausted" at the limit. */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (limit <= 0 || used >= limit) return "exhausted";
  return used / limit >= 0.8 ? "high" : "ok";
}
