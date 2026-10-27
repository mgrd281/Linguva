import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/support/env";

/**
 * Live contract tests against a Shopify development store. Run with
 * `pnpm test:live` after following docs/DEV_STORE_SETUP.md. Never part of CI.
 */
export default defineConfig({
  test: {
    name: "live",
    include: ["tests/live/**/*.live.test.ts"],
    env: testEnv,
    globalSetup: ["tests/support/integration-global-setup.ts"],
    fileParallelism: false,
    // Real network calls, and tests in a file build on each other.
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
