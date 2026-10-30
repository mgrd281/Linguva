/**
 * Polaris responsive values: "@container" appears once, and with several
 * conditions the narrower ones come first (later conditions win, like CSS
 * rules), and no value has a comma of its own (commas separate the values).
 * Measured in the browser: a repeated "@container", a wider condition first
 * or "minmax(0, 1fr)" silently gives a one-column or wrong layout.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

const values = files(join(__dirname, "../../app")).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/"(@container[^"]*)"/g)].map((m) => ({ file, value: m[1]! })),
);

describe("Polaris responsive values", () => {
  it("are used", () => expect(values.length).toBeGreaterThan(0));
  for (const { file, value } of values) {
    it(`${file.split("/app/")[1]}: ${value}`, () => {
      expect(value.match(/@container/g)).toHaveLength(1);
      // Commas separate the values: one inside a track ("minmax(0, 1fr)") silently breaks the layout.
      expect(value).not.toMatch(/\([^()]*,[^()]*\)/);
      const sizes = [...value.matchAll(/inline-size\s*>\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    });
  }
});
