/** AI allowances renew with the UTC calendar month, never with Shopify's billing cycle. */
import { describe, expect, it } from "vitest";
import { nextPeriodStart, periodKey } from "../../app/.server/usage/usage-ledger";

describe("usage periods", () => {
  it("start the next period on the 1st of the next UTC month", () => {
    expect(nextPeriodStart(new Date("2026-10-31T23:59:59.999Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextPeriodStart(new Date("2026-10-01T00:00:00.000Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextPeriodStart(new Date("2026-12-15T12:00:00.000Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    // The next period's key is the month after this one's.
    expect(periodKey(nextPeriodStart(new Date("2026-12-31T23:00:00.000Z")))).toBe("2027-01");
  });
});
