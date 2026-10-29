import { getConfig } from "./config";
import { prisma } from "./db";
import { verifyDatabasePostureOnce } from "./db-posture";
import { logger } from "./logger";

/**
 * Checks the database security posture once per process (see db-posture).
 * In production a failed check makes every request and job fail instead of
 * running with weakened tenant isolation.
 */
export function ensureDatabasePosture(): Promise<void> {
  return verifyDatabasePostureOnce(prisma, {
    production: getConfig().NODE_ENV === "production",
    log: (msg, issues) => logger.error({ issues: issues.map((i) => `${i.code}:${i.detail}`) }, msg),
  });
}
