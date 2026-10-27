import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The codegen preset silently skips GraphQL documents it can't parse (for
// example template literals with ${...}), and skipped operations are never
// validated against the Admin API schema. Every named operation in a
// `#graphql` document must therefore show up in the generated types.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "types" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("GraphQL documents", () => {
  it("are all validated by codegen (none silently skipped)", () => {
    const generated = readFileSync("app/types/admin.generated.d.ts", "utf8");
    const operations: string[] = [];
    for (const file of [...sources("app"), ...sources("tests/live")]) {
      const text = readFileSync(file, "utf8");
      for (const doc of text.matchAll(/`#graphql([\s\S]*?)`/g)) {
        expect(doc[1], `${file}: no interpolation in GraphQL documents`).not.toContain("${");
        for (const op of doc[1]!.matchAll(/\b(query|mutation)\s+(\w+)/g)) operations.push(op[2]!);
      }
    }
    expect(operations.length).toBeGreaterThan(10);
    for (const name of operations) expect(generated, name).toMatch(new RegExp(`\\b${name}(Query|Mutation)\\b`));
  });
});
