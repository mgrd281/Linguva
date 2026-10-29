/**
 * Conventions the browser tests found the hard way: Polaris options with an
 * empty value submit their visible text, and modals need an accessible name.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL, chosen } from "../../app/lib/select-all";

const ROOT = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}
const TSX = files("app").map((path) => ({ path: relative(ROOT, join(ROOT, path)), text: readFileSync(join(ROOT, path), "utf8") }));

describe("UI conventions", () => {
  it("no Polaris option has an empty value (it would submit its label)", () => {
    expect(TSX.filter((f) => /<s-option\s+value=""/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("every modal has an accessible name", () => {
    const unnamed = TSX.filter((f) => [...f.text.matchAll(/<s-modal\b[^>]*>/g)].some((m) => !/accessibilityLabel=/.test(m[0])));
    expect(unnamed.map((f) => f.path)).toEqual([]);
  });

  it("the 'All' option reads as no filter", () => {
    expect(chosen(ALL)).toBeNull();
    expect(chosen("")).toBeNull();
    expect(chosen(null)).toBeNull();
    expect(chosen("de")).toBe("de");
  });
});
