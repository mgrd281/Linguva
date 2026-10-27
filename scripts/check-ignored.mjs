// Fails if source files are hidden by .gitignore (they would be missing in
// CI and for everyone else, like app/.server/coverage once was). Run before
// pushing: `pnpm check:ignored`.
import { execFileSync } from "node:child_process";

const SOURCE_DIRS = ["app", "prisma", "tests", "worker", "scripts", "extensions", "docs", ".github"];
// Generated or downloaded files that are ignored on purpose.
const ALLOWED = [/^app\/types\/admin-\d{4}-\d{2}\.schema\.json$/];

const output = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...SOURCE_DIRS], {
  encoding: "utf8",
});
const hidden = output
  .split("\n")
  .filter(Boolean)
  .filter((path) => !ALLOWED.some((pattern) => pattern.test(path)));
if (hidden.length) {
  console.error(`Ignored by .gitignore but inside source folders:\n${hidden.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("No source files are hidden by .gitignore.");
