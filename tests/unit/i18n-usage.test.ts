/**
 * Every interface text is used: a key either appears literally in the app
 * or belongs to a family of keys the app builds from a code (content types,
 * job states, error codes, …). Unused texts would go untranslated or stale.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGES } from "../../app/i18n/messages";

const ROOT = join(__dirname, "..", "..", "app");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "messages" || name === "types" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [readFileSync(path, "utf8")] : [];
  });
}
const CODE = sources(ROOT).join("\n");

// Keys built from a code at runtime (`${prefix}${code}`); the prefix must appear in the code too.
const DYNAMIC = [
  "common.kind.",
  "common.group.",
  "common.field.",
  "common.issue.",
  "common.jobStatus.",
  "common.jobError.",
  "common.itemError.",
  "common.error.",
  "jobs.outcome.",
  "jobs.itemStatus.",
  "editor.aiError.",
  "editor.rejection.",
  "editor.handle.problem.",
  "editor.saveError.",
  "editor.valueType.",
  "coverage.error.",
  "coverage.state.",
  "coverage.stateHelp.",
  "coverage.next.action.",
  "coverage.group.",
  "transfer.problem.",
  "transfer.import.",
  "languages.ai.",
  "glossary.rule.",
  "markets.market.status.",
  "markets.countries.state.",
  "markets.countries.reason.",
  "overview.countries.status.",
  "settings.auto.paused.",
];

describe("interface texts", () => {
  it("are all used", () => {
    const unused = Object.keys(MESSAGES.en).filter(
      (key) => !CODE.includes(`"${key}"`) && !CODE.includes(`'${key}'`) && !DYNAMIC.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });

  it("dynamic families are really built in the code", () => {
    for (const prefix of DYNAMIC) expect(CODE.includes(prefix), prefix).toBe(true);
  });
});
