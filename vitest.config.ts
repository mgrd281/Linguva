import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/support/env";


export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: testEnv,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          env: testEnv,
          globalSetup: ["tests/support/integration-global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
