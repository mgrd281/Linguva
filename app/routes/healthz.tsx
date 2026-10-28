/**
 * Health check for the hosting platform (Railway's deploy health check,
 * docs/RAILWAY_STAGING.md): 200 when the app can reach its database as the
 * runtime role, 503 otherwise. Public, no shop, no details in the answer.
 */
import { prisma } from "../.server/lib/db";
import { logger } from "../.server/lib/logger";

const TIMEOUT_MS = 3000;
const HEADERS = { "Cache-Control": "no-store" };

export const loader = async () => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database check timed out")), TIMEOUT_MS)),
    ]);
    return Response.json({ status: "ok" }, { headers: HEADERS });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "health check failed");
    return Response.json({ status: "unavailable" }, { status: 503, headers: HEADERS });
  }
};
