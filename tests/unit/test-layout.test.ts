/**
 * Every test file must belong to a suite CI runs. A test file in any other
 * folder (or a security test misnamed) would silently never run.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const CI_SUITES = ["tests/unit/", "tests/integration/", "tests/security/", "tests/performance/"];

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(path);
    return /\.(test|spec)\.(ts|tsx|js)$/.test(entry.name) ? [relative(ROOT, path)] : [];
  });
}

describe("test layout", () => {
  it("puts every test file in a suite that CI runs (live tests excepted)", () => {
    const files = [...testFiles(join(ROOT, "tests")), ...testFiles(join(ROOT, "app"))];
    expect(files.length).toBeGreaterThan(40);
    const orphans = files.filter(
      (f) => !CI_SUITES.some((s) => f.startsWith(s)) && !(f.startsWith("tests/live/") && f.endsWith(".live.test.ts")),
    );
    expect(orphans).toEqual([]);
  });

  it("keeps the security suite non-empty", () => {
    expect(testFiles(join(ROOT, "tests", "security")).length).toBeGreaterThanOrEqual(5);
  });
});
