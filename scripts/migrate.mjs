// Runs `prisma migrate deploy` as the owner role (MIGRATION_DATABASE_URL),
// keeping the runtime role (DATABASE_URL) free of DDL privileges.
import { execFileSync } from "node:child_process";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set");
  process.exit(1);
}
execFileSync("prisma", ["migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
