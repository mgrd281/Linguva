// Runs `prisma migrate deploy` as the owner role (MIGRATION_DATABASE_URL),
// keeping the runtime role (DATABASE_URL) free of DDL privileges.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Local development: read MIGRATION_DATABASE_URL from .env (the shell wins).
if (process.env.NODE_ENV !== "production" && existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set");
  process.exit(1);
}
execFileSync("prisma", ["migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
