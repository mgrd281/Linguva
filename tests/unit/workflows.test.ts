/**
 * GitHub Actions workflows parse as YAML: an invalid file makes GitHub
 * skip every check silently (the run fails without a single job).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const dir = join(__dirname, "../../.github/workflows");

describe("CI workflows", () => {
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    it(`${file} is valid YAML with jobs and named steps`, () => {
      const workflow = parse(readFileSync(join(dir, file), "utf8"), { strict: true }) as {
        jobs: Record<string, { steps?: Array<{ name?: unknown }> }>;
      };
      expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
      for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps ?? []) if ("name" in step) expect(typeof step.name).toBe("string");
      }
    });
  }

  it("CI runs the dependency audit and the performance tests", () => {
    const ci = readFileSync(join(dir, "ci.yml"), "utf8");
    expect(ci).toContain("pnpm audit --prod --audit-level high");
    expect(ci).toContain("pnpm test:performance");
  });
});
