import { execFileSync } from "node:child_process";
import { testEnv } from "./env";

/**
 * Applies migrations to the test database as the owner role. Tests then
 * connect as the runtime role so row-level security is exercised for real.
 */
export default function setup() {
  const url = testEnv.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
