import pino from "pino";

/**
 * Structured JSON logger. Tokens, secrets and merchant content must never be
 * logged; the redact list is a safety net, not a licence to log objects freely.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "linguva-web" },
  redact: {
    paths: [
      "accessToken",
      "refreshToken",
      "*.accessToken",
      "*.refreshToken",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "password",
      "*.password",
    ],
    censor: "[REDACTED]",
  },
});
