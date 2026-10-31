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
  "automatic.mode.",
  "automatic.activity.trigger.",
  "automatic.activity.status.",
  "automatic.activity.reason.",
  "automatic.error.",
  "common.kind.",
  "content.part.",
  "content.access.scope.",
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
  "language.state.",
  "language.word.",
  "language.count.",
  "language.hero.state.",
  "language.confirm.state.",
  "language.category.",
  "language.tier.",
  "language.extra.",
  "language.error.",
  "languages.ai.",
  "glossary.rule.",
  "markets.market.status.",
  "markets.countries.state.",
  "markets.countries.reason.",
  "overview.countries.status.",
  "settings.auto.paused.",
  "settings.changes.pause.",
  "settings.changes.waiting.",
  "review.hint.",
  "review.result.failed.",
  "review.result.stale.",
  "review.scope.group.",
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
