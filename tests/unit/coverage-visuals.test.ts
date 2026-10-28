/**
 * Coverage bars never make drafts look done: states that aren't live yet
 * (draft, needs review) are striped, live and problem states are solid.
 */
import { describe, expect, it } from "vitest";
import { STATE_COLOURS, stateFill } from "../../app/components/Coverage";
import { FIELD_STATES } from "../../app/lib/coverage-rules";

describe("coverage bar fills", () => {
  it("stripes what isn't live yet and keeps complete solid", () => {
    expect(stateFill("draft")).toMatch(/^repeating-linear-gradient\(/);
    expect(stateFill("review")).toMatch(/^repeating-linear-gradient\(/);
    for (const state of ["complete", "failed", "outdated", "missing"] as const) expect(stateFill(state)).toBe(STATE_COLOURS[state]);
  });

  it("gives every state its own colour", () => {
    expect(new Set(FIELD_STATES.map((s) => STATE_COLOURS[s])).size).toBe(FIELD_STATES.length);
  });
});
