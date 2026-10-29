import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/support/env";
import { rehearsalEnv } from "./tests/live/rehearsal";

/**
 * The live tests against a simulated store shaped like the development
 * store (tests/live/rehearsal.ts): checks the live tests themselves, never
 * Shopify. Read-only, like a live run without LIVE_ALLOW_WRITES.
 * `pnpm test:live:rehearsal` runs both shapes; part of CI.
 */
export default defineConfig({
  test: {
    name: "live-rehearsal",
    include: ["tests/live/**/*.live.test.ts"],
    env: { ...testEnv, ...rehearsalEnv() },
    globalSetup: ["tests/support/integration-global-setup.ts", "tests/live/rehearsal-global-setup.ts"],
    setupFiles: ["tests/live/rehearsal-setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
